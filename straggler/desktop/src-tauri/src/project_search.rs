use crate::{projects::Project, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use tantivy::{
    collector::TopDocs,
    query::{BooleanQuery, Occur, Query, TermQuery},
    schema::{Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, STORED},
    tokenizer::{Language, LowerCaser, SimpleTokenizer, Stemmer, TextAnalyzer},
    Index, TantivyDocument, Term,
};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Passage {
    pub n: usize,
    pub project_id: Uuid,
    pub file_id: Uuid,
    pub name: String,
    pub section: usize,
    pub text: String,
}

const LANGUAGES: &[(&str, Language)] = &[
    ("ara", Language::Arabic),
    ("dan", Language::Danish),
    ("nld", Language::Dutch),
    ("eng", Language::English),
    ("fin", Language::Finnish),
    ("fra", Language::French),
    ("deu", Language::German),
    ("ell", Language::Greek),
    ("hun", Language::Hungarian),
    ("ita", Language::Italian),
    ("nob", Language::Norwegian),
    ("por", Language::Portuguese),
    ("ron", Language::Romanian),
    ("rus", Language::Russian),
    ("spa", Language::Spanish),
    ("swe", Language::Swedish),
    ("tam", Language::Tamil),
    ("tur", Language::Turkish),
];

fn language(text: &str) -> &'static str {
    whatlang::detect(text)
        .filter(|info| info.is_reliable())
        .map(|info| info.lang().code())
        .filter(|code| LANGUAGES.iter().any(|(name, _)| name == code))
        .unwrap_or("plain")
}

fn schema() -> (Schema, Field, Vec<(&'static str, Field)>) {
    let mut builder = Schema::builder();
    let stored = builder.add_text_field("passage", STORED);
    let fields = std::iter::once("plain")
        .chain(LANGUAGES.iter().map(|(code, _)| *code))
        .map(|code| {
            (
                code,
                builder.add_text_field(
                    code,
                    TextOptions::default().set_indexing_options(
                        TextFieldIndexing::default()
                            .set_tokenizer(code)
                            .set_index_option(IndexRecordOption::WithFreqs),
                    ),
                ),
            )
        })
        .collect();
    (builder.build(), stored, fields)
}

fn register_analyzers(index: &Index) {
    index.tokenizers().register(
        "plain",
        TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(LowerCaser)
            .build(),
    );
    for (code, language) in LANGUAGES {
        index.tokenizers().register(
            code,
            TextAnalyzer::builder(SimpleTokenizer::default())
                .filter(LowerCaser)
                .filter(Stemmer::new(*language))
                .build(),
        );
    }
}

// The extractors do not retain page maps. Sections refer to these stable Unicode slices.
fn passages(text: &str) -> impl Iterator<Item = String> + '_ {
    let chars: Vec<char> = text.chars().collect();
    let mut start = 0;
    std::iter::from_fn(move || {
        if start >= chars.len() {
            return None;
        }
        let end = (start + 3200).min(chars.len());
        let passage = chars[start..end].iter().collect();
        start = if end == chars.len() { end } else { end - 400 };
        Some(passage)
    })
}

pub fn search(
    directory: &Path,
    project: &Project,
    query: &str,
    budget: usize,
) -> Result<Vec<Passage>> {
    search_index(directory, project, query, budget)
        .map_err(|error| format!("Cannot search project files: {error}"))
}

fn search_index(
    directory: &Path,
    project: &Project,
    query: &str,
    budget: usize,
) -> Result<Vec<Passage>> {
    let (schema, stored, fields) = schema();
    let files: Vec<_> = project.files.iter().filter(|file| file.included).collect();
    let content: Vec<_> = files
        .iter()
        .map(|file| (file.id, &file.name, &file.text))
        .collect();
    let fingerprint = format!(
        "v1:{:x}",
        Sha256::digest(serde_json::to_vec(&content).map_err(|e| e.to_string())?)
    );
    let marker = directory.join("fingerprint");
    let current = fs::read_to_string(&marker).ok().as_deref() == Some(&fingerprint);
    let existing = Index::open_in_dir(directory)
        .ok()
        .filter(|index| index.schema() == schema);
    let rebuild = !current || existing.is_none();
    let index = if let Some(index) = existing {
        index
    } else {
        if directory.exists() {
            fs::remove_dir_all(directory).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        Index::create_in_dir(directory, schema).map_err(|e| e.to_string())?
    };
    register_analyzers(&index);
    if rebuild {
        let mut writer = index
            .writer_with_num_threads::<TantivyDocument>(1, 20_000_000)
            .map_err(|e| e.to_string())?;
        writer.delete_all_documents().map_err(|e| e.to_string())?;
        for file in files {
            let sample: String = file.text.chars().take(16000).collect();
            let code = language(&sample);
            let field = fields.iter().find(|(name, _)| *name == code).unwrap().1;
            for (section, text) in passages(&file.text).enumerate() {
                let passage = Passage {
                    n: 0,
                    project_id: project.id,
                    file_id: file.id,
                    name: file.name.clone(),
                    section: section + 1,
                    text,
                };
                let mut document = TantivyDocument::default();
                document.add_text(field, &passage.text);
                document.add_text(
                    stored,
                    serde_json::to_string(&passage).map_err(|e| e.to_string())?,
                );
                writer.add_document(document).map_err(|e| e.to_string())?;
            }
        }
        writer.commit().map_err(|e| e.to_string())?;
        writer.wait_merging_threads().map_err(|e| e.to_string())?;
        fs::write(marker, fingerprint).map_err(|e| e.to_string())?;
    }
    if budget == 0 {
        return Ok(Vec::new());
    }
    let mut terms = Vec::<(Occur, Box<dyn Query>)>::new();
    for (_, field) in &fields {
        let mut analyzer = index
            .tokenizer_for_field(*field)
            .map_err(|e| e.to_string())?;
        let mut tokens = analyzer.token_stream(query);
        let mut seen = std::collections::HashSet::new();
        tokens.process(&mut |token| {
            if seen.insert(token.text.clone()) {
                terms.push((
                    Occur::Should,
                    Box::new(TermQuery::new(
                        Term::from_field_text(*field, &token.text),
                        IndexRecordOption::WithFreqs,
                    )),
                ));
            }
        });
    }
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let reader = index.reader().map_err(|e| e.to_string())?;
    let searcher = reader.searcher();
    let limit = (searcher.num_docs() as usize).min(budget);
    if limit == 0 {
        return Ok(Vec::new());
    }
    let matches = searcher
        .search(
            &BooleanQuery::new(terms),
            &TopDocs::with_limit(limit).order_by_score(),
        )
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    let mut remaining = budget.saturating_mul(4);
    for (_, address) in matches {
        let document: TantivyDocument = searcher.doc(address).map_err(|e| e.to_string())?;
        let encoded = document
            .get_first(stored)
            .and_then(|value| value.as_str())
            .ok_or("Invalid derived search passage")?;
        let mut passage: Passage = serde_json::from_str(encoded).map_err(|e| e.to_string())?;
        passage.n = result.len() + 1;
        let overhead = format!(
            "[P{}] {} · section {}\n\n",
            passage.n, passage.name, passage.section
        )
        .chars()
        .count();
        if remaining <= overhead {
            break;
        }
        passage.text = passage.text.chars().take(remaining - overhead).collect();
        remaining -= overhead + passage.text.chars().count();
        result.push(passage);
    }
    Ok(result)
}

pub fn validate(sources: &[Passage]) -> Result<()> {
    for (index, source) in sources.iter().enumerate() {
        if source.n != index + 1
            || source.section == 0
            || source.name.is_empty()
            || source.name.len() > 4096
            || source.text.chars().count() > 3200
        {
            return Err("Invalid saved project source.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::ProjectFile;

    #[test]
    fn rebuilds_from_included_files_and_keeps_ranked_passages_within_budget() {
        let temp = tempfile::tempdir().unwrap();
        let index = temp.path().join("index");
        let file = ProjectFile {
            id: Uuid::new_v4(),
            name: "notes.txt".into(),
            extension: "txt".into(),
            size: 1000,
            included: true,
            text: "The researcher was studying the migrations of birds near the river. ".repeat(64),
            tokens: None,
            token_source: None,
            run_id: None,
        };
        let mut project = Project {
            id: Uuid::new_v4(),
            name: "Research".into(),
            description: String::new(),
            instructions: String::new(),
            starred: false,
            archived: false,
            created_at: 1,
            updated_at: 1,
            files: vec![file],
        };
        assert_eq!(language(&project.files[0].text), "eng");
        let results = search(&index, &project, "migration", 80).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].file_id, project.files[0].id);
        assert!(results[0].text.contains("migrations"));
        assert!(results[0].text.chars().count() < 320);
        assert!(search(&index, &project, "birds", 80).unwrap().len() == 1);
        project.files[0].included = false;
        assert!(search(&index, &project, "birds", 80).unwrap().is_empty());
        project.files[0].included = true;
        project.files[0].text = "A replacement with elephants.".into();
        assert!(search(&index, &project, "birds", 80).unwrap().is_empty());
        assert_eq!(search(&index, &project, "elephants", 80).unwrap().len(), 1);
    }

    #[test]
    fn sections_keep_unicode_boundaries_and_overlap() {
        let input = format!(
            "{}{}{}",
            "a".repeat(2800),
            "☕".repeat(400),
            "b".repeat(180)
        );
        let sections = passages(&input).collect::<Vec<_>>();
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].chars().count(), 3200);
        assert_eq!(sections[1].chars().count(), 580);
        assert!(sections[0].ends_with(&"☕".repeat(400)));
        assert!(sections[1].starts_with(&"☕".repeat(400)));
    }
}

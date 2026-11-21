use crate::{history::Conversation, projects::Project, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};

use tantivy::{
    collector::{DocSetCollector, TopDocs},
    query::{BooleanQuery, Occur, Query, TermQuery},
    schema::{Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, STORED},
    tokenizer::{Language, LowerCaser, SimpleTokenizer, Stemmer, TextAnalyzer},
    DocAddress, Index, Searcher, TantivyDocument, Term,
};
use uuid::Uuid;

type Fingerprint = sha2::digest::Output<Sha256>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Passage {
    pub n: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<Uuid>,
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

#[derive(Serialize)]
struct SearchDocument<'a> {
    id: Uuid,
    text: &'a str,
}

#[derive(Serialize, Deserialize)]
struct IndexedPassage {
    id: Uuid,
    section: usize,
    text: String,
}

struct PassageIndex {
    index: Index,
    stored: Field,
    fields: Vec<(&'static str, Field)>,
}

impl PassageIndex {
    fn open(directory: Option<&Path>, documents: &[SearchDocument<'_>]) -> Result<Self> {
        let (schema, stored, fields) = schema();
        let (index, marker) = if let Some(directory) = directory {
            let fingerprint = format!("v2:{:x}", fingerprint(documents)?);
            let path = directory.join("fingerprint");
            if let Ok(index) = Index::open_in_dir(directory) {
                if index.schema() == schema {
                    let current = fs::read_to_string(&path).ok().as_deref() == Some(&fingerprint);
                    (index, (!current).then_some((path, fingerprint)))
                } else {
                    (
                        recreate_index(directory, schema)?,
                        Some((path, fingerprint)),
                    )
                }
            } else {
                (
                    recreate_index(directory, schema)?,
                    Some((path, fingerprint)),
                )
            }
        } else {
            (Index::create_in_ram(schema), None)
        };
        register_analyzers(&index);
        let result = Self {
            index,
            stored,
            fields,
        };
        if directory.is_none() || marker.is_some() {
            result.rebuild(documents)?;
        }
        if let Some((path, value)) = marker {
            crate::files::write_atomic(&path, value.as_bytes())?;
        }
        Ok(result)
    }

    fn rebuild(&self, documents: &[SearchDocument<'_>]) -> Result<()> {
        let mut writer = self
            .index
            .writer_with_num_threads::<TantivyDocument>(1, 20_000_000)
            .map_err(|e| e.to_string())?;
        writer.delete_all_documents().map_err(|e| e.to_string())?;
        for source in documents {
            let sample: String = source.text.chars().take(16000).collect();
            let code = language(&sample);
            let field = self
                .fields
                .iter()
                .find(|(name, _)| *name == code)
                .unwrap()
                .1;
            for (section, text) in passages(source.text).enumerate() {
                let passage = IndexedPassage {
                    id: source.id,
                    section: section + 1,
                    text,
                };
                let mut document = TantivyDocument::default();
                document.add_text(field, &passage.text);
                document.add_text(
                    self.stored,
                    serde_json::to_string(&passage).map_err(|e| e.to_string())?,
                );
                writer.add_document(document).map_err(|e| e.to_string())?;
            }
        }
        writer.commit().map_err(|e| e.to_string())?;
        writer.wait_merging_threads().map_err(|e| e.to_string())
    }

    fn query(&self, query: &str, require_all: bool) -> Result<Option<BooleanQuery>> {
        let mut terms = Vec::<(Occur, Box<dyn Query>)>::new();
        for (_, field) in &self.fields {
            let mut analyzer = self
                .index
                .tokenizer_for_field(*field)
                .map_err(|e| e.to_string())?;
            let mut tokens = analyzer.token_stream(query);
            let mut seen = HashSet::new();
            let mut field_terms = Vec::<Box<dyn Query>>::new();
            tokens.process(&mut |token| {
                if seen.insert(token.text.clone()) {
                    field_terms.push(Box::new(TermQuery::new(
                        Term::from_field_text(*field, &token.text),
                        IndexRecordOption::WithFreqs,
                    )));
                }
            });
            if require_all && field_terms.len() > 1 {
                terms.push((
                    Occur::Should,
                    Box::new(BooleanQuery::intersection(field_terms)),
                ));
            } else {
                terms.extend(field_terms.into_iter().map(|term| (Occur::Should, term)));
            }
        }
        Ok((!terms.is_empty()).then(|| BooleanQuery::new(terms)))
    }

    fn read(&self, searcher: &Searcher, address: DocAddress) -> Result<IndexedPassage> {
        let document: TantivyDocument = searcher.doc(address).map_err(|e| e.to_string())?;
        let encoded = document
            .get_first(self.stored)
            .and_then(|value| value.as_str())
            .ok_or("Invalid derived search passage")?;
        serde_json::from_str(encoded).map_err(|e| e.to_string())
    }
}

fn recreate_index(directory: &Path, schema: Schema) -> Result<Index> {
    if directory.exists() {
        fs::remove_dir_all(directory).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    Index::create_in_dir(directory, schema).map_err(|e| e.to_string())
}

fn fingerprint(documents: &[SearchDocument<'_>]) -> Result<Fingerprint> {
    Ok(Sha256::digest(
        serde_json::to_vec(documents).map_err(|e| e.to_string())?,
    ))
}

pub fn search(
    directory: &Path,
    project: &Project,
    query: &str,
    budget: usize,
) -> Result<Vec<Passage>> {
    search_project(directory, project, query, budget)
        .map_err(|error| format!("Cannot search project files: {error}"))
}

fn search_project(
    directory: &Path,
    project: &Project,
    query: &str,
    budget: usize,
) -> Result<Vec<Passage>> {
    if budget == 0 {
        return Ok(Vec::new());
    }
    let included = project.files.iter().filter(|file| file.included);
    let files: HashMap<_, _> = included
        .clone()
        .map(|file| (file.id, file.name.as_str()))
        .collect();
    let documents: Vec<_> = included
        .map(|file| SearchDocument {
            id: file.id,
            text: &file.text,
        })
        .collect();
    let index = PassageIndex::open(Some(directory), &documents)?;
    ranked_passages(
        &index,
        SourceScope::Project(project.id),
        &files,
        query,
        budget,
    )
}

#[derive(Clone, Copy)]
enum SourceScope {
    Project(Uuid),
    Attachment(Uuid),
}

fn ranked_passages(
    index: &PassageIndex,
    scope: SourceScope,
    files: &HashMap<Uuid, &str>,
    query: &str,
    budget: usize,
) -> Result<Vec<Passage>> {
    if budget == 0 {
        return Ok(Vec::new());
    }
    let Some(query) = index.query(query, false)? else {
        return Ok(Vec::new());
    };
    let reader = index.index.reader().map_err(|e| e.to_string())?;
    let searcher = reader.searcher();
    let limit = (searcher.num_docs() as usize).min(budget);
    if limit == 0 {
        return Ok(Vec::new());
    }
    let matches = searcher
        .search(&query, &TopDocs::with_limit(limit).order_by_score())
        .map_err(|e| e.to_string())?;
    let (project_id, conversation_id, marker) = match scope {
        SourceScope::Project(id) => (Some(id), None, 'P'),
        SourceScope::Attachment(id) => (None, Some(id), 'A'),
    };
    let mut result = Vec::new();
    let mut remaining = budget.saturating_mul(4);
    for (_, address) in matches {
        let IndexedPassage { id, section, text } = index.read(&searcher, address)?;
        let name = files
            .get(&id)
            .ok_or("The file search index is out of date.")?;
        let n = result.len() + 1;
        let overhead = format!("[{marker}{n}] {name} · section {section}\n\n")
            .chars()
            .count();
        if remaining <= overhead {
            break;
        }
        let text: String = text.chars().take(remaining - overhead).collect();
        remaining -= overhead + text.chars().count();
        result.push(Passage {
            n,
            project_id,
            conversation_id,
            file_id: id,
            name: (*name).into(),
            section,
            text,
        });
    }
    Ok(result)
}

#[derive(Default)]
struct MemoryPassageIndex {
    index: Option<(Fingerprint, PassageIndex)>,
}

impl MemoryPassageIndex {
    fn get(&mut self, documents: &[SearchDocument<'_>]) -> Result<&PassageIndex> {
        let key = fingerprint(documents)?;
        if self
            .index
            .as_ref()
            .is_none_or(|(previous, _)| *previous != key)
        {
            self.index = Some((key, PassageIndex::open(None, documents)?));
        }
        Ok(&self.index.as_ref().unwrap().1)
    }
}

#[derive(Default)]
pub(crate) struct AttachmentIndex {
    cache: MemoryPassageIndex,
}

impl AttachmentIndex {
    pub fn search(
        &mut self,
        conversation_id: Uuid,
        attachments: &[crate::attachments::Attachment],
        query: &str,
        budget: usize,
    ) -> Result<Vec<Passage>> {
        if budget == 0 {
            return Ok(Vec::new());
        }
        let mut files: Vec<_> = attachments
            .iter()
            .filter(|file| file.image.is_none())
            .collect();
        files.sort_unstable_by_key(|file| file.id);
        let documents: Vec<_> = files
            .iter()
            .map(|file| SearchDocument {
                id: file.id,
                text: &file.text,
            })
            .collect();
        let names: HashMap<_, _> = files
            .iter()
            .map(|file| (file.id, file.name.as_str()))
            .collect();
        let index = self.cache.get(&documents)?;
        ranked_passages(
            index,
            SourceScope::Attachment(conversation_id),
            &names,
            query,
            budget,
        )
    }
}

impl crate::Runtime {
    pub fn search_attachments(
        &self,
        id: Uuid,
        temporary: bool,
        query: &str,
        budget: usize,
    ) -> Result<Vec<Passage>> {
        if temporary {
            // Keep the session lock through indexing so erasure also drops this cache.
            let session = self.temporary.lock().map_err(|e| e.to_string())?;
            let session = session
                .as_ref()
                .filter(|session| session.id == id && !session.ending)
                .ok_or("The temporary chat is no longer available.")?;
            let attachments = session
                .originals
                .values()
                .map(|file| file.attachment.clone())
                .collect::<Vec<_>>();
            return self
                .attachment_index
                .lock()
                .map_err(|e| e.to_string())?
                .search(id, &attachments, query, budget);
        }
        let attachments = {
            let _guard = self.history.writer.lock().map_err(|e| e.to_string())?;
            self.history.recover()?;
            self.history.read_one(id)?.attachments
        };
        self.attachment_index
            .lock()
            .map_err(|e| e.to_string())?
            .search(id, &attachments, query, budget)
    }
}

#[derive(Default)]
pub(crate) struct ChatTextIndex {
    // The cache lives only in memory. Deleting a chat cannot leave a second file on disk.
    cache: MemoryPassageIndex,
}

impl ChatTextIndex {
    pub fn matches(&mut self, mut chats: Vec<Conversation>, query: &str) -> Result<Vec<Uuid>> {
        chats.sort_unstable_by_key(|chat| chat.id);
        let texts: Vec<_> = chats
            .iter()
            .filter(|chat| !chat.messages.is_empty() || !chat.attachments.is_empty())
            .map(|chat| {
                (
                    chat.id,
                    chat.messages
                        .iter()
                        .map(|message| message.content.as_str())
                        .chain(
                            chat.attachments
                                .iter()
                                .filter(|file| file.image.is_none())
                                .map(|file| file.text.as_str()),
                        )
                        .collect::<Vec<_>>()
                        .join("\n\n"),
                )
            })
            .collect();
        let documents: Vec<_> = texts
            .iter()
            .map(|(id, text)| SearchDocument { id: *id, text })
            .collect();
        let index = self.cache.get(&documents)?;
        let Some(query) = index.query(query, true)? else {
            return Ok(Vec::new());
        };
        let reader = index.index.reader().map_err(|e| e.to_string())?;
        let searcher = reader.searcher();
        let hits = searcher
            .search(&query, &DocSetCollector)
            .map_err(|e| e.to_string())?;
        let mut ids = HashSet::new();
        for address in hits {
            ids.insert(index.read(&searcher, address)?.id);
        }
        Ok(ids.into_iter().collect())
    }
}

pub fn validate(sources: &[Passage]) -> Result<()> {
    for (index, source) in sources.iter().enumerate() {
        if source.project_id.is_some() == source.conversation_id.is_some()
            || source.n != index + 1
            || source.section == 0
            || source.name.is_empty()
            || source.name.len() > 4096
            || source.text.chars().count() > 3200
        {
            return Err("Invalid saved file source.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::ProjectFile;

    #[test]
    fn attachment_index_is_memory_only_refreshes_content_and_preserves_scope() {
        let id = Uuid::new_v4();
        let mut files = vec![crate::attachments::Attachment {
            id: Uuid::new_v4(),
            name: "research.txt".into(),
            extension: "txt".into(),
            size: 20000,
            text: format!(
                "{}neutrino evidence",
                "unrelated archival text. ".repeat(600)
            ),
            image: None,
        }];
        let mut index = AttachmentIndex::default();
        let sources = index.search(id, &files, "neutrino", 1000).unwrap();
        assert!(!sources.is_empty());
        assert!(sources[0].section > 1);
        assert_eq!(sources[0].conversation_id, Some(id));
        assert_eq!(sources[0].project_id, None);
        assert!(sources[0].text.contains("neutrino"));
        validate(&sources).unwrap();
        let key = index.cache.index.as_ref().unwrap().0;
        files[0].name = "renamed.txt".into();
        let other = Uuid::new_v4();
        let renamed = index.search(other, &files, "neutrino", 1000).unwrap();
        assert_eq!(renamed[0].name, "renamed.txt");
        assert_eq!(renamed[0].conversation_id, Some(other));
        assert_eq!(index.cache.index.as_ref().unwrap().0, key);
        files[0].text = "replacement evidence about telescopes".into();
        assert!(index
            .search(id, &files, "neutrino", 1000)
            .unwrap()
            .is_empty());
        assert_ne!(index.cache.index.as_ref().unwrap().0, key);
        assert!(!index
            .search(id, &files, "telescopes", 1000)
            .unwrap()
            .is_empty());
        assert!(index
            .search(id, &[], "telescopes", 1000)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn sidebar_index_includes_attachment_text_and_refreshes_after_removal() {
        let id = Uuid::new_v4();
        let mut chat: Conversation = serde_json::from_value(serde_json::json!({
            "id": id, "title": "Research", "createdAt": 1, "updatedAt": 1, "model": null,
            "messages": [], "attachments": [{"id": Uuid::new_v4(), "name": "notes.txt", "extension": "txt", "size": 10, "text": "neutrino observations"}]
        })).unwrap();
        let mut index = ChatTextIndex::default();
        assert_eq!(
            index.matches(vec![chat.clone()], "neutrino").unwrap(),
            vec![id]
        );
        chat.attachments.clear();
        assert!(index.matches(vec![chat], "neutrino").unwrap().is_empty());
    }

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

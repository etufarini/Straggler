use crate::Result;
use calamine::{Reader as WorkbookReader, Xlsx};
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::File,
    io::{Cursor, Read},
    path::Path,
};
use uuid::Uuid;
use zip::ZipArchive;

pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attachment {
    pub id: Uuid,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub text: String,
}

#[derive(Debug)]
pub struct ExtractedFile {
    pub attachment: Attachment,
    pub original: Vec<u8>,
}

pub fn supported(extension: &str) -> bool {
    matches!(extension, "txt" | "md" | "docx" | "xlsx" | "pptx")
}

pub fn extract(path: &Path) -> Result<ExtractedFile> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !supported(&extension) {
        let legacy = match extension.as_str() {
            "doc" => Some(("Word", "docx")),
            "xls" => Some(("Excel", "xlsx")),
            "ppt" => Some(("PowerPoint", "pptx")),
            _ => None,
        };
        return Err(if let Some((family, replacement)) = legacy {
            format!("{family} 97–2003 (.{extension}) is not supported. Save it as .{replacement} and add it again.")
        } else {
            "This file type is not supported. Choose .txt, .md, .docx, .xlsx or .pptx.".into()
        });
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("The file name is not valid UTF-8.")?
        .to_owned();
    if !path.is_absolute() {
        return Err("Choose an absolute file path.".into());
    }
    let file = File::open(path).map_err(|e| format!("Cannot read {name}: {e}"))?;
    let metadata = file
        .metadata()
        .map_err(|e| format!("Cannot inspect {name}: {e}"))?;
    if !metadata.is_file() {
        return Err("Choose a regular file, not a directory.".into());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err("This file is larger than the 10 MB limit.".into());
    }
    let mut original = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut original)
        .map_err(|e| format!("Cannot read {name}: {e}"))?;
    if original.len() as u64 > MAX_FILE_BYTES {
        return Err("This file is larger than the 10 MB limit.".into());
    }
    let text = match extension.as_str() {
        "txt" | "md" => String::from_utf8(original.clone()).map_err(|_| {
            "The file is not valid UTF-8. Save it as UTF-8 text and add it again.".to_string()
        })?,
        "docx" => {
            let mut archive = ZipArchive::new(Cursor::new(original.as_slice()))
                .map_err(|e| format!("Cannot open this Word document: {e}"))?;
            document_text(&read_part(&mut archive, "word/document.xml")?)?
        }
        "pptx" => presentation_text(&original)?,
        "xlsx" => spreadsheet_text(&original)?,
        _ => unreachable!(),
    };
    Ok(ExtractedFile {
        attachment: Attachment {
            id: Uuid::new_v4(),
            name,
            extension,
            size: original.len() as u64,
            text,
        },
        original,
    })
}

fn read_part(archive: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<String> {
    let mut file = archive
        .by_name(name)
        .map_err(|e| format!("The document is missing {name}: {e}"))?;
    let mut xml = String::new();
    file.read_to_string(&mut xml)
        .map_err(|e| format!("Cannot read document XML: {e}"))?;
    Ok(xml)
}

fn document_text(xml: &str) -> Result<String> {
    let mut reader = Reader::from_str(xml);
    let mut output = String::new();
    let mut in_text = false;
    loop {
        match reader
            .read_event()
            .map_err(|e| format!("Cannot read document XML: {e}"))?
        {
            Event::Start(element) if element.local_name().as_ref() == b"t" => in_text = true,
            Event::End(element) => match element.local_name().as_ref() {
                b"t" => in_text = false,
                b"p" => output.push('\n'),
                b"tc" => output.push('\t'),
                _ => {}
            },
            Event::Empty(element) => match element.local_name().as_ref() {
                b"tab" => output.push('\t'),
                b"br" => output.push('\n'),
                _ => {}
            },
            Event::Text(text) if in_text => {
                output.push_str(&text.xml10_content().map_err(|e| e.to_string())?)
            }
            Event::CData(text) if in_text => {
                output.push_str(&text.decode().map_err(|e| e.to_string())?)
            }
            Event::GeneralRef(reference) if in_text => {
                let name = reference.decode().map_err(|e| e.to_string())?;
                let entity = format!("&{name};");
                output.push_str(
                    &quick_xml::escape::unescape(&entity)
                        .map_err(|e| format!("Invalid XML entity: {e}"))?,
                );
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(output.trim_end().to_owned())
}

fn attributes(
    element: &quick_xml::events::BytesStart<'_>,
    decoder: quick_xml::encoding::Decoder,
) -> Result<HashMap<String, String>> {
    element
        .attributes()
        .map(|entry| {
            let attribute = entry.map_err(|e| e.to_string())?;
            let key =
                String::from_utf8(attribute.key.as_ref().to_vec()).map_err(|e| e.to_string())?;
            Ok((
                key,
                attribute
                    .decoded_and_normalized_value(quick_xml::XmlVersion::Explicit1_0, decoder)
                    .map_err(|e| e.to_string())?
                    .into_owned(),
            ))
        })
        .collect()
}

fn presentation_text(original: &[u8]) -> Result<String> {
    let mut archive = ZipArchive::new(Cursor::new(original))
        .map_err(|e| format!("Cannot open this PowerPoint document: {e}"))?;
    let presentation = read_part(&mut archive, "ppt/presentation.xml")?;
    let relationships = read_part(&mut archive, "ppt/_rels/presentation.xml.rels")?;
    let mut targets = HashMap::new();
    let mut reader = Reader::from_str(&relationships);
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Empty(element) | Event::Start(element)
                if element.local_name().as_ref() == b"Relationship" =>
            {
                let values = attributes(&element, reader.decoder())?;
                if values
                    .get("Type")
                    .is_some_and(|value| value.ends_with("/slide"))
                    && values
                        .get("TargetMode")
                        .is_none_or(|value| value != "External")
                {
                    if let (Some(id), Some(target)) = (values.get("Id"), values.get("Target")) {
                        let target = if target.starts_with('/') {
                            target.trim_start_matches('/').to_owned()
                        } else {
                            format!("ppt/{target}")
                        };
                        targets.insert(id.clone(), target);
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let mut reader = Reader::from_str(&presentation);
    let mut slides = Vec::new();
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Empty(element) | Event::Start(element)
                if element.local_name().as_ref() == b"sldId" =>
            {
                let values = attributes(&element, reader.decoder())?;
                let id = values
                    .iter()
                    .find(|(key, _)| key.ends_with(":id"))
                    .map(|(_, value)| value)
                    .ok_or("A slide is missing its relationship identifier.")?;
                let part = targets
                    .get(id)
                    .ok_or("A slide relationship is missing from the presentation.")?;
                slides.push(document_text(&read_part(&mut archive, part)?)?);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(slides.join("\n\n"))
}

fn spreadsheet_text(original: &[u8]) -> Result<String> {
    let mut workbook = Xlsx::new(Cursor::new(original))
        .map_err(|e| format!("Cannot open this Excel workbook: {e}"))?;
    let mut sheets = Vec::new();
    for name in workbook.sheet_names().to_owned() {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|e| format!("Cannot read sheet {name}: {e}"))?;
        let mut text = format!("Sheet: {name}\n");
        for row in range.rows() {
            text.push_str(
                &row.iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("\t"),
            );
            text.push('\n');
        }
        sheets.push(text.trim_end().to_owned());
    }
    Ok(sheets.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn package(path: &Path, parts: &[(&str, &str)]) {
        let mut writer = ZipWriter::new(File::create(path).unwrap());
        for (name, contents) in parts {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn text_and_markdown_preserve_utf8_and_reject_invalid_text_size_and_legacy_types() {
        let directory = tempfile::tempdir().unwrap();
        for extension in ["txt", "md"] {
            let path = directory.path().join(format!("notes.{extension}"));
            fs::write(&path, "# Notes\ncaffè ☕").unwrap();
            let extracted = extract(&path).unwrap();
            assert_eq!(extracted.attachment.text, "# Notes\ncaffè ☕");
            assert_eq!(extracted.original, fs::read(path).unwrap());
        }
        let invalid = directory.path().join("invalid.txt");
        fs::write(&invalid, [0xff, 0xfe]).unwrap();
        assert!(extract(&invalid).unwrap_err().contains("UTF-8"));
        File::create(&invalid)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        assert!(extract(&invalid).unwrap_err().contains("10 MB"));
        for extension in ["doc", "xls", "ppt"] {
            let error = extract(&directory.path().join(format!("legacy.{extension}"))).unwrap_err();
            assert!(error.contains("97–2003"));
            assert!(error.contains(&format!("Save it as .{extension}x")));
        }
        assert!(extract(&directory.path().join("unsupported.pdf"))
            .unwrap_err()
            .contains("not supported"));
    }

    #[test]
    fn word_text_runs_keep_order_entities_and_paragraphs() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("example.docx");
        package(
            &path,
            &[(
                "word/document.xml",
                r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A &amp; B</w:t></w:r><w:r><w:t> ☕</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t><w:tab/><w:t>column</w:t></w:r></w:p></w:body></w:document>"#,
            )],
        );
        assert_eq!(
            extract(&path).unwrap().attachment.text,
            "A & B ☕\nNext\tcolumn"
        );
        package(&path, &[("other.xml", "<root/>")]);
        assert!(extract(&path).unwrap_err().contains("word/document.xml"));
    }

    #[test]
    fn powerpoint_uses_declared_slide_order_instead_of_zip_or_filename_order() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("example.pptx");
        package(
            &path,
            &[
                (
                    "ppt/slides/slide1.xml",
                    "<p:sld><a:p><a:r><a:t>First file</a:t></a:r></a:p></p:sld>",
                ),
                (
                    "ppt/slides/slide2.xml",
                    "<p:sld><a:p><a:r><a:t>Second file</a:t></a:r></a:p></p:sld>",
                ),
                (
                    "ppt/presentation.xml",
                    r#"<p:presentation><p:sldIdLst><p:sldId id="2" r:id="rB"/><p:sldId id="1" r:id="rA"/></p:sldIdLst></p:presentation>"#,
                ),
                (
                    "ppt/_rels/presentation.xml.rels",
                    r#"<Relationships><Relationship Id="rA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rB" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>"#,
                ),
            ],
        );
        assert_eq!(
            extract(&path).unwrap().attachment.text,
            "Second file\n\nFirst file"
        );
    }

    #[test]
    fn spreadsheets_use_sheet_order_headings_and_tab_separated_rows() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("example.xlsx");
        package(
            &path,
            &[
                (
                    "[Content_Types].xml",
                    r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>"#,
                ),
                (
                    "_rels/.rels",
                    r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
                ),
                (
                    "xl/workbook.xml",
                    r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="r1"/><sheet name="Notes" sheetId="2" r:id="r2"/></sheets></workbook>"#,
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>"#,
                ),
                (
                    "xl/worksheets/sheet1.xml",
                    r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>"#,
                ),
                (
                    "xl/worksheets/sheet2.xml",
                    r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>A note</t></is></c></row></sheetData></worksheet>"#,
                ),
            ],
        );
        assert_eq!(
            extract(&path).unwrap().attachment.text,
            "Sheet: Budget\nItem\t42\n\nSheet: Notes\nA note"
        );
    }
}

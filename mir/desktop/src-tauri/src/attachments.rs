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
    matches!(extension, "txt" | "md" | "docx" | "xlsx" | "pptx" | "pdf")
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
            "This file type is not supported. Choose .txt, .md, .docx, .xlsx, .pptx or .pdf.".into()
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
        "pdf" => pdf_text(&original)?,
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

fn pdf_text(original: &[u8]) -> Result<String> {
    let text = pdf_extract::extract_text_from_mem(original).map_err(|error| match error {
        pdf_extract::OutputError::PdfError(pdf_extract::Error::Decryption(
            pdf_extract::encryption::DecryptionError::IncorrectPassword,
        )) => "This PDF requires a password. Save an unlocked copy and add it again.".into(),
        _ => format!("Cannot extract text from this PDF: {error}"),
    })?;
    if text.trim().is_empty() {
        return Err(
            "This PDF has no extractable text. Scanned PDFs need OCR before they can be attached."
                .into(),
        );
    }
    Ok(text)
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
    use crate::history::{Conversation, History};
    use pdf_extract::{
        content::{Content, Operation},
        dictionary, Document, Object, Stream,
    };
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

    fn pdf_document(pages: &[&[u8]]) -> Document {
        let mut document = Document::with_version("1.4");
        let pages_id = document.new_object_id();
        let font = document.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
        });
        let mut children = Vec::<Object>::new();
        for text in pages {
            let content = Content {
                operations: vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec!["F1".into(), 12.into()]),
                    Operation::new("Td", vec![40.into(), 750.into()]),
                    Operation::new("Tj", vec![Object::string_literal(*text)]),
                    Operation::new("ET", vec![]),
                ],
            };
            let content =
                document.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
            let page = document.add_object(dictionary! {
                "Type" => "Page", "Parent" => pages_id, "Contents" => content,
            });
            children.push(page.into());
        }
        document.objects.insert(
            pages_id,
            dictionary! {
                "Type" => "Pages", "Count" => children.len() as i64, "Kids" => children,
                "Resources" => dictionary! {"Font" => dictionary! {"F1" => font}},
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            }
            .into(),
        );
        let catalog = document.add_object(dictionary! {"Type" => "Catalog", "Pages" => pages_id});
        document.trailer.set("Root", catalog);
        document.compress();
        document
    }

    #[test]
    fn pdf_text_keeps_page_order_non_ascii_text_and_original_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("report.PDF");
        pdf_document(&[b"First page: caf\xe9", b"Second page: the final paragraph"])
            .save(&path)
            .unwrap();
        let extracted = extract(&path).unwrap();
        let text = &extracted.attachment.text;
        assert!(text.contains("First page: café"));
        assert!(text.find("First page").unwrap() < text.find("Second page").unwrap());
        assert_eq!(extracted.attachment.extension, "pdf");
        assert_eq!(extracted.attachment.name, "report.PDF");
        assert_eq!(extracted.attachment.size, extracted.original.len() as u64);
        assert_eq!(extracted.original, fs::read(path).unwrap());
    }

    #[test]
    fn pdf_failures_preserve_history_and_valid_files_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let storage = directory.path().join("history");
        let history = History::new(storage.clone()).unwrap();
        let chat = Conversation {
            id: Uuid::new_v4(),
            title: "PDF attachments".into(),
            created_at: 1,
            updated_at: 1,
            model: None,
            messages: vec![],
            attachments: vec![],
            options: None,
        };
        history.save(&chat).unwrap();
        let record = storage.join(format!("{}.json", chat.id));
        let saved = fs::read(&record).unwrap();
        let source = directory.path().join("invalid.pdf");
        fs::write(&source, b"%PDF-1.4\nbroken").unwrap();
        assert!(history
            .add_attachment(chat.id, &source)
            .unwrap_err()
            .contains("Cannot extract text"));
        File::create(&source)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        assert!(history
            .add_attachment(chat.id, &source)
            .unwrap_err()
            .contains("10 MB"));
        pdf_document(&[b""]).save(&source).unwrap();
        assert!(history
            .add_attachment(chat.id, &source)
            .unwrap_err()
            .contains("no extractable text"));

        let mut protected = pdf_document(&[b"Password-protected text"]);
        let file_id = Object::string_literal(b"0123456789abcdef".as_slice());
        protected.trailer.set("ID", vec![file_id.clone(), file_id]);
        let encryption =
            pdf_extract::EncryptionState::try_from(pdf_extract::EncryptionVersion::V2 {
                document: &protected,
                owner_password: "owner",
                user_password: "reader",
                key_length: 128,
                permissions: pdf_extract::Permissions::COPYABLE,
            })
            .unwrap();
        protected.encrypt(&encryption).unwrap();
        protected.save(&source).unwrap();
        assert!(history
            .add_attachment(chat.id, &source)
            .unwrap_err()
            .contains("requires a password"));
        assert_eq!(fs::read(record).unwrap(), saved);
        assert_eq!(fs::read_dir(&storage).unwrap().count(), 1);
        assert!(history.list().unwrap()[0].attachments.is_empty());

        pdf_document(&[b"Stored PDF text"]).save(&source).unwrap();
        let original = fs::read(&source).unwrap();
        let attached = history.add_attachment(chat.id, &source).unwrap();
        let attachment = &attached.attachments[0];
        fs::remove_file(source).unwrap();
        assert!(history.list().unwrap()[0].attachments[0]
            .text
            .contains("Stored PDF text"));
        let destination = directory.path().join("download.pdf");
        history
            .download_attachment(chat.id, attachment.id, &destination)
            .unwrap();
        assert_eq!(fs::read(destination).unwrap(), original);
        history.remove_attachment(chat.id, attachment.id).unwrap();
        assert!(history.list().unwrap()[0].attachments.is_empty());
        assert_eq!(
            fs::read_dir(storage.join(chat.id.to_string()).join("attachments"))
                .unwrap()
                .count(),
            0
        );
        let replacement = directory.path().join("replacement.pdf");
        pdf_document(&[b"Delete with the conversation"])
            .save(&replacement)
            .unwrap();
        history.add_attachment(chat.id, &replacement).unwrap();
        history.delete(chat.id).unwrap();
        assert!(history.list().unwrap().is_empty());
        assert!(!storage.join(chat.id.to_string()).exists());
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
        assert!(extract(&directory.path().join("unsupported.csv"))
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

use std::{
    io::{Cursor, Read},
    path::Path,
};

use anyhow::{anyhow, Result};
use base64::Engine;
use zip::ZipArchive;

use crate::domain::models::FilePreview;
use crate::services::workspace;

const MAX_PREVIEW_BYTES: u64 = 32 * 1024 * 1024;

pub fn preview_file(root: &Path, relative: &str) -> Result<FilePreview> {
    let path = workspace::resolve_existing(root, relative)?;
    if !path.is_file() {
        return Err(anyhow!("path is not a file"));
    }
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let kind = kind_for(&ext);
    let mime = mime_for(&ext, kind);
    let size = path.metadata()?.len();
    if kind == "unsupported" {
        return Ok(FilePreview {
            path: relative.replace('\\', "/"),
            kind: kind.into(),
            mime: mime.into(),
            bytes_base64: None,
            text: None,
            too_large: false,
        });
    }
    if size > MAX_PREVIEW_BYTES {
        return Ok(FilePreview {
            path: relative.replace('\\', "/"),
            kind: kind.into(),
            mime: mime.into(),
            bytes_base64: None,
            text: None,
            too_large: true,
        });
    }
    let bytes = std::fs::read(&path)?;
    if matches!(kind, "pdf" | "image") {
        return Ok(FilePreview {
            path: relative.replace('\\', "/"),
            kind: kind.into(),
            mime: mime.into(),
            bytes_base64: Some(base64::engine::general_purpose::STANDARD.encode(&bytes)),
            text: None,
            too_large: false,
        });
    }
    let text = extract_office(&bytes, kind)?;
    Ok(FilePreview {
        path: relative.replace('\\', "/"),
        kind: kind.into(),
        mime: mime.into(),
        bytes_base64: None,
        text: Some(text),
        too_large: false,
    })
}

pub fn kind_for(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "pdf" => "pdf",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" => "image",
        "docx" => "docx",
        "xlsx" => "xlsx",
        "pptx" => "pptx",
        _ => "unsupported",
    }
}

fn mime_for(ext: &str, kind: &str) -> &'static str {
    match (kind, ext) {
        ("pdf", _) => "application/pdf",
        ("image", "png") => "image/png",
        ("image", "jpg" | "jpeg") => "image/jpeg",
        ("image", "gif") => "image/gif",
        ("image", "webp") => "image/webp",
        ("image", "svg") => "image/svg+xml",
        ("image", _) => "image/*",
        ("docx", _) => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ("xlsx", _) => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ("pptx", _) => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

fn extract_office(bytes: &[u8], kind: &str) -> Result<String> {
    let mut zip =
        ZipArchive::new(Cursor::new(bytes)).map_err(|_| anyhow!("不是有效的 Office 文件"))?;
    let mut chunks = Vec::new();
    for index in 0..zip.len() {
        let mut file = zip.by_index(index)?;
        let name = file.name().replace('\\', "/");
        let take = match kind {
            "docx" => name == "word/document.xml",
            "xlsx" => name == "xl/sharedStrings.xml" || name.starts_with("xl/worksheets/sheet"),
            "pptx" => name.starts_with("ppt/slides/slide") && name.ends_with(".xml"),
            _ => false,
        };
        if !take {
            continue;
        }
        let mut xml = String::new();
        file.read_to_string(&mut xml)?;
        let text = xml_text(&xml);
        if !text.is_empty() {
            chunks.push(text);
        }
    }
    if chunks.is_empty() {
        return Ok("（没有可提取的文本）".into());
    }
    Ok(chunks.join("\n\n"))
}

pub fn xml_text(xml: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in xml.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    html_unescape(&out)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn classifies_office_and_pdf() {
        assert_eq!(kind_for("pdf"), "pdf");
        assert_eq!(kind_for("PNG"), "image");
        assert_eq!(kind_for("png"), "image");
        assert_eq!(kind_for("docx"), "docx");
        assert_eq!(kind_for("rs"), "unsupported");
    }

    #[test]
    fn strips_xml_tags() {
        assert_eq!(xml_text("<w:t>Hello &amp; 行知</w:t>"), "Hello & 行知");
    }

    #[test]
    fn extracts_docx_document_xml() {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut cursor);
            zip.start_file("word/document.xml", SimpleFileOptions::default())
                .unwrap();
            zip.write_all("<w:document><w:t>预览正文</w:t></w:document>".as_bytes())
                .unwrap();
            zip.finish().unwrap();
        }
        let text = extract_office(&cursor.into_inner(), "docx").unwrap();
        assert!(text.contains("预览正文"));
    }
}

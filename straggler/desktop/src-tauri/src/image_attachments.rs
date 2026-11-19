use crate::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageMetadata {
    pub width: u32,
    pub height: u32,
    pub resized: bool,
    pub thumbnail: String,
}

pub fn supported(extension: &str) -> bool {
    matches!(extension, "png" | "jpg" | "jpeg" | "webp" | "gif")
}

pub fn prepare(bytes: &[u8]) -> Result<(ImageMetadata, String)> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| format!("Cannot read this image: {error}"))?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Gif | ImageFormat::WebP)
    ) {
        return Err("Choose a PNG, JPEG, WebP or GIF image.".into());
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    // The image decoder uses only the first frame for animated formats.
    let decoded = reader
        .decode()
        .map_err(|error| format!("Cannot decode this image: {error}"))?;
    let resized = decoded.width() > 2048 || decoded.height() > 2048;
    let processed = if resized {
        decoded.resize(2048, 2048, image::imageops::FilterType::Triangle)
    } else {
        decoded
    };
    let mut output = Cursor::new(Vec::new());
    processed
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| format!("Cannot prepare this image: {error}"))?;
    let mut thumbnail = Cursor::new(Vec::new());
    processed
        .thumbnail(30, 30)
        .write_to(&mut thumbnail, ImageFormat::Png)
        .map_err(|error| format!("Cannot prepare the image preview: {error}"))?;
    Ok((
        ImageMetadata {
            width: processed.width(),
            height: processed.height(),
            resized,
            thumbnail: format!(
                "data:image/png;base64,{}",
                STANDARD.encode(thumbnail.into_inner())
            ),
        },
        format!(
            "data:image/png;base64,{}",
            STANDARD.encode(output.into_inner())
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gifs_use_the_first_frame_and_decoder_dimensions_are_limited() {
        let mut bytes = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
            for color in [[255, 0, 0, 255], [0, 0, 255, 255]] {
                encoder
                    .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                        8,
                        8,
                        image::Rgba(color),
                    )))
                    .unwrap();
            }
        }
        let (metadata, data) = prepare(&bytes).unwrap();
        assert!(!metadata.resized);
        let decoded =
            image::load_from_memory(&STANDARD.decode(data.split_once(',').unwrap().1).unwrap())
                .unwrap()
                .to_rgba8();
        assert_eq!(decoded.get_pixel(0, 0).0, [255, 0, 0, 255]);
        let mut oversized = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(16385, 1)
            .write_to(&mut oversized, ImageFormat::Png)
            .unwrap();
        assert!(prepare(oversized.get_ref()).is_err());
    }

    #[test]
    fn image_resize_is_bounded_and_invalid_data_is_rejected() {
        let mut source = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(4096, 512)
            .write_to(&mut source, ImageFormat::Png)
            .unwrap();
        let (metadata, data) = prepare(source.get_ref()).unwrap();
        assert_eq!((metadata.width, metadata.height), (2048, 256));
        assert!(metadata.resized);
        assert!(data.starts_with("data:image/png;base64,"));
        assert!(metadata.thumbnail.len() < 32768);
        assert!(prepare(b"not an image").is_err());
    }
}

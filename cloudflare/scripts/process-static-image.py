import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 40_000_000
ALLOWED = {"JPEG", "PNG", "WEBP"}
MAX_BYTES = 8 * 1024 * 1024
MAX_DIMENSION = 8192
MAX_PIXELS = 40_000_000


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--post", required=True)
    parser.add_argument("--alt", default="")
    parser.add_argument("--output-root", default="public/media")
    parser.add_argument("--source-root", default="media-source")
    parser.add_argument("--max-width", type=int, default=1600)
    parser.add_argument("--quality", type=int, default=82)
    args = parser.parse_args()

    post_id = "".join(ch for ch in args.post if ch.isalnum() or ch in "-_")
    if not post_id or post_id != args.post or len(post_id) > 80:
        raise SystemExit("invalid post id")

    source = Path(args.input)
    if not source.is_file():
        raise SystemExit("input file not found")
    if source.stat().st_size > MAX_BYTES:
        raise SystemExit("image exceeds 8 MB")
    source_hash = sha256_file(source)

    with Image.open(source) as probe:
        if probe.format not in ALLOWED:
            raise SystemExit(f"unsupported format: {probe.format}; only JPEG/PNG/WebP")
        width, height = probe.size
        if width < 1 or height < 1 or width > MAX_DIMENSION or height > MAX_DIMENSION:
            raise SystemExit("image dimensions out of range")
        if width * height > MAX_PIXELS:
            raise SystemExit("image pixel count out of range")

        image = ImageOps.exif_transpose(probe)
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        if image.width > args.max_width:
            target_width = args.max_width
            target_height = round(image.height * target_width / image.width)
            image = image.resize((target_width, target_height), Image.Resampling.LANCZOS)
        # Recreate the image so EXIF/ICC/other metadata is not carried into WebP.
        cleaned = Image.new(image.mode, image.size)
        cleaned.paste(image)

    output_root = Path(args.output_root) / "articles" / post_id
    source_root = Path(args.source_root) / "articles" / post_id
    output_root.mkdir(parents=True, exist_ok=True)
    source_root.mkdir(parents=True, exist_ok=True)

    output_hash = None
    output_path = None
    # WebP encoding is deterministic for same Pillow/version/settings; hash the file after save.
    tmp_path = output_root / f".tmp-{os.getpid()}.webp"
    cleaned.save(tmp_path, "WEBP", quality=args.quality, method=6)
    output_hash = sha256_file(tmp_path)
    filename = f"{output_hash}.webp"
    output_path = output_root / filename
    created = not output_path.exists()
    if output_path.exists():
        tmp_path.unlink()
    else:
        shutil.move(str(tmp_path), str(output_path))

    source_ext = source.suffix.lower().lstrip(".") or "bin"
    source_backup = source_root / f"{source_hash}.{source_ext}"
    if not source_backup.exists():
        shutil.copy2(source, source_backup)

    result = {
        "post_id": post_id,
        "source": str(source),
        "source_sha256": source_hash,
        "output_sha256": output_hash,
        "output_path": str(output_path),
        "source_backup": str(source_backup),
        "url": f"/media/articles/{post_id}/{filename}",
        "filename": filename,
        "mime": "image/webp",
        "bytes": output_path.stat().st_size,
        "created": created,
        "width": cleaned.width,
        "height": cleaned.height,
        "alt": args.alt.strip()[:300],
        "original_name": source.name[:200],
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

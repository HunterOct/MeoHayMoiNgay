from pathlib import Path
from PIL import Image
import json

ROOT = Path("public/assets/img")
OUT = Path("src/lib/image-variants.js")
WIDTHS = (480, 960, 1600)
QUALITY = 80

entries = {}
total_original = 0
total_webp = 0
created = 0
for path in sorted(ROOT.iterdir()):
    if path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
        continue
    url = "/" + path.as_posix().replace("public/", "", 1)
    with Image.open(path) as image:
        width, height = image.size
        original_bytes = path.stat().st_size
        total_original += original_bytes
        variants = []
        for target in WIDTHS:
            if target >= width and variants:
                break
            target_width = min(target, width)
            target_height = round(height * target_width / width)
            variant_name = f"{path.stem}-{target_width}.webp"
            variant_path = ROOT / variant_name
            if not variant_path.exists() or variant_path.stat().st_mtime < path.stat().st_mtime:
                frame = image.convert("RGBA" if image.mode in {"RGBA", "LA", "P"} else "RGB")
                if frame.size != (target_width, target_height):
                    frame = frame.resize((target_width, target_height), Image.Resampling.LANCZOS)
                frame.save(variant_path, "WEBP", quality=QUALITY, method=6)
                created += 1
            total_webp += variant_path.stat().st_size
            variants.append(
                {
                    "width": target_width,
                    "height": target_height,
                    "url": f"/assets/img/{variant_name}",
                }
            )
        entries[url] = {
            "width": width,
            "height": height,
            "bytes": original_bytes,
            "webp": variants,
        }

payload = "export const IMAGE_VARIANTS = " + json.dumps(entries, ensure_ascii=False, indent=2) + ";\n"
OUT.write_text(payload, encoding="utf-8")
print(json.dumps({
    "images": len(entries),
    "variants_created": created,
    "original_bytes": total_original,
    "webp_bytes": total_webp,
    "map": str(OUT),
}, indent=2))

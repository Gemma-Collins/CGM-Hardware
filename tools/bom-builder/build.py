#!/usr/bin/env python3
"""Inline src/ into two single-file builds:

dist/bom-builder.html       a complete page (open it, or host it anywhere)
dist/squarespace-embed.html just the app, for pasting into a Squarespace Code Block
"""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "src"
DIST = HERE / "dist"


def main():
    page = (SRC / "template.html").read_text(encoding="utf-8")
    sample = json.dumps(json.loads((SRC / "sample.json").read_text(encoding="utf-8")), ensure_ascii=False, separators=(",", ":"))
    parts = {
        "CSS": (SRC / "styles.css").read_text(encoding="utf-8"),
        "SAMPLE": sample.replace("</", "<\\/"),
        "CORE": (SRC / "core.js").read_text(encoding="utf-8"),
        "UI": (SRC / "ui.js").read_text(encoding="utf-8"),
    }
    for key, text in parts.items():
        marker = "/*{{" + key + "}}*/"
        assert marker in page, marker
        page = page.replace(marker, text.strip())
    DIST.mkdir(exist_ok=True)
    (DIST / "bom-builder.html").write_text(page, encoding="utf-8")
    embed = re.search(r"<!-- BOM BUILDER EMBED START -->.*<!-- BOM BUILDER EMBED END -->", page, re.S).group(0)
    (DIST / "squarespace-embed.html").write_text(embed + "\n", encoding="utf-8")
    for f in ("bom-builder.html", "squarespace-embed.html"):
        print(f"dist/{f}: {(DIST / f).stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()

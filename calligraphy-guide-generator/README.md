# Calligraphy Guide Sheet Generator

A self-contained, client-side tool for building custom calligraphy practice sheets.

- **From scratch** — choose paper size, margins, x-height, ascender/descender height, line spacing, and optional slant guide lines (with presets for Broad-edge/Italic, Copperplate/Pointed Pen, and Simple ruled).
- **Upload photo** — use a photo (e.g. a handwriting sample) as a background layer to trace over, with adjustable opacity, scale, rotation, and drag-to-reposition, optionally with guide lines overlaid on top.
- **Download PDF** — renders a print-ready PDF at the chosen paper size, entirely in the browser. No files are uploaded to a server.

## Files

- `index.html` / `style.css` / `app.js` — the app.
- `vendor-jspdf.umd.min.js` — jsPDF, vendored locally so the tool has no external runtime dependencies (no CDN calls, works even with strict site CSPs).

## Embedding on your website

Copy this folder to your site and either:

1. **iframe embed:**
   ```html
   <iframe src="/calligraphy-guide-generator/index.html" style="width:100%; height:900px; border:0;"></iframe>
   ```
2. **Direct include:** host the folder at a path (e.g. `/tools/calligraphy/`) and link to it directly.

No build step, server, or API keys are required.

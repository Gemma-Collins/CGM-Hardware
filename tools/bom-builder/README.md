# BOM Builder

A single-file web app for drone build sheets: parts list, weights, costs, power
supplies and loads, current draw, and the numbers eCalc needs. It reads and
writes `.xlsx` in the same layout as the original *Parakeet MB — 4S + Arducam*
sheet, so the spreadsheet is the save file. Nothing is uploaded or stored on a
server; work in progress is also kept in the visitor's browser.

## What it does

- **Parts list**: onboard sections (Power, Structure, Drive, …), offboard and
  tooling. Pack price + units per pack gives the unit price, so packs of 2 or 4
  are handled without hand-written `=M4/2` formulas. Acc/Bat/Mot/ESC/Prop ticks
  drive the eCalc weight split.
- **Power & current**: power supplies (BEC, buck converter, PM02 …) linked to
  their BOM part, fed from the battery or from another supply. Loads link to BOM
  parts and to the supply that powers them. Shows each supply's load and
  utilisation against its current rating, converter losses, motor and ESC-loss
  current, total battery current, hover flight time, C-rating headroom, voltage
  sag, ESC headroom and thrust-to-weight.
- **eCalc**: the weights to type into eCalc (model weight = AUW − accessories,
  accessory current drain), the battery spec for the free and paid versions,
  a place to record eCalc's outputs and an AUW check against the BOM.
- **Breakdown**: weight and cost by section and by role, procurement progress.

## Spreadsheet format

Download writes one sheet with the same columns and blocks as the original:
BOM in `A:R`, `BREAKDOWNS` in `T:U`, `CURRENT DRAW` in `W:Z`, `eCALC INPUTS`
and the battery spec in `AB:AD`, `NOTES` in `AY`. Everything is live formulas,
so the file still works on its own in Excel or Google Sheets. Additions:

- `Z` names the BOM part each load is linked to.
- A `POWER SUPPLIES` block under the current-draw inputs (V out, max A, BOM
  part, fed from), and one `η_<supply> (%)` input and loss row per supply.
- `eCALC OUTPUTS`, an AUW check and BOM-based estimates in `AG:AH`.
- **Still to procure** counts whole packs at pack price for unprocured items.

Import finds blocks by their labels, not fixed cells, so rows can move. Sheets
from before the app (like the original) import too: loads named
`Pi 4B (via UBEC)` create a `UBEC` supply, `η_ubec (%)` sets its efficiency,
and loads and supplies are matched to BOM parts by name.

## Putting it on a website

`dist/` holds two builds of the same app (about 125 KB each):

- `dist/bom-builder.html`: a complete page. Upload it to any web host (or
  GitHub Pages) and link to it, or open it locally.
- `dist/squarespace-embed.html`: just the app. In Squarespace, add a **Code**
  block to a page, paste the whole file in, and save. (Code blocks with
  JavaScript need a Squarespace plan that allows custom code.) Alternatively
  host `bom-builder.html` somewhere and embed it with
  `<iframe src="…/bom-builder.html" style="width:100%;height:1400px;border:0"></iframe>`.

The page loads ExcelJS from cdnjs and fonts from Google Fonts; everything else
is inline. It opens on a blank build; **Load example** loads the Parakeet build.
To change the example, replace `src/sample.json` (the app's own state format)
and run `python3 build.py`.

## Developing

```
src/core.js      model, calculations, xlsx import/export (no DOM; runs in Node)
src/ui.js        interface
src/styles.css   styles, scoped under .bom with --bom-* tokens
src/sample.json  example build
src/template.html
build.py         inlines src/ into dist/
```

```
python3 build.py      # rebuild dist/ after editing src/
npm install && npm test
```

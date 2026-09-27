# hardware/

Altium Designer project for the CGM transmitter board. Altium project files
(`.PrjPcb`, `.SchDoc`, `.PcbDoc`, libraries) are created and edited in Altium
Designer itself — they aren't generated here, so this folder currently holds
planning docs plus a place for you to create the project.

## Setting up the Altium project

1. In Altium Designer: `File > New > Project > PCB Project`, save as
   `CGM-Transmitter.PrjPcb` in this folder.
2. Add schematic sheets (`File > New > Schematic`), suggested split:
   - `MCU_Core.SchDoc` — nRF52832, crystals, decoupling, debug header
   - `NFC_Frontend.SchDoc` — CR95HF, NFC antenna matching network
   - `Power_Battery.SchDoc` — charger IC, LDO, USB-C input, battery connector
   - `RF_BLE.SchDoc` — BLE antenna + matching, if kept separate from MCU sheet
   - `Display.SchDoc` — e-paper module SPI connection (v1 scope: relay +
     on-device display, see top-level README)
3. Add a blank `.PcbDoc` for the board layout once schematics are wired and
   footprints assigned.
4. Pull in vendor libraries before placing parts:
   - **Nordic** publishes an official Altium reference design for the
     nRF52832 (schematic + PCB) — import this rather than drawing the MCU
     section from scratch.
   - **ST** CR95HF symbols/footprints — available via Ultra Librarian or
     SnapEDA if not in Altium's built-in vendor library search.
5. Once parts are placed with real footprints, generate the BOM from
   `Design > Bill of Materials` (or set up an `.OutJob` for Gerbers + BOM +
   pick-and-place together).

## BOM.csv

`BOM.csv` in this folder is the current planning-stage part list — a
reference to work from while placing symbols, not something imported into
Altium directly. Update it as part numbers get finalized (crystal load caps,
antenna matching values, charger resistor, etc. still need to be pulled from
each datasheet's reference circuit).

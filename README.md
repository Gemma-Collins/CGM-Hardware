# CGM-Hardware

DIY continuous glucose monitor transmitter — an NFC-to-BLE bridge for the Freestyle Libre
sensor, in the same category as MiaoMiao, Bubble, and the open-source LimiTTer project.
Custom PCB design in Altium Designer, custom firmware on a Nordic nRF52832.

## Disclaimer

This is an experimental DIY hardware project. By building and using your own transmitter
you are responsible for what you build and how you use it. This project is not affiliated
with or maintained by Abbott. **Do not make medical decisions based on data from a
self-built device.**

## How it works

1. An NFC reader IC (ST CR95HF) polls the Libre sensor's passive NFC tag (ISO 15693) on a
   timer and reads the raw glucose history blocks out of its FRAM.
2. The MCU (Nordic nRF52832) buffers those raw blocks.
3. The MCU relays the raw data over Bluetooth Low Energy to a phone app (e.g. xDrip+),
   which does the actual decoding into a glucose value. This device does not decode
   glucose values itself — it's a relay.

## Repo structure

- `hardware/` — Altium Designer project: schematic, PCB layout, BOM, library notes
- `firmware/` — nRF52832 firmware (nRF Connect SDK)

## Reference projects

- [LimiTTer](https://github.com/JoernL/LimiTTer) — open-source Arduino + BM019(CR95HF) +
  BLE-module DIY Libre transmitter. Different architecture (separate modules vs. one
  integrated board + single BLE-capable MCU) but proves the NFC chip choice and overall
  approach.

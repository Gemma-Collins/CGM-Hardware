# CGM-Hardware

DIY continuous glucose monitor transmitter — an NFC-to-BLE bridge for the Freestyle Libre
sensor, in the same category as MiaoMiao, Bubble, and the open-source LimiTTer project.
Custom PCB design in Altium Designer, custom firmware on a Nordic nRF52832.

## Disclaimer

This is an experimental DIY hardware project. By building and using your own transmitter
you are responsible for what you build and how you use it. This project is not affiliated
with or maintained by Abbott. **Do not make medical decisions based on data from a
self-built device.**

## How it works (v1 scope)

1. An NFC reader IC (ST CR95HF) polls the Libre sensor's passive NFC tag (ISO 15693) on a
   timer and reads the raw glucose history blocks out of its FRAM.
2. The MCU (Nordic nRF52832) buffers those raw blocks and relays them over BLE to a phone
   app (e.g. xDrip+), which does the actual decoding into a glucose value — same as the
   MiaoMiao's own architecture. This device does not decode glucose values itself in v1.
3. The phone app sends the decoded reading back to the device over a second, custom BLE
   characteristic (not part of the standard MiaoMiao protocol), and the device shows it on
   a small onboard display.
4. Downstream integrations — Nightscout, calendar, Garmin — are handled entirely on the
   phone/app side (e.g. xDrip+ -> Nightscout -> existing Garmin Connect IQ / calendar
   integrations). No custom work is needed in this hardware/firmware for those; they're
   out of scope here.

**Roadmap:** v1 is phone-dependent (NFC read + BLE relay + on-device display of a value
the phone sends back). Full standalone operation — decoding glucose on-device with no
phone required at all — is a later phase, not part of the initial build.

## Repo structure

- `hardware/` — Altium Designer project: schematic, PCB layout, BOM, library notes
- `firmware/` — nRF52832 firmware (nRF Connect SDK)

## Reference projects

- [LimiTTer](https://github.com/JoernL/LimiTTer) — open-source Arduino + BM019(CR95HF) +
  BLE-module DIY Libre transmitter. Different architecture (separate modules vs. one
  integrated board + single BLE-capable MCU) but proves the NFC chip choice and overall
  approach.

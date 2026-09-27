# firmware/

nRF52832 firmware — not yet started. Planned stack: nRF Connect SDK
(Zephyr-based).

## v1 scope

- ISO 15693 command sequence to the CR95HF (poll Libre sensor on a timer,
  read FRAM blocks)
- Buffering raw sensor data between reads
- BLE GATT service to relay raw data to the phone app, matching the
  MiaoMiao protocol so it works with xDrip+ unmodified (see
  [`docs/miaomiao-ble-protocol.md`](docs/miaomiao-ble-protocol.md))
- A second, custom BLE characteristic (write, from phone to device) that
  receives the decoded glucose value back from the phone app, once it's
  computed the reading — this device does not decode glucose itself in v1
- Driving the onboard e-paper display with whatever value/trend arrow was
  last received on that characteristic
- Power management (sleep between polls, battery-friendly BLE connection
  intervals, e-paper only draws current during a refresh)

Downstream integrations (Nightscout, calendar, Garmin) are handled by the
phone app and existing open-source integrations — no firmware work needed
here for those.

## Later (not v1)

- Full standalone operation: on-device glucose decoding (CRC check, and
  decryption for Libre 2) so the device works with no phone present at
  all. Reference logic for this lives in xdripswift's `LibreDataParser` if
  we pick this up later.

## Custom characteristic (relay-back) — TBD

Not yet defined. Needs: UUID, payload format (glucose value + trend
direction + timestamp, at minimum), and whether it's write-with-response
or write-without-response from the phone side. Define this once the core
NFC-read + standard relay path is working.

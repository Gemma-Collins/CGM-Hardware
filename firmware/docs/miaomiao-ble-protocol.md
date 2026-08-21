# MiaoMiao BLE GATT protocol (reference)

Documented from the open-source xdripswift implementation
(`CGMMiaoMiaoTransmitter.swift`, JohanDegraeve/xdripswift, MIT-licensed),
so this firmware can optionally speak the same protocol and stay
compatible with existing apps (xDrip+, xdripswift) out of the box.

Source: https://github.com/JohanDegraeve/xdripswift/blob/master/xDrip/BluetoothTransmitter/CGM/Libre/MiaoMiao/CGMMiaoMiaoTransmitter.swift

## Service & characteristics

These are the standard Nordic UART Service (NUS) UUIDs — MiaoMiao runs
Nordic's off-the-shelf UART-over-BLE service, which ships built into the
nRF Connect SDK.

| Role | UUID |
|---|---|
| Service | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| Write (phone -> device, commands) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| Notify (device -> phone, data) | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |

Advertised device name: `MiaoMiao`.

## Commands (phone -> device)

| Bytes | Meaning |
|---|---|
| `0xF0` | Start reading command. Sent once notify is subscribed, and again after any resend/retry. |
| `0xD3 0x01` | Confirm new-sensor-detected. Sent 500ms after receiving a `0x32` (new sensor) response, followed by another `0xF0` 500ms after that. |

## Response types (first byte of notify payload)

| Byte | Meaning |
|---|---|
| `0x28` | Data packet |
| `0x32` | New sensor detected |
| `0x34` | No sensor detected |
| `0xD1` | Reading-interval changed |

## Data packet (`0x28`) layout

Notify payloads arrive in small BLE-MTU-sized chunks and are buffered
until the total reaches the expected length (363 bytes, or 369 with patch
info appended). If more than 3 seconds pass without a new chunk, the
receiver resets its buffer and re-sends the start-reading command (`0xF0`).

| Byte offset | Length | Field |
|---|---|---|
| 0 | 1 | Response type (`0x28`) |
| 1-4 | 4 | Reserved/unused |
| 5-12 | 8 | Sensor UID (raw) |
| 13 | 1 | Battery percentage |
| 14-15 | 2 | Firmware version |
| 16-17 | 2 | Hardware version |
| 18-361 | 344 | Raw Libre sensor data (FRAM dump; CRC-checked by the receiver, decrypted first if the sensor is a Libre 2) |
| 362 | 1 | Constant `0x20` |
| 363-368 | 6 | Patch info (identifies Libre1 vs Libre2 vs other sensor types) |

Header length (bytes before the raw Libre payload starts) = 18.

## Notes for our firmware

- This device only needs to *relay* bytes 18-361 (plus UID/patch info) —
  decoding the actual glucose value happens in the phone app, not here.
- Implementing this exact protocol (rather than a custom one) means our
  board could work with xDrip+/xdripswift without any app-side changes.
  Whether we do that or define our own simpler protocol is a firmware
  design decision to make once the NFC-read pipeline works.

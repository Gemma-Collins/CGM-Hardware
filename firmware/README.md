# firmware/

nRF52832 firmware — not yet started. Planned stack: nRF Connect SDK
(Zephyr-based), covering:

- ISO 15693 command sequence to the CR95HF (poll Libre sensor on a timer,
  read FRAM blocks)
- Buffering raw sensor data between reads
- Custom BLE GATT service to relay raw data to the phone app (this device
  does not decode glucose values itself)
- Power management (sleep between polls, battery-friendly BLE connection
  intervals)

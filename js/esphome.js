// FUTURE WORK: live sensor integration via ESPHome.
//
// Plan: ESPHome devices with the `web_server` component expose a JSON API at
// `http://<device-ip>/sensor/<entity_id>` returning `{ id, value, state }`.
// A sun/shade sensor (lux or PAR) and a capacitive soil-moisture sensor per
// bed would let the planner replace the manually-entered `sunExposure` and
// `soilMoisture` bed fields with live readings, and log moisture trends over
// a season.
//
// This module only defines the config shape and a stub fetch function today
// — there is no hardware to test against in this environment. Wiring it up
// for real is a follow-up: point a device's baseUrl at its LAN address and
// enable `web_server` (with CORS, since this planner is called from the
// browser) in that device's ESPHome YAML, e.g.:
//
//   web_server:
//     port: 80
//     cors_allow_origin: "*"
//
// then replace fetchESPHomeSensorData()'s body with a real `fetch()` call.

/**
 * @typedef {object} ESPHomeDevice
 * @property {string} id
 * @property {string} name
 * @property {string|null} bedId       - which garden bed this device monitors
 * @property {string} baseUrl          - e.g. "http://192.168.1.42"
 * @property {string} sunSensorEntity  - ESPHome entity id, e.g. "lux_sensor"
 * @property {string} soilMoistureEntity - e.g. "soil_moisture"
 */

/**
 * STUB — not yet connected to real hardware. Returns null and logs a notice
 * instead of throwing, so calling UI code can treat "no live data" as the
 * normal case until this is implemented.
 */
export async function fetchESPHomeSensorData(device) {
  console.info(
    `[esphome] Live sensor fetch not yet implemented. Would GET ` +
    `${device.baseUrl}/sensor/${device.sunSensorEntity} and ` +
    `${device.baseUrl}/sensor/${device.soilMoistureEntity}.`
  );
  return null; // { sunLux: number, soilMoisturePct: number, readAt: Date } once implemented
}

export function newDevice(uid, overrides = {}) {
  return {
    id: uid,
    name: "New sensor node",
    bedId: null,
    baseUrl: "",
    sunSensorEntity: "",
    soilMoistureEntity: "",
    ...overrides,
  };
}

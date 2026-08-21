const STORAGE_KEY = "veggie-garden-planner-state-v1";

function defaultState() {
  return {
    location: null, // { name, lat, lon }
    climate: null,  // computed climate summary
    soil: null,     // computed soil summary
    beds: [],       // [{ id, name, points: [{x,y}...], scalePxPerFt, sunExposure, soilOverridePh }]
    scalePxPerFt: null,
    wishlist: [],   // [{ plantId, desiredStartMonth, desiredEndMonth, quantity|null, bedId|null }]
    espHome: {
      devices: [] // [{ id, name, bedId, baseUrl, sunSensorEntity, soilMoistureEntity }]
    }
  };
}

export const state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed);
  } catch (e) {
    console.warn("Could not load saved state, starting fresh.", e);
    return defaultState();
  }
}

export function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Could not save state.", e);
  }
}

export function resetState() {
  Object.assign(state, defaultState());
  save();
}

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

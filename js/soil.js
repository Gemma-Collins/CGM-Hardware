// Soil property lookup via ISRIC SoilGrids REST API (free, keyless).
// https://rest.isric.org/soilgrids/v2.0/docs

const SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query";

export async function fetchSoilSummary(lat, lon) {
  const props = ["phh2o", "sand", "silt", "clay", "soc"];
  const params = new URLSearchParams({ lon, lat, depth: "0-5cm", value: "mean" });
  for (const p of props) params.append("property", p);

  const res = await fetch(`${SOILGRIDS_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Soil data fetch failed (${res.status})`);
  const data = await res.json();

  const layers = data.properties?.layers || [];
  const readMean = (name, divisor) => {
    const layer = layers.find((l) => l.name === name);
    const depth = layer?.depths?.find((d) => d.label === "0-5cm");
    const val = depth?.values?.mean;
    return val == null ? null : val / divisor;
  };

  const ph = readMean("phh2o", 10); // pH*10 -> pH
  const sandPct = readMean("sand", 10); // g/kg *10 -> %
  const siltPct = readMean("silt", 10);
  const clayPct = readMean("clay", 10);
  const socPct = readMean("soc", 100); // dg/kg /100 -> %

  return {
    lat, lon,
    ph,
    sandPct, siltPct, clayPct, socPct,
    texture: classifyTexture(sandPct, siltPct, clayPct),
  };
}

// Simplified USDA-style texture classification (not the full triangle, but close enough for guidance).
function classifyTexture(sand, silt, clay) {
  if (sand == null || silt == null || clay == null) return "unknown";
  if (clay >= 40) return "clay";
  if (sand >= 70 && clay < 15) return "sandy";
  if (silt >= 50 && clay < 27) return "silty loam";
  if (clay >= 27 && clay < 40) return "clay loam";
  return "loam";
}

export function manualSoilFallback(phInput, textureInput) {
  return {
    lat: null, lon: null,
    ph: phInput != null ? Number(phInput) : null,
    sandPct: null, siltPct: null, clayPct: null, socPct: null,
    texture: textureInput || "unknown",
    manual: true,
  };
}

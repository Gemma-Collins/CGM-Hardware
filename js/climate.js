// Weather & climate lookups using the free, keyless Open-Meteo APIs.
// Geocoding: https://open-meteo.com/en/docs/geocoding-api
// Historical daily data: https://open-meteo.com/en/docs/historical-weather-api

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

export async function geocodeLocation(query) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone,
  }));
}

function dayOfYear(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86400000) + 1;
}

/**
 * Fetch ~5 years of daily min/max temp + precipitation and derive:
 * - average last spring frost (day of year, 32F/0C threshold)
 * - average first fall frost (day of year)
 * - monthly average high/low temps (F)
 * - annual precipitation (inches)
 */
export async function fetchClimateSummary(lat, lon) {
  const today = new Date();
  const endYear = today.getUTCFullYear() - 1; // last fully-complete year
  const startYear = endYear - 4; // 5 years total
  const startDate = `${startYear}-01-01`;
  const endDate = `${endYear}-12-31`;

  const url = `${ARCHIVE_URL}?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_min,temperature_2m_max,precipitation_sum&temperature_unit=fahrenheit` +
    `&precipitation_unit=inch&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Climate data fetch failed (${res.status})`);
  const data = await res.json();
  const { time, temperature_2m_min, temperature_2m_max, precipitation_sum } = data.daily;

  const springFrostDOYs = [];
  const fallFrostDOYs = [];
  const monthlyLow = Array.from({ length: 12 }, () => []);
  const monthlyHigh = Array.from({ length: 12 }, () => []);
  const yearlyPrecip = {};

  for (let i = 0; i < time.length; i++) {
    const dateStr = time[i];
    const year = Number(dateStr.slice(0, 4));
    const month = Number(dateStr.slice(5, 7)) - 1;
    const min = temperature_2m_min[i];
    const max = temperature_2m_max[i];
    const precip = precipitation_sum[i] || 0;

    if (min != null) monthlyLow[month].push(min);
    if (max != null) monthlyHigh[month].push(max);
    yearlyPrecip[year] = (yearlyPrecip[year] || 0) + precip;

    if (min != null && min <= 32) {
      const doy = dayOfYear(dateStr);
      if (month <= 5) springFrostDOYs.push({ year, doy }); // Jan-Jun: track LAST frost of spring
      else fallFrostDOYs.push({ year, doy }); // Jul-Dec: track FIRST frost of fall
    }
  }

  // last spring frost per year = max doy among Jan-Jun frost days
  const lastSpringByYear = {};
  for (const { year, doy } of springFrostDOYs) {
    lastSpringByYear[year] = Math.max(lastSpringByYear[year] || 0, doy);
  }
  // first fall frost per year = min doy among Jul-Dec frost days
  const firstFallByYear = {};
  for (const { year, doy } of fallFrostDOYs) {
    firstFallByYear[year] = Math.min(firstFallByYear[year] ?? Infinity, doy);
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  const avgLastSpringFrostDOY = Math.round(avg(Object.values(lastSpringByYear)));
  const avgFirstFallFrostDOY = Math.round(avg(Object.values(firstFallByYear)));

  const monthlyAvg = Array.from({ length: 12 }, (_, m) => ({
    month: m,
    avgLowF: avg(monthlyLow[m]) != null ? Math.round(avg(monthlyLow[m])) : null,
    avgHighF: avg(monthlyHigh[m]) != null ? Math.round(avg(monthlyHigh[m])) : null,
  }));

  const avgAnnualPrecipIn = Math.round(avg(Object.values(yearlyPrecip)) * 10) / 10;

  const hasFrost = Number.isFinite(avgLastSpringFrostDOY) && Number.isFinite(avgFirstFallFrostDOY);

  return {
    lat, lon,
    yearsAnalyzed: [startYear, endYear],
    hasFrost,
    avgLastSpringFrostDOY: hasFrost ? avgLastSpringFrostDOY : null,
    avgFirstFallFrostDOY: hasFrost ? avgFirstFallFrostDOY : null,
    frostFreeDays: hasFrost ? avgFirstFallFrostDOY - avgLastSpringFrostDOY : 365,
    monthlyAvg,
    avgAnnualPrecipIn,
  };
}

export function doyToDate(doy, year = new Date().getFullYear()) {
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(d.getUTCDate() + (doy - 1));
  return d;
}

export function formatDOY(doy) {
  if (doy == null) return "n/a";
  const d = doyToDate(doy);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

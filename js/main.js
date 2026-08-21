import { state, save, uid, resetState } from "./state.js";
import { geocodeLocation, fetchClimateSummary, formatDOY } from "./climate.js";
import { fetchSoilSummary, manualSoilFallback } from "./soil.js";
import { GardenCanvasEditor, polygonAreaPx } from "./canvas-editor.js";
import { evaluatePlant, MONTH_NAMES, cellAreaSqFt } from "./feasibility.js";
import { resolveAllocations, layoutBed, renderBedPopulation } from "./layout-engine.js";
import { newDevice, fetchESPHomeSensorData } from "./esphome.js";

let PLANTS = [];
let plantsById = {};

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "wishlist") renderWishlist();
    if (btn.dataset.tab === "visualize") renderVisualizeTab();
    if (btn.dataset.tab === "sensors") renderDeviceList();
    if (btn.dataset.tab === "layout") renderBedList();
  });
});

// ---------- Location tab ----------
document.getElementById("locationSearchBtn").addEventListener("click", async () => {
  const q = document.getElementById("locationSearch").value.trim();
  if (!q) return;
  const list = document.getElementById("locationResults");
  list.innerHTML = "<li>Searching…</li>";
  try {
    const results = await geocodeLocation(q);
    list.innerHTML = "";
    if (!results.length) { list.innerHTML = "<li>No matches found.</li>"; return; }
    for (const r of results) {
      const li = document.createElement("li");
      li.className = "clickable";
      li.textContent = r.name;
      li.addEventListener("click", () => selectLocation(r));
      list.appendChild(li);
    }
  } catch (e) {
    list.innerHTML = `<li>Error: ${e.message}</li>`;
  }
});

async function selectLocation(loc) {
  state.location = loc;
  save();
  document.getElementById("locationResults").innerHTML = "";
  document.getElementById("locationSearch").value = loc.name;
  renderLocationSummary("Loading climate & soil data…");
  try {
    const [climate, soil] = await Promise.all([
      fetchClimateSummary(loc.lat, loc.lon),
      fetchSoilSummary(loc.lat, loc.lon).catch(() => manualSoilFallback(null, null)),
    ]);
    state.climate = climate;
    state.soil = soil;
    save();
    renderLocationSummary();
    renderSoilSummary();
  } catch (e) {
    renderLocationSummary(`Could not fetch climate data: ${e.message}`);
  }
}

function renderLocationSummary(message) {
  const el = document.getElementById("locationSummary");
  el.classList.remove("hidden");
  if (message) { el.innerHTML = `<p>${message}</p>`; return; }
  const c = state.climate;
  if (!c) { el.classList.add("hidden"); return; }
  const frostLine = c.hasFrost
    ? `Last spring frost ~${formatDOY(c.avgLastSpringFrostDOY)}, first fall frost ~${formatDOY(c.avgFirstFallFrostDOY)} (${c.frostFreeDays}-day frost-free season)`
    : "No frost detected in analyzed years (year-round growing season)";
  el.innerHTML = `
    <dl>
      <dt>Location</dt><dd>${state.location.name} (${state.location.lat.toFixed(3)}, ${state.location.lon.toFixed(3)})</dd>
      <dt>Frost</dt><dd>${frostLine}</dd>
      <dt>Annual precipitation</dt><dd>${c.avgAnnualPrecipIn} in/yr</dd>
      <dt>Analyzed years</dt><dd>${c.yearsAnalyzed[0]}–${c.yearsAnalyzed[1]}</dd>
    </dl>`;
}

function renderSoilSummary() {
  const el = document.getElementById("soilSummary");
  const s = state.soil;
  if (!s) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  el.innerHTML = `
    <dl>
      <dt>pH</dt><dd>${s.ph != null ? s.ph.toFixed(1) : "unknown"}</dd>
      <dt>Texture</dt><dd>${s.texture}</dd>
      ${s.socPct != null ? `<dt>Organic carbon</dt><dd>${s.socPct.toFixed(1)}%</dd>` : ""}
      ${s.manual ? `<dt>Source</dt><dd>Manual override</dd>` : `<dt>Source</dt><dd>ISRIC SoilGrids (0-5cm)</dd>`}
    </dl>`;
}

document.getElementById("applyManualSoil").addEventListener("click", () => {
  const ph = document.getElementById("manualPh").value;
  const texture = document.getElementById("manualTexture").value;
  const fallback = manualSoilFallback(ph || (state.soil?.ph ?? null), texture || state.soil?.texture);
  state.soil = { ...(state.soil || {}), ...fallback };
  save();
  renderSoilSummary();
});

// ---------- Layout tab ----------
const canvas = document.getElementById("gardenCanvas");
const editor = new GardenCanvasEditor(canvas, {
  getState: () => ({ beds: state.beds, scalePxPerFt: state.scalePxPerFt }),
  onChange: (partial) => { Object.assign(state, partial); save(); renderBedList(); editor.render(); },
  onScaleNeeded: (pxDist) => {
    const feet = prompt(`This line is ${pxDist.toFixed(0)} px long. How many feet does it represent?`, "10");
    return Promise.resolve(feet ? parseFloat(feet) : null);
  },
});

function setToolMode(mode, btnId) {
  editor.setMode(mode);
  document.querySelectorAll(".tool-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById(btnId).classList.add("active");
}
document.getElementById("modeScale").addEventListener("click", () => setToolMode("scale", "modeScale"));
document.getElementById("modeRect").addEventListener("click", () => setToolMode("rect", "modeRect"));
document.getElementById("modePolygon").addEventListener("click", () => setToolMode("polygon", "modePolygon"));
document.getElementById("modeSelect").addEventListener("click", () => setToolMode("select", "modeSelect"));

const origRender = editor.render.bind(editor);
editor.render = function () {
  origRender();
  document.getElementById("scaleReadout").textContent = state.scalePxPerFt
    ? `Scale: ${state.scalePxPerFt.toFixed(1)} px/ft`
    : "Scale not set";
  if (editor.selectedBedId) openBedEditor(editor.selectedBedId); else closeBedEditor();
};

function openBedEditor(bedId) {
  const bed = state.beds.find((b) => b.id === bedId);
  if (!bed) return closeBedEditor();
  const panel = document.getElementById("bedEditor");
  panel.classList.remove("hidden");
  document.getElementById("bedEditorTitle").textContent = bed.name;
  document.getElementById("bedName").value = bed.name;
  document.getElementById("bedSun").value = bed.sunExposure;
  document.getElementById("bedPh").value = bed.soilPh ?? "";
}
function closeBedEditor() {
  document.getElementById("bedEditor").classList.add("hidden");
}
document.getElementById("bedName").addEventListener("input", (e) => updateSelectedBed({ name: e.target.value }));
document.getElementById("bedSun").addEventListener("change", (e) => updateSelectedBed({ sunExposure: e.target.value }));
document.getElementById("bedPh").addEventListener("change", (e) => updateSelectedBed({ soilPh: e.target.value ? parseFloat(e.target.value) : null }));
document.getElementById("deleteBedBtn").addEventListener("click", () => {
  if (editor.selectedBedId) { editor.deleteBed(editor.selectedBedId); save(); renderBedList(); closeBedEditor(); }
});
function updateSelectedBed(patch) {
  const bed = state.beds.find((b) => b.id === editor.selectedBedId);
  if (!bed) return;
  Object.assign(bed, patch);
  save();
  editor.render();
  renderBedList();
}

function renderBedList() {
  const list = document.getElementById("bedList");
  list.innerHTML = "";
  for (const bed of state.beds) {
    const areaSqFt = state.scalePxPerFt ? polygonAreaPx(bed.points) / (state.scalePxPerFt ** 2) : null;
    const li = document.createElement("li");
    li.className = "clickable";
    li.innerHTML = `<span>${bed.name} — ${areaSqFt != null ? areaSqFt.toFixed(1) + " sq ft" : "no scale set"} — ${bed.sunExposure.replace("_", " ")}${bed.soilPh ? `, pH ${bed.soilPh}` : ""}</span>`;
    li.addEventListener("click", () => { editor.selectedBedId = bed.id; editor.render(); });
    list.appendChild(li);
  }
}

// ---------- Wishlist tab ----------
function populateMonthSelects() {
  for (const id of ["wishStartMonth", "wishEndMonth"]) {
    const sel = document.getElementById(id);
    sel.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
  }
  document.getElementById("wishEndMonth").value = "9";
}

function populatePlantPicker() {
  const sel = document.getElementById("plantPicker");
  sel.innerHTML = [...PLANTS]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");
}

document.getElementById("addWishBtn").addEventListener("click", () => {
  const plantId = document.getElementById("plantPicker").value;
  const startMonth = parseInt(document.getElementById("wishStartMonth").value, 10);
  const endMonth = parseInt(document.getElementById("wishEndMonth").value, 10);
  const qtyRaw = document.getElementById("wishQty").value;
  if (endMonth < startMonth) { alert("End month must be the same as or after the start month (wrapping into next year isn't supported yet)."); return; }
  state.wishlist.push({
    id: uid("wish"), plantId, startMonth, endMonth,
    quantity: qtyRaw ? parseInt(qtyRaw, 10) : null,
  });
  save();
  renderWishlist();
});

function renderWishlist() {
  const list = document.getElementById("wishlistItems");
  list.innerHTML = "";
  for (const w of state.wishlist) {
    const plant = plantsById[w.plantId];
    const li = document.createElement("li");
    li.innerHTML = `<span>${plant?.name ?? w.plantId}: ${MONTH_NAMES[w.startMonth - 1]}–${MONTH_NAMES[w.endMonth - 1]}${w.quantity ? `, qty ${w.quantity}` : ""}</span>`;
    const del = document.createElement("button");
    del.textContent = "Remove";
    del.className = "danger";
    del.addEventListener("click", () => {
      state.wishlist = state.wishlist.filter((x) => x.id !== w.id);
      save();
      renderWishlist();
    });
    li.appendChild(del);
    list.appendChild(li);
  }
}

// ---------- Results tab ----------
document.getElementById("runFeasibilityBtn").addEventListener("click", renderFeasibilityResults);

function renderFeasibilityResults() {
  const container = document.getElementById("feasibilityResults");
  if (!state.climate) {
    container.innerHTML = `<p class="muted">Set your location first (step 1) so climate data is available.</p>`;
    return;
  }
  if (!state.wishlist.length) {
    container.innerHTML = `<p class="muted">Add some plants to your wishlist first (step 3).</p>`;
    return;
  }
  const bedCtx = { soilPh: state.soil?.ph ?? null, sunExposure: null };
  container.innerHTML = "";
  for (const w of state.wishlist) {
    const plant = plantsById[w.plantId];
    if (!plant) continue;
    const result = evaluatePlant(plant, w, state.climate, bedCtx);
    container.appendChild(renderPlantCard(result));
  }
}

function maturityLabel(plant) {
  if (plant.perennial) return `perennial, ~${Math.round(plant.daysToMaturity / 365)} yr to first harvest`;
  if (plant.overwinters) return `${plant.daysToMaturity} days, fall-planted (matures next year)`;
  return `${plant.daysToMaturity} days to maturity`;
}

function renderPlantCard(result) {
  const { plant, verdict, coverage, plantings, warnings } = result;
  const div = document.createElement("div");
  div.className = `plant-card ${verdict}`;
  const verdictLabel = verdict === "feasible" ? "Feasible" : verdict === "partial" ? "Partially feasible" : "Not feasible";
  const scheduleLines = plantings.length
    ? plantings.map((p) => `<div class="schedule-line">Plant ${formatDOY(p.plantDOY)} (${p.season}) → harvest ${formatDOY(p.harvestStart)}–${formatDOY(p.harvestEnd)}${p.note ? ` <span class="muted">— ${p.note}</span>` : ""}</div>`).join("")
    : `<div class="schedule-line">No viable planting dates found for the requested window.</div>`;
  div.innerHTML = `
    <h4>${plant.name} <span class="badge ${verdict}">${verdictLabel}</span></h4>
    <div class="muted">Requested coverage of harvest window: ${Math.round(coverage * 100)}%</div>
    <div><strong>Requirements:</strong> ${plant.sun.replace("_", " ")}, pH ${plant.phRange[0]}-${plant.phRange[1]}, spacing ${plant.spacingIn}"×${plant.rowSpacingIn}", ${maturityLabel(plant)}</div>
    <div>${scheduleLines}</div>
    ${warnings.length ? `<ul class="warn">${warnings.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}
  `;
  return div;
}

// ---------- Visualize tab ----------
function populateVizBedPicker() {
  const sel = document.getElementById("vizBedPicker");
  sel.innerHTML = state.beds.map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
}

function renderVisualizeTab() {
  populateVizBedPicker();
  renderVizWishSelect();
}

document.getElementById("vizBedPicker").addEventListener("change", renderVizWishSelect);

function currentVizBed() {
  const id = document.getElementById("vizBedPicker").value;
  return state.beds.find((b) => b.id === id);
}

function renderVizWishSelect() {
  const bed = currentVizBed();
  const container = document.getElementById("vizPlantInfo");
  if (!bed) { container.innerHTML = `<p class="muted">Draw a bed first (step 2).</p>`; return; }
  if (!bed.assignedWishIds) bed.assignedWishIds = [];
  const checks = state.wishlist.map((w) => {
    const plant = plantsById[w.plantId];
    const checked = bed.assignedWishIds.includes(w.id) ? "checked" : "";
    return `<label style="display:flex;align-items:center;gap:0.4rem;font-weight:normal;">
      <input type="checkbox" data-wish="${w.id}" ${checked}/> ${plant?.name ?? w.plantId}${w.quantity ? ` (qty ${w.quantity})` : " (fill share)"}
    </label>`;
  }).join("");
  container.innerHTML = state.wishlist.length
    ? `<div class="card"><strong>Include in this bed:</strong><div style="display:flex;flex-direction:column;gap:0.3rem;margin-top:0.4rem;">${checks}</div></div>`
    : `<p class="muted">Add plants to your wishlist first (step 3).</p>`;
  container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const wishId = cb.dataset.wish;
      if (cb.checked) bed.assignedWishIds = [...new Set([...bed.assignedWishIds, wishId])];
      else bed.assignedWishIds = bed.assignedWishIds.filter((id) => id !== wishId);
      save();
    });
  });
}

document.getElementById("autoPopulateBtn").addEventListener("click", () => {
  const bed = currentVizBed();
  const vizCanvas = document.getElementById("vizCanvas");
  if (!bed) { alert("No bed selected."); return; }
  if (!state.scalePxPerFt) { alert("Set a scale on the Garden Layout tab first."); return; }
  const areaSqFt = polygonAreaPx(bed.points) / (state.scalePxPerFt ** 2);
  const allocations = (bed.assignedWishIds || [])
    .map((wishId) => state.wishlist.find((w) => w.id === wishId))
    .filter(Boolean)
    .map((w) => ({ plantId: w.plantId, quantity: w.quantity }));

  if (!allocations.length) { alert("Check at least one plant to include in this bed."); return; }

  const resolved = resolveAllocations(bed, allocations, plantsById, areaSqFt);
  const { placed, unplacedByPlant } = layoutBed(bed, resolved, plantsById, state.scalePxPerFt);
  const legendEntries = renderBedPopulation(vizCanvas, bed, placed, plantsById);

  document.getElementById("vizLegend").innerHTML = legendEntries.map((l) =>
    `<span class="legend-item"><span class="swatch" style="background:${l.color}"></span>${l.name}</span>`
  ).join("");

  const infoLines = resolved.map((a) => {
    const plant = plantsById[a.plantId];
    const unplaced = unplacedByPlant[a.plantId] || 0;
    const placedCount = a.quantity - unplaced;
    return `<div class="schedule-line">${plant.name}: ${placedCount} placed (spacing ${plant.spacingIn}"×${plant.rowSpacingIn}")${unplaced ? ` — ${unplaced} didn't fit, bed is full` : ""}</div>`;
  }).join("");
  document.getElementById("vizPlantInfo").insertAdjacentHTML("beforeend", `<div class="card">${infoLines}<div class="muted">Bed area: ${areaSqFt.toFixed(1)} sq ft</div></div>`);
});

// ---------- Sensors tab (ESPHome, future work) ----------
function populateDeviceBedPicker() {
  const sel = document.getElementById("deviceBedPicker");
  sel.innerHTML = `<option value="">(no bed)</option>` + state.beds.map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
}

document.getElementById("addDeviceBtn").addEventListener("click", () => {
  const device = newDevice(uid("esp"), {
    name: document.getElementById("deviceName").value || "New sensor node",
    bedId: document.getElementById("deviceBedPicker").value || null,
    baseUrl: document.getElementById("deviceUrl").value,
    sunSensorEntity: document.getElementById("deviceSunEntity").value,
    soilMoistureEntity: document.getElementById("deviceMoistureEntity").value,
  });
  state.espHome.devices.push(device);
  save();
  renderDeviceList();
});

function renderDeviceList() {
  populateDeviceBedPicker();
  const list = document.getElementById("deviceList");
  list.innerHTML = "";
  for (const d of state.espHome.devices) {
    const bed = state.beds.find((b) => b.id === d.bedId);
    const li = document.createElement("li");
    li.innerHTML = `<span>${d.name} — ${bed ? bed.name : "unassigned"} — ${d.baseUrl || "no URL set"} <em class="muted">(not yet live — see js/esphome.js)</em></span>`;
    const del = document.createElement("button");
    del.textContent = "Remove";
    del.className = "danger";
    del.addEventListener("click", () => {
      state.espHome.devices = state.espHome.devices.filter((x) => x.id !== d.id);
      save();
      renderDeviceList();
    });
    li.appendChild(del);
    list.appendChild(li);
  }
}

// ---------- Reset ----------
document.getElementById("resetAllBtn").addEventListener("click", () => {
  if (confirm("This clears all saved location, beds, and wishlist data. Continue?")) {
    resetState();
    location.reload();
  }
});

// ---------- Boot ----------
async function boot() {
  const res = await fetch("data/plants.json");
  PLANTS = await res.json();
  plantsById = Object.fromEntries(PLANTS.map((p) => [p.id, p]));

  populateMonthSelects();
  populatePlantPicker();

  if (state.location) {
    document.getElementById("locationSearch").value = state.location.name;
    renderLocationSummary();
    renderSoilSummary();
  }
  renderBedList();
  editor.render();
  renderWishlist();
  renderDeviceList();
}

boot();

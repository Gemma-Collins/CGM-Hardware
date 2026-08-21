// Packs selected plants into a drawn garden bed shape according to each
// plant's spacing requirements, and renders the populated bed.

import { cellAreaSqFt } from "./feasibility.js";

const PALETTE = [
  "#4a7c59", "#c05621", "#3b6ea5", "#a0522d", "#7a5c9e",
  "#b7842e", "#4f8a8b", "#c2564e", "#5f8d4e", "#8a6d3b",
];

export function colorForPlant(plantId, allPlantIdsInBed) {
  const idx = allPlantIdsInBed.indexOf(plantId);
  return PALETTE[idx % PALETTE.length];
}

function pointInPolygon(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y, xj = points[j].x, yj = points[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Distribute a bed's area among the plants assigned to it.
 * allocations: [{ plantId, quantity }] where quantity is a desired count or null (= fill share).
 * Returns allocations with a resolved `quantity` and how much area (sq ft) is actually available.
 */
export function resolveAllocations(bed, allocations, plantsById, areaSqFt) {
  const fixed = allocations.filter((a) => a.quantity != null);
  const flexible = allocations.filter((a) => a.quantity == null);

  let usedArea = 0;
  const resolved = fixed.map((a) => {
    const plant = plantsById[a.plantId];
    const area = cellAreaSqFt(plant) * a.quantity;
    usedArea += area;
    return { ...a, areaSqFt: area };
  });

  const remainingArea = Math.max(0, areaSqFt - usedArea);
  const shareArea = flexible.length ? remainingArea / flexible.length : 0;
  for (const a of flexible) {
    const plant = plantsById[a.plantId];
    const cell = cellAreaSqFt(plant);
    const quantity = cell > 0 ? Math.max(0, Math.floor(shareArea / cell)) : 0;
    resolved.push({ ...a, quantity, areaSqFt: quantity * cell });
  }
  return resolved;
}

/**
 * Place plant instances on a grid inside the bed polygon, respecting each
 * plant's in-row and between-row spacing (converted from inches to px).
 */
export function layoutBed(bed, resolvedAllocations, plantsById, pxPerFt) {
  const xs = bed.points.map((p) => p.x), ys = bed.points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const placed = [];
  const unplacedByPlant = {};

  // Simple strip-packing: give each plant type horizontal strips of rows
  // sized to its spacing, top to bottom, until its quantity is placed or space runs out.
  let cursorY = minY;
  for (const alloc of resolvedAllocations) {
    const plant = plantsById[alloc.plantId];
    if (!plant || alloc.quantity <= 0) { unplacedByPlant[alloc.plantId] = alloc.quantity || 0; continue; }

    const spacingPx = (plant.spacingIn / 12) * pxPerFt;
    const rowSpacingPx = (plant.rowSpacingIn / 12) * pxPerFt;
    let placedCount = 0;
    let y = cursorY + rowSpacingPx / 2;

    while (placedCount < alloc.quantity && y < maxY) {
      let x = minX + spacingPx / 2;
      while (placedCount < alloc.quantity && x < maxX) {
        const pt = { x, y };
        if (pointInPolygon(pt, bed.points)) {
          placed.push({ plantId: plant.id, x, y });
          placedCount++;
        }
        x += spacingPx;
      }
      y += rowSpacingPx;
    }
    cursorY = y;
    unplacedByPlant[alloc.plantId] = Math.max(0, alloc.quantity - placedCount);
  }

  return { placed, unplacedByPlant };
}

export function renderBedPopulation(canvas, bed, placed, plantsById) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, width, height);

  ctx.beginPath();
  ctx.moveTo(bed.points[0].x, bed.points[0].y);
  for (let i = 1; i < bed.points.length; i++) ctx.lineTo(bed.points[i].x, bed.points[i].y);
  ctx.closePath();
  ctx.fillStyle = "rgba(139,111,78,0.15)";
  ctx.fill();
  ctx.strokeStyle = "#4a7c59";
  ctx.lineWidth = 2;
  ctx.stroke();

  const plantIds = [...new Set(placed.map((p) => p.plantId))];
  for (const inst of placed) {
    const plant = plantsById[inst.plantId];
    ctx.fillStyle = colorForPlant(inst.plantId, plantIds);
    ctx.beginPath();
    ctx.arc(inst.x, inst.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return plantIds.map((id) => ({ id, name: plantsById[id]?.name, color: colorForPlant(id, plantIds) }));
}

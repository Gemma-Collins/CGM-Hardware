// Scaled drawing tool for laying out the garden: set a real-world scale,
// then draw rectangle or freehand polygon beds. Areas are computed in
// square feet from the drawn geometry.

import { uid } from "./state.js";

const GRID_PX = 20;

export class GardenCanvasEditor {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts { getState, onChange }
   *   getState() -> { beds, scalePxPerFt }
   *   onChange(partialState) -> called when beds/scale change
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.getState = opts.getState;
    this.onChange = opts.onChange;
    this.mode = "select"; // 'scale' | 'rect' | 'polygon' | 'select'
    this.drawing = null; // in-progress shape
    this.selectedBedId = null;
    this.onScaleNeeded = opts.onScaleNeeded || (() => Promise.resolve(null));

    this._bindEvents();
    this.render();
  }

  setMode(mode) {
    this.mode = mode;
    this.drawing = null;
    this.render();
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("mousedown", (e) => this._onDown(e));
    c.addEventListener("mousemove", (e) => this._onMove(e));
    c.addEventListener("mouseup", (e) => this._onUp(e));
    c.addEventListener("dblclick", (e) => this._onDblClick(e));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.mode === "polygon" && this.drawing) this._finishPolygon();
      if (e.key === "Escape") { this.drawing = null; this.render(); }
    });
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  async _onDown(e) {
    const p = this._pos(e);
    const state = this.getState();

    if (this.mode === "scale") {
      this.drawing = { type: "scale", a: p, b: p };
      return;
    }

    if (this.mode === "rect") {
      if (!state.scalePxPerFt) { alert("Set the scale first."); this.setMode("select"); return; }
      this.drawing = { type: "rect", start: p, end: p };
      return;
    }

    if (this.mode === "polygon") {
      if (!state.scalePxPerFt) { alert("Set the scale first."); this.setMode("select"); return; }
      if (!this.drawing) this.drawing = { type: "polygon", points: [p] };
      else this.drawing.points.push(p);
      this.render();
      return;
    }

    if (this.mode === "select") {
      this.selectedBedId = this._hitTestBed(p, state.beds);
      this.render();
    }
  }

  _onMove(e) {
    if (!this.drawing) return;
    const p = this._pos(e);
    if (this.drawing.type === "scale") this.drawing.b = p;
    else if (this.drawing.type === "rect") this.drawing.end = p;
    else if (this.drawing.type === "polygon") this.drawing.hover = p;
    this.render();
  }

  async _onUp(e) {
    if (!this.drawing) return;
    if (this.drawing.type === "scale") {
      const { a, b } = this.drawing;
      const pxDist = Math.hypot(b.x - a.x, b.y - a.y);
      this.drawing = null;
      if (pxDist < 5) { this.render(); return; }
      const feet = await this.onScaleNeeded(pxDist);
      if (feet && feet > 0) {
        this.onChange({ scalePxPerFt: pxDist / feet });
      }
      this.setMode("select");
      return;
    }
    if (this.drawing.type === "rect") {
      const { start, end } = this.drawing;
      this.drawing = null;
      if (Math.abs(end.x - start.x) < 5 || Math.abs(end.y - start.y) < 5) { this.render(); return; }
      const points = [
        { x: start.x, y: start.y }, { x: end.x, y: start.y },
        { x: end.x, y: end.y }, { x: start.x, y: end.y },
      ];
      this._addBed(points);
      this.setMode("select");
      return;
    }
    // polygon: mouseup does nothing, vertices added on mousedown
  }

  _onDblClick() {
    if (this.mode === "polygon" && this.drawing) this._finishPolygon();
  }

  _finishPolygon() {
    if (this.drawing && this.drawing.points.length >= 3) {
      this._addBed(this.drawing.points);
    }
    this.drawing = null;
    this.setMode("select");
  }

  _addBed(points) {
    const state = this.getState();
    const bed = {
      id: uid("bed"),
      name: `Bed ${state.beds.length + 1}`,
      points,
      sunExposure: "full_sun",
      soilPh: null,
      soilPhSource: "site",
    };
    this.onChange({ beds: [...state.beds, bed] });
    this.selectedBedId = bed.id;
  }

  deleteBed(bedId) {
    const state = this.getState();
    this.onChange({ beds: state.beds.filter((b) => b.id !== bedId) });
    if (this.selectedBedId === bedId) this.selectedBedId = null;
    this.render();
  }

  _hitTestBed(p, beds) {
    for (let i = beds.length - 1; i >= 0; i--) {
      if (pointInPolygon(p, beds[i].points)) return beds[i].id;
    }
    return null;
  }

  render() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "#e2e8e4";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += GRID_PX) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += GRID_PX) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

    const state = this.getState();

    for (const bed of state.beds) {
      const selected = bed.id === this.selectedBedId;
      drawPolygon(ctx, bed.points, {
        fill: selected ? "rgba(74,124,89,0.28)" : "rgba(74,124,89,0.16)",
        stroke: selected ? "#2f5233" : "#4a7c59",
        lineWidth: selected ? 2.5 : 1.5,
      });
      const centroid = polygonCentroid(bed.points);
      const areaSqFt = state.scalePxPerFt ? polygonAreaPx(bed.points) / (state.scalePxPerFt * state.scalePxPerFt) : null;
      ctx.fillStyle = "#1f2d20";
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(bed.name, centroid.x, centroid.y - 6);
      if (areaSqFt != null) ctx.fillText(`${areaSqFt.toFixed(1)} sq ft`, centroid.x, centroid.y + 10);
    }

    if (this.drawing) {
      if (this.drawing.type === "scale") {
        ctx.strokeStyle = "#c05621";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(this.drawing.a.x, this.drawing.a.y); ctx.lineTo(this.drawing.b.x, this.drawing.b.y); ctx.stroke();
        ctx.setLineDash([]);
      } else if (this.drawing.type === "rect") {
        const { start, end } = this.drawing;
        drawPolygon(ctx, [
          { x: start.x, y: start.y }, { x: end.x, y: start.y },
          { x: end.x, y: end.y }, { x: start.x, y: end.y },
        ], { fill: "rgba(192,86,33,0.15)", stroke: "#c05621", lineWidth: 1.5, dashed: true });
      } else if (this.drawing.type === "polygon") {
        const pts = this.drawing.hover ? [...this.drawing.points, this.drawing.hover] : this.drawing.points;
        drawPolygon(ctx, pts, { fill: "rgba(192,86,33,0.1)", stroke: "#c05621", lineWidth: 1.5, dashed: true, closeShape: false });
        for (const pt of this.drawing.points) {
          ctx.fillStyle = "#c05621";
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }
}

function drawPolygon(ctx, points, { fill, stroke, lineWidth, dashed, closeShape = true }) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (closeShape) ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (dashed) ctx.setLineDash([6, 4]); else ctx.setLineDash([]);
  ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke();
  ctx.setLineDash([]);
}

export function polygonAreaPx(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

export function polygonCentroid(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

export function polygonBoundsFt(points, pxPerFt) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const wFt = (Math.max(...xs) - Math.min(...xs)) / pxPerFt;
  const hFt = (Math.max(...ys) - Math.min(...ys)) / pxPerFt;
  return { widthFt: wFt, heightFt: hFt, minX: Math.min(...xs), minY: Math.min(...ys) };
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

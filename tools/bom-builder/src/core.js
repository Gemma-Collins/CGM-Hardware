/*
 * BOM Builder core: data model, calculations, spreadsheet import and export.
 * No DOM access here, so it runs in the browser and under Node for tests.
 * Spreadsheet I/O uses ExcelJS (passed in, so the caller decides how it loads).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- model

  let seq = 0;
  const uid = (p) => p + (++seq).toString(36) + Math.random().toString(36).slice(2, 7);

  const FLAGS = [
    { key: 'acc', label: 'Accessory', short: 'Acc' },
    { key: 'batt', label: 'Battery', short: 'Bat' },
    { key: 'motor', label: 'Motors', short: 'Mot' },
    { key: 'esc', label: 'ESC', short: 'ESC' },
    { key: 'prop', label: 'Props', short: 'Prop' },
  ];

  const BATTERY_FIELDS = [
    { key: 'type', label: 'Type' },
    { key: 'config', label: 'Configuration' },
    { key: 'capacity', label: 'Cell Capacity' },
    { key: 'maxDischarge', label: 'Max discharge' },
    { key: 'resistance', label: 'Resistance' },
    { key: 'cellV', label: 'Voltage' },
    { key: 'cCont', label: 'C-Rate (cont)' },
    { key: 'cMax', label: 'C-Rate (max)' },
    { key: 'cellWt', label: 'Weight (cell)' },
  ];

  const ECALC_OUTPUTS = [
    { key: 'auw', label: 'All-up weight (g)', fmt: '#,##0.0' },
    { key: 'hoverW', label: 'Electric power at hover (W)', fmt: '0.0' },
    { key: 'hoverA', label: 'Current at hover (A)', fmt: '0.00' },
    { key: 'hoverMin', label: 'Hover flight time (min)', fmt: '0.0' },
    { key: 'throttle', label: 'Hover throttle (%)', fmt: '0' },
    { key: 'maxA', label: 'Current at max throttle (A)', fmt: '0.00' },
    { key: 'maxW', label: 'Electric power at max (W)', fmt: '0.0' },
    { key: 'twr', label: 'Thrust-weight ratio', fmt: '0.00' },
  ];

  function newItem(o) {
    return Object.assign({
      id: uid('i'), component: '', confirmed: false, part: '', qty: 1,
      acc: false, batt: false, motor: false, esc: false, prop: false,
      notes: '', unitWt: null, fullPrice: null, pack: 1,
      reqSent: false, procured: false, store: '', costNote: '',
    }, o || {});
  }
  const newCategory = (name, items) => ({ id: uid('c'), name: name || 'NEW SECTION', items: items || [] });
  const newSupply = (o) => Object.assign({ id: uid('s'), name: 'Supply', itemId: null, from: 'battery', vout: 5, eff: 90, maxA: null }, o || {});
  const newLoad = (o) => Object.assign({ id: uid('l'), name: '', itemId: null, supply: 'battery', watts: 0 }, o || {});

  function newState() {
    return {
      version: 1,
      meta: { title: 'New build', currency: 'AUD' },
      categories: [newCategory('POWER'), newCategory('STRUCTURE'), newCategory('DRIVE'), newCategory('FLIGHT CONTROL')],
      offboard: [],
      tooling: [],
      elec: { vSupply: 14.8, escEff: 95, hoverW: null, escRatingA: null, thrustG: null },
      battery: {
        type: 'Custom', cells: 4, parallel: 1, capacity: 2200, maxDischarge: 80,
        resistance: 0.005, cellV: 3.7, cCont: null, cMax: null,
        fieldNotes: { maxDischarge: '20% buffer for LiPo longevity', cellV: 'nom / cell', cellWt: 'from BOM' },
        freeSpec: '', notes: [],
      },
      supplies: [],
      loads: [],
      ecalc: { auw: null, hoverA: null, hoverMin: null, throttle: null, maxA: null, maxW: null, twr: null },
      notes: [],
    };
  }

  // Fill in anything missing so older or hand-edited state still works.
  function normalize(s) {
    const base = newState();
    s = s || {};
    const out = Object.assign({}, base, s);
    out.meta = Object.assign({}, base.meta, s.meta);
    out.elec = Object.assign({}, base.elec, s.elec);
    out.battery = Object.assign({}, base.battery, s.battery);
    out.battery.fieldNotes = Object.assign({}, (s.battery && s.battery.fieldNotes) || base.battery.fieldNotes);
    out.battery.notes = (s.battery && s.battery.notes) || [];
    out.ecalc = Object.assign({}, base.ecalc, s.ecalc);
    out.categories = (s.categories || base.categories).map((c) => Object.assign(newCategory(c.name), c, { items: (c.items || []).map((i) => newItem(i)) }));
    out.offboard = (s.offboard || []).map((i) => newItem(i));
    out.tooling = (s.tooling || []).map((i) => newItem(i));
    out.supplies = (s.supplies || []).map((x) => newSupply(x));
    out.loads = (s.loads || []).map((x) => newLoad(x));
    out.notes = (s.notes || []).slice();
    return out;
  }

  // ---------------------------------------------------------------- calcs

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const num = (v) => {
    if (isNum(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v;
    return 0;
  };
  const packOf = (it) => (num(it.pack) > 0 ? num(it.pack) : 1);
  const unitPrice = (it) => (it.fullPrice == null || it.fullPrice === '' ? null : num(it.fullPrice) / packOf(it));
  const itemCost = (it) => { const p = unitPrice(it); return p == null ? 0 : p * num(it.qty); };
  const itemWt = (it) => num(it.unitWt) * num(it.qty);
  // What is still to be spent on an item: whole packs at the pack price.
  const spendToBuy = (it) => {
    if (it.fullPrice == null || it.fullPrice === '') return 0;
    const pk = packOf(it);
    return (pk === 1 ? num(it.qty) : Math.ceil(num(it.qty) / pk)) * num(it.fullPrice);
  };

  const allOnboard = (s) => s.categories.reduce((a, c) => a.concat(c.items), []);
  const allItems = (s) => allOnboard(s).concat(s.offboard, s.tooling);
  const itemLabel = (it) => {
    if (!it) return '';
    const a = (it.component || '').trim(), b = (it.part || '').trim();
    return a && b ? a + ' — ' + b : a || b || '(unnamed item)';
  };

  function supplyParent(s, sup) {
    const byId = new Map(s.supplies.map((x) => [x.id, x]));
    const parentOf = (x) => (x.from && x.from !== x.id && byId.has(x.from) ? x.from : 'battery');
    const seen = new Set([sup.id]);
    let p = parentOf(sup);
    while (p !== 'battery') {
      if (seen.has(p)) return 'battery'; // cycle: treat as fed straight from the battery
      seen.add(p);
      p = parentOf(byId.get(p));
    }
    return parentOf(sup);
  }
  const loadSupply = (s, l) => (l.supply && s.supplies.some((x) => x.id === l.supply) ? l.supply : 'battery');

  // Battery -> supplies -> loads, with power flowing back up the tree.
  function powerTree(s) {
    function build(id) {
      const sup = id === 'battery' ? null : s.supplies.find((x) => x.id === id);
      const loads = s.loads.filter((l) => loadSupply(s, l) === id);
      const kids = s.supplies.filter((x) => supplyParent(s, x) === id).map((x) => build(x.id));
      const outW = loads.reduce((a, l) => a + num(l.watts), 0) + kids.reduce((a, k) => a + k.inW, 0);
      const eff = sup ? Math.min(100, Math.max(1, num(sup.eff) || 100)) : 100;
      const inW = outW / (eff / 100);
      const vout = sup ? num(sup.vout) : num(s.elec.vSupply);
      const outA = vout > 0 ? outW / vout : 0;
      const maxA = sup && num(sup.maxA) > 0 ? num(sup.maxA) : null;
      return { id, supply: sup, loads, kids, outW, inW, lossW: inW - outW, eff, vout, outA, maxA, util: maxA ? outA / maxA : null };
    }
    return build('battery');
  }

  function flatSupplies(node, acc) {
    acc = acc || [];
    node.kids.forEach((k) => { acc.push(k); flatSupplies(k, acc); });
    return acc;
  }

  function compute(s) {
    const onboard = allOnboard(s);
    const cats = s.categories.map((c) => ({
      id: c.id, name: c.name,
      wt: c.items.reduce((a, i) => a + itemWt(i), 0),
      cost: c.items.reduce((a, i) => a + itemCost(i), 0),
    }));
    const auw = cats.reduce((a, c) => a + c.wt, 0);
    const flagWt = (k) => onboard.filter((i) => i[k]).reduce((a, i) => a + itemWt(i), 0);
    const battW = flagWt('batt');
    const accW = flagWt('acc');
    const driveW = flagWt('batt') + flagWt('motor') + flagWt('esc') + flagWt('prop');
    const cells = num(s.battery.cells);
    const cellW = cells > 0 ? battW / cells : 0;

    const build = cats.reduce((a, c) => a + c.cost, 0);
    const tooling = s.tooling.reduce((a, i) => a + itemCost(i), 0);
    const offboard = s.offboard.reduce((a, i) => a + itemCost(i), 0);
    const toProcure = onboard.concat(s.tooling).filter((i) => !i.procured).reduce((a, i) => a + spendToBuy(i), 0);

    const V = num(s.elec.vSupply);
    const perV = (w) => (V > 0 ? w / V : 0);
    const tree = powerTree(s);
    const hoverW = num(s.elec.hoverW);
    const motorI = perV(hoverW);
    const escLossW = hoverW * (1 - num(s.elec.escEff) / 100);
    const escLossI = perV(escLossW);
    const accI = perV(tree.outW);
    const totalI = motorI + escLossI + accI;
    const nMotors = onboard.filter((i) => i.motor).reduce((a, i) => a + num(i.qty), 0);

    const b = s.battery;
    const P = num(b.parallel) > 0 ? num(b.parallel) : 1;
    const packAh = num(b.capacity) / 1000 * P;
    const usableAh = packAh * num(b.maxDischarge) / 100;
    const maxContA = num(b.cCont) * packAh || null;
    const maxBurstA = num(b.cMax) * packAh || null;
    const packR = num(b.resistance) * cells / P;
    const sagV = totalI * packR;

    return {
      cats, auw, battW, accW, driveW, cells, cellW,
      ecalcIn: { auw, inclDrive: auw - accW, woBatt: auw - battW, woDrive: auw - driveW, drive: driveW, acc: accW },
      cost: { cats, build, tooling, offboard, other: tooling + offboard, toProcure },
      elec: {
        V, tree, supplies: flatSupplies(tree), hoverW, motorI, escLossW, escLossI, accW: tree.outW, accI, totalI,
        nMotors, perMotorA: nMotors > 0 ? motorI / nMotors : null,
        powerW: V * totalI,
        packAh, usableAh, energyWh: packAh * cells * num(b.cellV),
        flightMin: totalI > 0 ? usableAh / totalI * 60 : null,
        maxContA, maxBurstA, headroom: maxContA ? totalI / maxContA : null,
        sagV, vLoaded: V - sagV,
        twr: num(s.elec.thrustG) > 0 && auw > 0 ? nMotors * num(s.elec.thrustG) / auw : null,
      },
    };
  }

  // ---------------------------------------------------------------- import

  const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = COLS[m] + s; n = Math.floor((n - 1) / 26); } return s; }
  function colNumber(l) { let n = 0; for (const ch of l.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  const addr = (r, c) => colLetter(c) + r;

  // A plain grid of {v: value, f: formula} keyed by "r,c". Values are the
  // cached results for formula cells when the file carries them.
  function gridFromExcelJS(ws) {
    const cells = new Map();
    let maxR = 0, maxC = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
        let v = cell.value, f = null;
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          if ('formula' in v || 'sharedFormula' in v) {
            f = v.formula || null;
            if (!f && v.sharedFormula) { try { f = cell.formula; } catch (e) { f = null; } }
            v = v.result;
            if (v && typeof v === 'object' && 'error' in v) v = undefined;
          } else if ('richText' in v) v = v.richText.map((t) => t.text).join('');
          else if ('text' in v) v = v.text;
          else if ('error' in v) v = undefined;
          else v = undefined;
        }
        if (v === undefined && !f) return;
        cells.set(r + ',' + c, { v, f });
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      });
    });
    return { cells, maxR, maxC };
  }

  // Tiny evaluator for formulas without cached results: numbers, cell refs,
  // + - * / and parentheses, plus SUM over a range. Anything else gives null.
  function evalFormula(g, f, depth) {
    if (depth > 20) return null;
    const src = f.replace(/^=/, '').replace(/\$/g, '');
    let i = 0;
    const peek = () => src[i];
    const ws = () => { while (src[i] === ' ') i++; };
    function value(r, c) {
      const cell = g.cells.get(r + ',' + c);
      if (!cell) return 0;
      if (isNum(cell.v)) return cell.v;
      if (cell.v === true) return 1;
      if (cell.v === false) return 0;
      if (cell.f) { const x = evalFormula(g, cell.f, depth + 1); return x == null ? NaN : x; }
      return 0;
    }
    function primary() {
      ws();
      if (peek() === '(') { i++; const v = expr(); ws(); if (peek() === ')') i++; return v; }
      if (peek() === '-') { i++; return -primary(); }
      let m = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/i.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        let t = 0;
        for (let r = +m[2]; r <= +m[4]; r++) for (let c = colNumber(m[1]); c <= colNumber(m[3]); c++) t += value(r, c);
        return t;
      }
      m = /^([A-Z]+)(\d+)/i.exec(src.slice(i));
      if (m) { i += m[0].length; return value(+m[2], colNumber(m[1])); }
      m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i));
      if (m) { i += m[0].length; return parseFloat(m[0]); }
      throw new Error('unsupported');
    }
    function term() { let v = primary(); ws(); while (peek() === '*' || peek() === '/') { const op = src[i++]; const w = primary(); v = op === '*' ? v * w : v / w; ws(); } return v; }
    function expr() { let v = term(); ws(); while (peek() === '+' || peek() === '-') { const op = src[i++]; const w = term(); v = op === '+' ? v + w : v - w; ws(); } return v; }
    try { const v = expr(); ws(); return i === src.length && isFinite(v) ? v : null; } catch (e) { return null; }
  }

  function parseGrid(g, sheetName) {
    const cell = (r, c) => g.cells.get(r + ',' + c);
    const raw = (r, c) => { const x = cell(r, c); return x ? x.v : undefined; };
    const text = (r, c) => { const v = raw(r, c); return v == null ? '' : typeof v === 'string' ? v : String(v); };
    const numAt = (r, c) => {
      const x = cell(r, c);
      if (!x) return null;
      if (isNum(x.v)) return x.v;
      if (typeof x.v === 'string') { const m = /-?\d*\.?\d+/.exec(x.v.replace(/,/g, '')); return m && /^\s*[-\d.$]/.test(x.v) ? parseFloat(m[0]) : null; }
      if (x.v == null && x.f) return evalFormula(g, x.f, 0);
      return null;
    };
    const bool = (r, c) => { const v = raw(r, c); return v === true || (typeof v === 'string' && /^(true|yes|y|x|✓|✔|1)$/i.test(v.trim())); };
    const isBlank = (r, c) => { const v = raw(r, c); return v == null || (typeof v === 'string' && v.trim() === ''); };
    const find = (re, pred) => {
      for (let r = 1; r <= g.maxR; r++) for (let c = 1; c <= g.maxC; c++) {
        const v = raw(r, c);
        if (typeof v === 'string' && re.test(v.trim()) && (!pred || pred(r, c))) return { r, c };
      }
      return null;
    };
    const findAll = (re) => {
      const out = [];
      for (let r = 1; r <= g.maxR; r++) for (let c = 1; c <= g.maxC; c++) {
        const v = raw(r, c);
        if (typeof v === 'string' && re.test(v.trim())) out.push({ r, c, t: v.trim() });
      }
      return out;
    };
    // First non-empty value to the right of a label (within a few cells).
    const rightOf = (p, span) => {
      if (!p) return null;
      for (let c = p.c + 1; c <= p.c + (span || 3); c++) { const n = numAt(p.r, c); if (n != null) return n; if (!isBlank(p.r, c)) return null; }
      return null;
    };
    const rightText = (p) => {
      if (!p) return '';
      for (let c = p.c + 1; c <= p.c + 3; c++) if (!isBlank(p.r, c)) return text(p.r, c);
      return '';
    };

    const s = newState();
    s.categories = [];
    s.battery.fieldNotes = {};
    if (sheetName) s.meta.title = sheetName;

    // ---- BOM sections
    const leftCol = (r, c) => c <= 3;
    const tOn = find(/^onboard bom$/i, leftCol);
    const tOff = find(/^offboard bom$/i, leftCol);
    const tTool = find(/^tooling$/i, leftCol);
    const headerAfter = (r0, c0) => {
      for (let r = r0; r <= Math.min(g.maxR, r0 + 4); r++) if (/^component$/i.test(text(r, c0).trim())) return r;
      return null;
    };
    const baseCol = tOn ? tOn.c : 1;
    let hdrOn = tOn ? headerAfter(tOn.r + 1, baseCol) : null;
    if (!hdrOn) { const h = find(/^component$/i, (r, c) => c <= 3); hdrOn = h ? h.r : null; }
    if (!hdrOn) throw new Error('Could not find the BOM header row (a "Component" column heading).');

    const COLMAP = [
      ['component', /^component/], ['confirmed', /^confirm/], ['part', /^part/], ['qty', /^(qty|quantity)/],
      ['acc', /^accessor/], ['batt', /^batter/], ['motor', /^motor/], ['esc', /^esc/], ['prop', /^prop/],
      ['notes', /^notes?/], ['unitWt', /^unit\s*w/], ['totalWt', /^total\s*w/], ['fullPrice', /^(full|pack)\s*price/],
      ['unitPrice', /^(item|unit)\s*price/], ['cost', /^cost/], ['reqSent', /^request/], ['procured', /^procured/], ['store', /^(store|supplier|vendor)/],
    ];
    const DEFAULT_COLS = { component: 1, confirmed: 2, part: 3, qty: 4, acc: 5, batt: 6, motor: 7, esc: 8, prop: 9, notes: 10, unitWt: 11, totalWt: 12, fullPrice: 13, unitPrice: 14, cost: 15, reqSent: 16, procured: 17, store: 18 };
    const col = Object.assign({}, DEFAULT_COLS);
    let lastCol = 18;
    for (let c = baseCol; c <= Math.min(g.maxC, baseCol + 25); c++) {
      const t = text(hdrOn, c).trim().toLowerCase();
      if (!t) continue;
      const hit = COLMAP.find(([, re]) => re.test(t));
      if (hit) { col[hit[0]] = c; lastCol = Math.max(lastCol, c); }
      const cur = /\(([A-Z]{3})\)/.exec(text(hdrOn, c));
      if (cur && hit && /price|cost/i.test(hit[0])) s.meta.currency = cur[1];
    }
    const FIRST = Math.min.apply(null, Object.values(col));

    function readItem(r, withFlags) {
      const it = newItem();
      it.component = text(r, col.component).trim();
      it.part = text(r, col.part).trim();
      it.confirmed = bool(r, col.confirmed);
      const q = numAt(r, col.qty);
      it.qty = q == null ? null : q;
      if (withFlags) FLAGS.forEach((f) => { it[f.key] = bool(r, col[f.key]); });
      it.notes = text(r, col.notes).replace(/\s+$/, '');
      const kw = raw(r, col.unitWt);
      const kn = numAt(r, col.unitWt);
      it.unitWt = isNum(kw) || (kw == null && kn != null) ? kn : kw == null ? null : String(kw).trim() || null;
      const full = numAt(r, col.fullPrice);
      const unit = numAt(r, col.unitPrice);
      const cost = numAt(r, col.cost);
      if (full != null) {
        it.fullPrice = full;
        if (unit != null && unit > 0) {
          const ratio = full / unit;
          const k = Math.round(ratio);
          if (k >= 1 && Math.abs(ratio - k) < 1e-6) it.pack = k;
          else { it.fullPrice = unit; it.pack = 1; }
        }
      } else if (unit != null && !(cell(r, col.unitPrice).f && cell(r, col.unitPrice).v == null)) {
        it.fullPrice = unit;
      } else if (cost != null && num(it.qty) > 0) {
        it.fullPrice = cost / num(it.qty);
      }
      if (it.fullPrice === 0 && full == null) it.fullPrice = null;
      const ct = raw(r, col.cost);
      if (typeof ct === 'string' && !isNum(numAt(r, col.cost))) it.costNote = ct.trim();
      it.reqSent = bool(r, col.reqSent);
      it.procured = bool(r, col.procured);
      it.store = text(r, col.store).trim();
      return it;
    }

    const sectionStarts = [tOff, tTool].filter(Boolean).map((p) => p.r);
    const endOf = (r0) => { const later = sectionStarts.filter((r) => r > r0); return later.length ? Math.min.apply(null, later) - 1 : g.maxR; };
    const rowEmpty = (r) => { for (let c = FIRST; c <= lastCol; c++) if (!isBlank(r, c)) return false; return true; };
    const isTotalRow = (r) => { for (let c = FIRST; c <= lastCol; c++) { const t = text(r, c).trim(); if (/subtotal|^total$/i.test(t)) return true; } return false; };
    const isCatRow = (r) => {
      if (isBlank(r, col.component)) return false;
      for (let c = FIRST; c <= lastCol; c++) if (c !== col.component && !isBlank(r, c)) return false;
      return true;
    };

    let cur = null;
    for (let r = hdrOn + 1; r <= endOf(hdrOn); r++) {
      if (rowEmpty(r) || isTotalRow(r)) continue;
      if (isCatRow(r)) { cur = newCategory(text(r, col.component).trim()); s.categories.push(cur); continue; }
      if (!cur) { cur = newCategory('GENERAL'); s.categories.push(cur); }
      cur.items.push(readItem(r, true));
    }
    if (!s.categories.length) s.categories.push(newCategory('GENERAL'));

    function readList(title) {
      if (!title) return [];
      const h = headerAfter(title.r + 1, title.c) || title.r + 1;
      const out = [];
      for (let r = h + 1; r <= endOf(h); r++) {
        if (rowEmpty(r) || isTotalRow(r) || isCatRow(r) && false) continue;
        out.push(readItem(r, false));
      }
      return out;
    }
    s.offboard = readList(tOff);
    s.tooling = readList(tTool);

    // ---- battery & system
    const cellsCell = find(/^no\.?\s*(of\s*)?cells$/i);
    const vCell = find(/^v\s*supplied/i);
    const effEsc = find(/^(η|eta|n)[_ ]?esc/i);
    const hover = find(/motors?\s+at\s+hover/i);
    if (vCell) s.elec.vSupply = rightOf(vCell, 1);
    if (effEsc) s.elec.escEff = rightOf(effEsc, 1);
    if (hover) s.elec.hoverW = rightOf(hover, 1);
    const escRating = find(/^esc rating/i);
    if (escRating) s.elec.escRatingA = rightOf(escRating, 1);
    const thrust = find(/^max thrust per motor/i);
    if (thrust) s.elec.thrustG = rightOf(thrust, 1);

    const fieldHdr = find(/^field$/i, (r, c) => /^value$/i.test(text(r, c + 1).trim()));
    const fields = {};
    if (fieldHdr) {
      for (let r = fieldHdr.r + 1; r <= g.maxR; r++) {
        const lab = text(r, fieldHdr.c).trim();
        if (!lab) break;
        const f = BATTERY_FIELDS.find((x) => x.label.toLowerCase() === lab.toLowerCase());
        if (!f) continue;
        fields[f.key] = { v: raw(r, fieldHdr.c + 1), n: numAt(r, fieldHdr.c + 1), note: text(r, fieldHdr.c + 2).trim() };
        if (fields[f.key].note) s.battery.fieldNotes[f.key] = fields[f.key].note;
      }
    }
    const b = s.battery;
    if (fields.type && fields.type.v != null) b.type = String(fields.type.v).trim();
    if (fields.config && typeof fields.config.v === 'string') {
      const m = /(\d+)\s*S(?:\s*(\d+)\s*P)?/i.exec(fields.config.v);
      if (m) { b.cells = +m[1]; b.parallel = m[2] ? +m[2] : 1; }
    }
    if (cellsCell) { const n = rightOf(cellsCell, 1); if (n) b.cells = n; }
    if (fields.capacity && fields.capacity.n != null) b.capacity = fields.capacity.n;
    if (fields.maxDischarge && fields.maxDischarge.n != null) {
      const n = fields.maxDischarge.n;
      b.maxDischarge = n <= 1 && !/%/.test(String(fields.maxDischarge.v)) ? n * 100 : n;
    }
    if (fields.resistance && fields.resistance.n != null) b.resistance = /mΩ|mohm|milli/i.test(String(fields.resistance.v)) ? fields.resistance.n / 1000 : fields.resistance.n;
    if (fields.cellV && fields.cellV.n != null) b.cellV = fields.cellV.n;
    if (fields.cCont && fields.cCont.n != null) b.cCont = fields.cCont.n;
    if (fields.cMax && fields.cMax.n != null) b.cMax = fields.cMax.n;
    if (!vCell && b.cells && b.cellV) s.elec.vSupply = +(b.cells * b.cellV).toFixed(2);

    const free = find(/^for free version/i);
    if (free) b.freeSpec = text(free.r + 1, free.c).trim();
    const bn = find(/^notes:$/i);
    if (bn) {
      for (let r = bn.r + 1, gap = 0; r <= g.maxR && gap < 2; r++) {
        const t = text(r, bn.c).trim();
        if (t) { b.notes.push(t); gap = 0; } else gap++;
      }
    }

    // ---- power supplies and loads
    const supByName = new Map();
    const getSupply = (name) => {
      const key = name.trim().toLowerCase();
      if (key === 'battery' || key === 'batt' || key === '') return 'battery';
      if (!supByName.has(key)) { const sp = newSupply({ name: name.trim(), eff: 100, vout: 5 }); supByName.set(key, sp); s.supplies.push(sp); }
      return supByName.get(key).id;
    };
    const supBlock = find(/^power supplies$/i);
    const supLinks = [];
    if (supBlock) {
      for (let r = supBlock.r + 2; r <= g.maxR; r++) {
        const name = text(r, supBlock.c).trim();
        if (!name) break;
        const id = getSupply(name);
        const sp = s.supplies.find((x) => x.id === id);
        sp.vout = numAt(r, supBlock.c + 1);
        sp.maxA = numAt(r, supBlock.c + 2);
        supLinks.push({ sp, item: text(r, supBlock.c + 3).trim(), from: text(r, supBlock.c + 4).trim() });
      }
    }
    const cdTitle = find(/^current draw$/i);
    const loadHdr = find(/^i[_ ]?accessories$/i, cdTitle ? (r, c) => c === cdTitle.c : null);
    const loadLinks = [];
    const lossEff = {};
    if (loadHdr) {
      const c = loadHdr.c;
      for (let r = loadHdr.r + 1, gap = 0; r <= g.maxR && gap < 3; r++) {
        const lab = text(r, c).trim();
        if (/^sub-?total$/i.test(text(r, c + 1).trim()) || /^sub-?total$/i.test(lab) || /^inputs$/i.test(lab)) break;
        if (!lab) { gap++; continue; }
        gap = 0;
        const loss = /^(.*?)\s+loss\b.*?(?:η|eta|n)\s*=\s*(\d+(?:\.\d+)?)\s*%/i.exec(lab);
        if (/\bloss\b/i.test(lab)) { if (loss) lossEff[loss[1].trim().toLowerCase()] = +loss[2]; continue; }
        const m = /^(.*?)\s*\((?:via|from)\s+(.+?)\)\s*$/i.exec(lab);
        const ld = newLoad({ name: m ? m[1].trim() : lab, supply: m ? getSupply(m[2]) : 'battery', watts: numAt(r, c + 1) || 0 });
        s.loads.push(ld);
        loadLinks.push({ ld, item: text(r, c + 3).trim() });
      }
    }
    // Efficiencies from the Inputs block (η_ubec (%) etc.), then from loss labels.
    findAll(/^(η|eta)[_ ]?(.+?)\s*\(%\)$/i).forEach((p) => {
      const m = /^(?:η|eta)[_ ]?(.+?)\s*\(%\)$/i.exec(p.t);
      const key = m[1].trim().toLowerCase();
      if (key === 'esc') return;
      const sp = supByName.get(key);
      if (sp) sp.eff = rightOf(p, 1);
    });
    Object.keys(lossEff).forEach((k) => { const sp = supByName.get(k); if (sp && (sp.eff == null || sp.eff === 100)) sp.eff = lossEff[k]; });
    s.supplies.forEach((sp) => { if (sp.eff == null) sp.eff = 100; });

    // Link supplies and loads to BOM items: exact label first, then by shared words.
    const items = allItems(s);
    const GENERIC = new Set(['via', 'the', 'and', 'for', 'module', 'sensor', 'radio', 'board', 'kit', 'cable', 'x2', 'male', 'female']);
    const words = (t) => (t || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !GENERIC.has(w));
    const matchItem = (label, name) => {
      if (label) { const ex = items.find((it) => itemLabel(it).toLowerCase() === label.toLowerCase() || it.component.toLowerCase() === label.toLowerCase()); if (ex) return ex.id; }
      const want = words(name);
      let best = null, bestScore = 0;
      items.forEach((it) => {
        const have = new Set(words(it.component + ' ' + it.part));
        const score = want.filter((w) => have.has(w)).length;
        if (score > bestScore) { best = it; bestScore = score; }
      });
      if (best) return best.id;
      if (/\bbec\b|ubec|buck|regulat/i.test(name)) { const it = items.find((x) => /\bbec\b|ubec|buck|regulat/i.test(x.component + ' ' + x.part)); if (it) return it.id; }
      return null;
    };
    loadLinks.forEach(({ ld, item }) => { ld.itemId = item === '-' ? null : matchItem(item, ld.name); });
    s.supplies.forEach((sp) => { const l = supLinks.find((x) => x.sp === sp); sp.itemId = matchItem(l && l.item, sp.name); });
    supLinks.forEach(({ sp, from }) => { if (from) { const id = getSupply(from); sp.from = id === sp.id ? 'battery' : id; } });
    // Guess output voltage and current limit from item notes ("5V 3A") when not given.
    s.supplies.forEach((sp) => {
      if (supLinks.some((x) => x.sp === sp)) return;
      const it = items.find((x) => x.id === sp.itemId);
      const t = it ? it.notes + ' ' + it.part : '';
      const m = /\bto\s+(\d+(?:\.\d+)?)\s*V\b|(\d+(?:\.\d+)?)\s*V\s+\d+(?:\.\d+)?\s*A\b/i.exec(t);
      if (m) sp.vout = +(m[1] || m[2]);
      const a = /\d\s*V\s+(\d+(?:\.\d+)?)\s*A\b/i.exec(t);
      if (a) sp.maxA = +a[1];
    });

    // ---- eCalc outputs and checks
    const outBlock = find(/^ecalc outputs$/i);
    if (outBlock) {
      for (let r = outBlock.r + 1; r <= Math.min(g.maxR, outBlock.r + 20); r++) {
        const lab = text(r, outBlock.c).trim().toLowerCase();
        const f = ECALC_OUTPUTS.find((x) => x.label.toLowerCase() === lab);
        if (!f) continue;
        const v = numAt(r, outBlock.c + 1);
        if (f.key === 'hoverW') { if (v != null) s.elec.hoverW = v; } else s.ecalc[f.key] = v;
      }
    }
    const rep = find(/^ecalc'?s output \(g\)$/i);
    if (rep && s.ecalc.auw == null) s.ecalc.auw = rightOf(rep);

    // ---- free notes (a NOTES heading outside the BOM header rows)
    const bomHeaderRows = new Set([hdrOn]);
    [tOff, tTool].forEach((t) => { if (t) bomHeaderRows.add(headerAfter(t.r + 1, t.c)); });
    const nh = find(/^notes$/i, (r) => !bomHeaderRows.has(r));
    if (nh) {
      for (let r = nh.r + 1; r <= g.maxR; r++) {
        const t = text(r, nh.c).trim();
        if (t) s.notes.push(t);
      }
    }
    return normalize(s);
  }

  async function importXlsx(ExcelJS, buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    if (!wb.worksheets.length) throw new Error('The file has no sheets.');
    const ws = wb.worksheets.find((w) => {
      let hit = false;
      w.eachRow((row) => { row.eachCell((c) => { if (typeof c.value === 'string' && /^onboard bom$/i.test(c.value.trim())) hit = true; }); });
      return hit;
    }) || wb.worksheets[0];
    return parseGrid(gridFromExcelJS(ws), ws.name);
  }

  // ---------------------------------------------------------------- export

  const C = { dark: 'FF434343', mid: 'FFCCCCCC', light: 'FFEFEFEF', white: 'FFFFFFFF' };
  const FMT = { wt: '#,##0.0', money: '"$"#,##0.00', amps: '0.000', w: '0.00' };
  const COL_WIDTHS = { A: 22.43, B: 8.71, C: 24.29, D: 7, E: 5.86, J: 43.29, K: 12.29, L: 30, M: 15.71, N: 15.43, O: 12, P: 19, Q: 8.71, T: 16, U: 14.71, V: 4, W: 30, X: 15, Y: 17.29, Z: 26, AA: 14, AB: 31, AC: 14.43, AD: 22, AG: 30, AH: 14, AY: 60 };

  function titleCase(name) {
    return String(name || '').toLowerCase().split(/\s+/).map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
  }
  const sheetSafe = (t) => (String(t || 'BOM').replace(/[\[\]:*?/\\]/g, '-').trim() || 'BOM').slice(0, 31);
  const fmtNum = (n) => (Math.round(n * 100) / 100).toString();

  function buildWorkbook(ExcelJS, state) {
    const s = normalize(state);
    const cur = s.meta.currency || 'AUD';
    const wb = new ExcelJS.Workbook();
    wb.creator = 'BOM Builder';
    const ws = wb.addWorksheet(sheetSafe(s.meta.title), { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] });
    Object.keys(COL_WIDTHS).forEach((k) => { ws.getColumn(k).width = COL_WIDTHS[k]; });

    const put = (a, v, st) => {
      const cl = ws.getCell(a);
      if (typeof v === 'string' && v.startsWith('=')) cl.value = { formula: v.slice(1) };
      else cl.value = v === undefined ? null : v;
      st = st || {};
      const font = { name: 'Calibri', size: st.size || 10 };
      if (st.bold) font.bold = true;
      if (st.fill === 'dark') font.color = { argb: C.white };
      cl.font = font;
      if (st.fill) cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C[st.fill] } };
      if (st.fmt) cl.numFmt = st.fmt;
      if (st.wrap) cl.alignment = { wrapText: true, vertical: 'top' };
      return cl;
    };
    const title = (a, v) => put(a, v, { bold: true, fill: 'dark', size: 12 });
    const hdr = (a, v) => put(a, v, { bold: true, fill: 'dark' });

    // ---- left: BOM sections
    const HEAD = ['Component', 'Confirmed', 'Part / Source', 'Qty', 'Accessory', 'Battery', 'Motors', 'ESC', 'Props', 'Notes', 'Unit Wt (g)', 'Total Wt (g)', 'Full Price (packs etc)', 'Item Price (' + cur + ')', 'Cost (' + cur + ')', 'Request Sent', 'Procured', 'Store'];
    const writeHeader = (r) => HEAD.forEach((h, i) => hdr(addr(r, i + 1), h));

    function writeItem(r, it, onboard) {
      put('A' + r, it.component || null, { bold: onboard });
      put('B' + r, !!it.confirmed);
      put('C' + r, it.part || null);
      put('D' + r, it.qty == null || it.qty === '' ? null : num(it.qty));
      if (onboard) FLAGS.forEach((f, i) => put(addr(r, 5 + i), !!it[f.key]));
      put('J' + r, it.notes || null, { wrap: true });
      const wtNum = isNum(it.unitWt) || (typeof it.unitWt === 'string' && it.unitWt.trim() !== '' && isFinite(+it.unitWt));
      if (wtNum) { put('K' + r, num(it.unitWt)); put('L' + r, '=K' + r + '*D' + r, { fmt: FMT.wt }); } else if (it.unitWt) {
        put('K' + r, String(it.unitWt));
        if (String(it.unitWt).trim() === '-') put('L' + r, '-');
      } else if (onboard) put('L' + r, '=K' + r + '*D' + r, { fmt: FMT.wt });
      const priced = it.fullPrice != null && it.fullPrice !== '';
      if (priced || (onboard && !it.costNote)) {
        if (priced) put('M' + r, num(it.fullPrice), { fmt: FMT.money });
        put('N' + r, packOf(it) > 1 ? '=M' + r + '/' + packOf(it) : '=M' + r, { fmt: FMT.money });
        put('O' + r, '=N' + r + '*D' + r, { fmt: FMT.money });
      } else if (it.costNote) put('O' + r, it.costNote);
      put('P' + r, !!it.reqSent);
      put('Q' + r, !!it.procured);
      put('R' + r, it.store || null);
      if (it.notes && it.notes.length > 60) ws.getRow(r).height = Math.min(120, 13 * Math.ceil(it.notes.length / 55));
    }

    title('A1', 'ONBOARD BOM');
    title('P1', 'PROCUREMENT');
    writeHeader(2);
    let r = 3;
    const catRows = [];
    const priceRows = [];
    s.categories.forEach((cat, ci) => {
      if (ci > 0) r++;
      for (let c = 1; c <= 18; c++) put(addr(r, c), c === 1 ? cat.name : null, { bold: true, fill: 'mid' });
      r++;
      const a = r;
      cat.items.forEach((it) => { writeItem(r, it, true); priceRows.push({ r, it }); r++; });
      const b = r - 1;
      put('K' + r, String(cat.name).toUpperCase() + ' SUBTOTAL', { bold: true });
      put('L' + r, cat.items.length ? '=SUM(L' + a + ':L' + b + ')' : 0, { bold: true, fmt: FMT.wt });
      put('O' + r, cat.items.length ? '=SUM(O' + a + ':O' + b + ')' : 0, { bold: true, fmt: FMT.money });
      catRows.push({ name: cat.name, sub: r });
      r++;
    });
    const onA = 4, onB = Math.max(4, r - 1);

    function writeList(label, list, toolingRows) {
      r += 3;
      title('A' + r, label);
      r++;
      writeHeader(r);
      r++;
      const a = r;
      list.forEach((it) => { writeItem(r, it, false); if (toolingRows) toolingRows.push({ r, it }); r++; });
      const b = r - 1;
      put('L' + r, 'Total', { bold: true });
      put('O' + r, list.length ? '=SUM(O' + a + ':O' + b + ')' : 0, { bold: true, fmt: FMT.money });
      const total = r;
      r++;
      return total;
    }
    const offTotal = writeList('OFFBOARD BOM', s.offboard);
    const toolRows = [];
    const toolTotal = writeList('TOOLING', s.tooling, toolRows);

    // ---- breakdowns (T:U)
    title('T2', 'BREAKDOWNS');
    ws.mergeCells('T2:U2');
    hdr('T3', 'Weight'); hdr('U3', 'grams');
    let t = 4;
    const wtStart = t;
    catRows.forEach((c) => { put('T' + t, titleCase(c.name)); put('U' + t, '=L' + c.sub, { fmt: FMT.wt }); t++; });
    const wtEnd = t - 1;
    t++;
    const auwRow = t;
    put('T' + t, 'AUW', { bold: true, fill: 'light' });
    put('U' + t, catRows.length ? '=SUM(U' + wtStart + ':U' + wtEnd + ')' : 0, { fill: 'light', fmt: FMT.wt });
    t += 2;
    const battRow = t;
    put('T' + t, 'Batt W (g)'); put('U' + t, '=SUMIFS(L' + onA + ':L' + onB + ',F' + onA + ':F' + onB + ',TRUE)', { fmt: FMT.wt }); t++;
    const cellsRow = t;
    put('T' + t, 'No Cells'); put('U' + t, num(s.battery.cells)); t++;
    const cellWRow = t;
    put('T' + t, 'Cell W (g)'); put('U' + t, '=IFERROR(U' + battRow + '/U' + cellsRow + ',0)', { fmt: FMT.wt }); t += 2;
    hdr('T' + t, 'Cost'); hdr('U' + t, '(' + cur + ')'); t++;
    const cStart = t;
    catRows.forEach((c) => { put('T' + t, titleCase(c.name)); put('U' + t, '=O' + c.sub, { fmt: FMT.money }); t++; });
    put('T' + t, 'Total Build Cost', { bold: true, fill: 'light' });
    put('U' + t, catRows.length ? '=SUM(U' + cStart + ':U' + (t - 1) + ')' : 0, { fill: 'light', fmt: FMT.money });
    t += 2;
    // Whole packs still to buy for anything not yet procured.
    const spend = priceRows.concat(toolRows).filter((x) => x.it.fullPrice != null && x.it.fullPrice !== '').map(({ r: rr, it }) => {
      const pk = packOf(it);
      return 'IF(Q' + rr + ',0,' + (pk === 1 ? 'D' + rr : 'ROUNDUP(D' + rr + '/' + pk + ',0)') + '*M' + rr + ')';
    });
    put('T' + t, 'Still to procure', { bold: true, fill: 'light' });
    put('U' + t, spend.length ? '=' + spend.join('+') : 0, { fill: 'light', fmt: FMT.money });
    t += 2;
    hdr('T' + t, 'Other'); hdr('U' + t, '(' + cur + ')'); t++;
    const oStart = t;
    put('T' + t, 'Tooling'); put('U' + t, '=O' + toolTotal, { fmt: FMT.money }); t++;
    put('T' + t, 'Offboard'); put('U' + t, '=O' + offTotal, { fmt: FMT.money }); t++;
    put('T' + t, 'Total Other Cost', { bold: true, fill: 'light' });
    put('U' + t, '=SUM(U' + oStart + ':U' + (t - 1) + ')', { fill: 'light', fmt: FMT.money });

    // ---- current draw (W:Z)
    const tree = powerTree(s);
    const flat = flatSupplies(tree);
    title('W2', 'CURRENT DRAW');
    hdr('W3', 'Component'); hdr('X3', 'P (W) from spec'); hdr('Y3', 'I (A)'); hdr('Z3', 'BOM item');
    put('W4', 'Total System Current Draw');
    put('W5', 'Current draw required from battery');
    put('W7', 'I_motors', { bold: true, fill: 'mid' });
    // Rows below depend on how many loads there are; work them out first.
    const loadRows = [];
    let w = 18;
    const lossRowOf = new Map();
    const items = allItems(s);
    function layout(node) {
      const start = loadRows.length;
      node.loads.forEach((ld) => { loadRows.push({ kind: 'load', ld, node, r: w++ }); });
      node.kids.forEach((k) => layout(k));
      if (node.supply) {
        const refs = loadRows.slice(start).map((x) => x.r);
        const row = { kind: 'loss', node, r: w++, refs };
        loadRows.push(row);
        lossRowOf.set(node.supply.id, row);
      }
    }
    layout(tree);
    const accA = 18, accB = Math.max(18, w - 1);
    const accSub = w;
    const inputsHdr = accSub + 2;
    const vRow = inputsHdr + 1;
    const escRow = vRow + 1;
    const effRow = new Map();
    let ir = escRow + 1;
    flat.forEach((n) => { effRow.set(n.supply.id, ir++); });
    const escRatingRow = ir++;
    const thrustRow = ir++;
    const V = '$X$' + vRow;
    const hoverOutRow = 4 + ECALC_OUTPUTS.findIndex((x) => x.key === 'hoverW');

    put('W9', (computeMotorCount(s) || 4) + 'x Motors at hover');
    put('X9', '=AH' + hoverOutRow, { fmt: FMT.w });
    put('Y9', '=IFERROR(X9/' + V + ',0)', { fmt: FMT.amps });
    put('X11', 'Sub-Total', { bold: true }); put('Y11', '=Y9', { fmt: FMT.amps });
    put('W13', 'I_ESCloss', { bold: true, fill: 'mid' });
    put('W14', 'ESC loss  P*(1-η)'); put('X14', '=X9*(1-X' + escRow + '/100)', { fmt: FMT.w }); put('Y14', '=IFERROR(X14/' + V + ',0)', { fmt: FMT.amps });
    put('X15', 'Sub-Total', { bold: true }); put('Y15', '=Y14', { fmt: FMT.amps });
    put('W17', 'I_accessories', { bold: true, fill: 'mid' });
    loadRows.forEach((x) => {
      if (x.kind === 'load') {
        const sp = x.node.supply;
        put('W' + x.r, (x.ld.name || '(unnamed load)') + (sp ? ' (via ' + sp.name + ')' : ''));
        put('X' + x.r, num(x.ld.watts), { fmt: FMT.w });
        const it = items.find((i) => i.id === x.ld.itemId);
        put('Z' + x.r, it ? itemLabel(it) : null);
      } else {
        const sp = x.node.supply;
        put('W' + x.r, sp.name + ' loss (η=' + fmtNum(num(sp.eff) || 100) + '%)');
        const sum = x.refs.length ? 'SUM(' + x.refs.map((q) => 'X' + q).join(',') + ')' : '0';
        put('X' + x.r, '=' + sum + '*(1/(X' + effRow.get(sp.id) + '/100)-1)', { fmt: FMT.w });
      }
      put('Y' + x.r, '=IFERROR(X' + x.r + '/' + V + ',0)', { fmt: FMT.amps });
    });
    put('X' + accSub, 'Sub-Total', { bold: true });
    put('Y' + accSub, loadRows.length ? '=SUM(Y' + accA + ':Y' + accB + ')' : 0, { fmt: FMT.amps });
    put('Y4', '=Y11+Y15+Y' + accSub, { fmt: FMT.amps });

    put('W' + inputsHdr, 'Inputs', { bold: true, fill: 'mid' });
    put('W' + vRow, 'V Supplied (V)'); put('X' + vRow, num(s.elec.vSupply));
    put('Y' + vRow, 'For ' + num(s.battery.capacity) + 'mah ' + num(s.battery.cells) + 'S Lipo');
    put('W' + escRow, 'η_esc (%)'); put('X' + escRow, num(s.elec.escEff));
    flat.forEach((n) => { put('W' + effRow.get(n.supply.id), 'η_' + n.supply.name.toLowerCase() + ' (%)'); put('X' + effRow.get(n.supply.id), num(n.supply.eff) || 100); });
    put('W' + escRatingRow, 'ESC rating (A per motor)'); put('X' + escRatingRow, s.elec.escRatingA == null ? null : num(s.elec.escRatingA));
    put('W' + thrustRow, 'Max thrust per motor (g)'); put('X' + thrustRow, s.elec.thrustG == null ? null : num(s.elec.thrustG));

    let pr = thrustRow + 3;
    title('W' + pr, 'POWER SUPPLIES');
    pr++;
    hdr('W' + pr, 'Supply'); hdr('X' + pr, 'V out (V)'); hdr('Y' + pr, 'Max I (A)'); hdr('Z' + pr, 'BOM item'); hdr('AA' + pr, 'Fed from');
    pr++;
    flat.forEach((n) => {
      const sp = n.supply;
      const it = items.find((i) => i.id === sp.itemId);
      const par = supplyParent(s, sp);
      put('W' + pr, sp.name);
      put('X' + pr, sp.vout == null || sp.vout === '' ? null : num(sp.vout));
      put('Y' + pr, sp.maxA == null || sp.maxA === '' ? null : num(sp.maxA));
      put('Z' + pr, it ? itemLabel(it) : null);
      put('AA' + pr, par === 'battery' ? 'Battery' : s.supplies.find((x) => x.id === par).name);
      pr++;
    });

    // ---- eCalc inputs and battery spec (AB:AD)
    title('AB2', 'eCALC INPUTS');
    put('AB3', 'AUW', { fill: 'mid' }); put('AC3', '=U' + auwRow, { fill: 'mid', fmt: FMT.wt });
    put('AB4', 'Model Weight incl drive'); put('AC4', '=AC3-AC8', { fmt: FMT.wt });
    put('AB5', 'Model Weight w/o batt'); put('AC5', '=U' + auwRow + '-U' + battRow, { fmt: FMT.wt });
    put('AB6', 'Model Weight w/o drive'); put('AC6', '=U' + auwRow + '-AC7', { fmt: FMT.wt });
    put('AB7', 'Drive (mtrs, batt, esc, props)');
    put('AC7', '=' + ['F', 'G', 'H', 'I'].map((c) => 'SUMIFS(L' + onA + ':L' + onB + ',' + c + onA + ':' + c + onB + ',TRUE)').join('+'), { fmt: FMT.wt });
    put('AB8', 'Accessories'); put('AC8', '=SUMPRODUCT(--(E' + onA + ':E' + onB + '=TRUE),D' + onA + ':D' + onB + ',K' + onA + ':K' + onB + ')', { fmt: FMT.wt });
    hdr('AB10', 'I Draw'); hdr('AC10', 'A');
    put('AB11', 'I_accessory'); put('AC11', '=Y' + accSub, { fmt: FMT.amps });
    put('AB12', 'I_total'); put('AC12', '=Y4', { fmt: FMT.amps });
    hdr('AB13', 'Battery Spec');
    put('AB14', 'For Free Version of eCalcs', { bold: true, fill: 'light' });
    put('AB15', s.battery.freeSpec || freeSpecText(s));
    put('AB17', 'Custom specs for paid version', { bold: true, fill: 'light' });
    put('AB18', 'Field', { bold: true }); put('AC18', 'Value', { bold: true }); put('AD18', 'Notes', { bold: true });
    const b = s.battery;
    const fieldVals = {
      type: [b.type || 'Custom'],
      config: [num(b.cells) + 'S ' + (num(b.parallel) || 1) + 'P'],
      capacity: [num(b.capacity), '0 "mAh"'],
      maxDischarge: [num(b.maxDischarge) / 100, '0%'],
      resistance: [num(b.resistance), '0.000 "Ω"'],
      cellV: [num(b.cellV), '0.00 "V"'],
      cCont: [b.cCont == null ? null : num(b.cCont), '0 "C"'],
      cMax: [b.cMax == null ? null : num(b.cMax), '0 "C"'],
      cellWt: ['=U' + cellWRow, FMT.wt],
    };
    const fieldRow = {};
    BATTERY_FIELDS.forEach((f, i) => {
      const rr = 19 + i;
      fieldRow[f.key] = rr;
      put('AB' + rr, f.label);
      put('AC' + rr, fieldVals[f.key][0], { fmt: fieldVals[f.key][1] });
      put('AD' + rr, (b.fieldNotes && b.fieldNotes[f.key]) || null);
    });
    let nr = 19 + BATTERY_FIELDS.length + 1;
    if (b.notes.length) {
      put('AB' + nr, 'Notes:'); nr++;
      b.notes.forEach((n) => {
        put('AB' + nr, n, { wrap: true });
        ws.mergeCells('AB' + nr + ':AD' + nr);
        ws.getRow(nr).height = Math.min(160, 13 * Math.max(1, Math.ceil(n.length / 75)));
        nr++;
      });
    }

    // ---- eCalc outputs, AUW check, estimates (AG:AH)
    title('AG2', 'eCALC OUTPUTS');
    ws.mergeCells('AG2:AH2');
    hdr('AG3', 'Output'); hdr('AH3', 'Value');
    const outRow = {};
    ECALC_OUTPUTS.forEach((f, i) => {
      const rr = 4 + i;
      outRow[f.key] = rr;
      const v = f.key === 'hoverW' ? s.elec.hoverW : s.ecalc[f.key];
      put('AG' + rr, f.label);
      put('AH' + rr, v == null || v === '' ? null : num(v), { fmt: f.fmt });
    });
    let er = 4 + ECALC_OUTPUTS.length + 1;
    hdr('AG' + er, 'AUW check'); hdr('AH' + er, 'g'); er++;
    put('AG' + er, 'calculated input (g)'); put('AH' + er, '=AC3', { fmt: FMT.wt }); er++;
    put('AG' + er, "ecalc's output (g)"); put('AH' + er, '=IF(AH' + outRow.auw + '="","",AH' + outRow.auw + ')', { fmt: FMT.wt }); er++;
    put('AG' + er, 'difference (g)'); put('AH' + er, '=IF(AH' + outRow.auw + '="","",AH' + outRow.auw + '-AC3)', { fmt: FMT.wt }); er += 2;
    hdr('AG' + er, 'Estimates (from BOM)'); hdr('AH' + er, ''); er++;
    const P = num(b.parallel) || 1;
    const est = [
      ['Pack capacity (Ah)', '=AC' + fieldRow.capacity + '/1000*' + P, '0.00'],
      ['Usable capacity (Ah)', null, '0.00'],
      ['Hover current (A)', '=Y4', '0.00'],
      ['Hover flight time (min)', null, '0.0'],
      ['Max continuous current (A)', '=IF(AC' + fieldRow.cCont + '="","",AC' + fieldRow.cCont + '*AC' + fieldRow.capacity + '/1000*' + P + ')', '0.0'],
      ['Hover current / max continuous', null, '0.0%'],
      ['Voltage sag at hover (V)', '=Y4*AC' + fieldRow.resistance + '*U' + cellsRow + '/' + P, '0.00'],
      ['Hover power (W)', '=' + V + '*Y4', '0.0'],
      ['Thrust-weight ratio', '=IF(X' + thrustRow + '="","",' + (computeMotorCount(s) || 0) + '*X' + thrustRow + '/AC3)', '0.00'],
    ];
    const e0 = er;
    est[1][1] = '=AH' + e0 + '*AC' + fieldRow.maxDischarge;
    est[3][1] = '=IFERROR(AH' + (e0 + 1) + '/AH' + (e0 + 2) + '*60,"")';
    est[5][1] = '=IFERROR(AH' + (e0 + 2) + '/AH' + (e0 + 4) + ',"")';
    est.forEach(([lab, f, fmt]) => { put('AG' + er, lab); put('AH' + er, f, { fmt }); er++; });

    // ---- notes (AY)
    put('AY5', 'NOTES', { bold: true });
    s.notes.forEach((n, i) => put('AY' + (6 + i), n));
    return wb;
  }

  function computeMotorCount(s) { return allOnboard(s).filter((i) => i.motor).reduce((a, i) => a + num(i.qty), 0); }
  function freeSpecText(s) {
    const b = s.battery;
    return 'Lipo ' + num(b.capacity) + 'mah' + (b.cCont ? ' ' + num(b.cCont) + (b.cMax ? '/' + num(b.cMax) : '') + 'C' : '') + ' ' + num(b.cells) + 'S' + (num(b.parallel) > 1 ? num(b.parallel) + 'P' : '') + ' ' + num(b.maxDischarge) + '% discharge';
  }

  const api = {
    FLAGS, BATTERY_FIELDS, ECALC_OUTPUTS,
    uid, newItem, newCategory, newSupply, newLoad, newState, normalize,
    num, isNum, unitPrice, itemCost, itemWt, spendToBuy, allItems, allOnboard, itemLabel,
    supplyParent, loadSupply, powerTree, compute, freeSpecText, titleCase, sheetSafe,
    gridFromExcelJS, parseGrid, evalFormula, importXlsx, buildWorkbook, colLetter, colNumber,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BOMCore = api;
})(typeof self !== 'undefined' ? self : this);

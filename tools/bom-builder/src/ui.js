/* BOM Builder UI. Plain DOM, one state object, spreadsheet in and out. */
(function () {
  'use strict';
  const K = window.BOMCore;
  const root = document.getElementById('bom-builder');
  if (!root || !K) return;

  const STORE_KEY = 'bom-builder-draft-v1';
  const SAMPLE = window.BOM_SAMPLE ? K.normalize(JSON.parse(JSON.stringify(window.BOM_SAMPLE))) : K.newState();

  let S = loadDraft() || K.normalize(JSON.parse(JSON.stringify(SAMPLE)));
  let C = K.compute(S);
  let tab = 'parts';
  let undoSnap = null;
  let toastTimer = null;

  // ------------------------------------------------------------ helpers

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const n = K.num;
  const fx = (v, d) => (v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sym = () => ({ AUD: '$', USD: '$', NZD: '$', CAD: '$', GBP: '£', EUR: '€', JPY: '¥' }[S.meta.currency] || (S.meta.currency + ' '));
  const money = (v) => (v == null || !isFinite(v) ? '–' : sym() + fx(v, 2));
  const pct = (v, d) => (v == null || !isFinite(v) ? '–' : fx(v * 100, d == null ? 0 : d) + '%');
  const valAttr = (v) => (v == null ? '' : esc(v));
  const status = (ratio, warnAt, badAt) => (ratio == null ? '' : ratio >= badAt ? 'bad' : ratio >= warnAt ? 'warn' : 'good');

  function saveDraft() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); setSaved('Saved in this browser'); } catch (e) { setSaved('Not saved in this browser — download the spreadsheet to keep your work'); }
  }
  function loadDraft() {
    try { const raw = localStorage.getItem(STORE_KEY); return raw ? K.normalize(JSON.parse(raw)) : null; } catch (e) { return null; }
  }
  function setSaved(t) { const el = root.querySelector('[data-saved]'); if (el) el.textContent = t; }

  function findItem(id) {
    for (const c of S.categories) { const i = c.items.findIndex((x) => x.id === id); if (i >= 0) return { list: c.items, i, cat: c }; }
    for (const key of ['offboard', 'tooling']) { const i = S[key].findIndex((x) => x.id === id); if (i >= 0) return { list: S[key], i, key }; }
    return null;
  }
  const getItem = (id) => { const f = findItem(id); return f ? f.list[f.i] : null; };

  function target(kind, id) {
    switch (kind) {
      case 'item': return getItem(id);
      case 'cat': return S.categories.find((c) => c.id === id);
      case 'supply': return S.supplies.find((x) => x.id === id);
      case 'load': return S.loads.find((x) => x.id === id);
      case 'elec': return S.elec;
      case 'batt': return S.battery;
      case 'fnote': return S.battery.fieldNotes;
      case 'meta': return S.meta;
      case 'ecalc': return S.ecalc;
      default: return null;
    }
  }

  function snapshot() { undoSnap = JSON.stringify(S); }
  function toast(msg, opts) {
    opts = opts || {};
    const el = root.querySelector('[data-toast]');
    el.className = 'toast' + (opts.err ? ' err' : '');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (opts.undo && undoSnap ? '<button type="button" data-act="undo">Undo</button>' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, opts.err ? 9000 : 6000);
  }

  // ------------------------------------------------------------ rendering: shell

  function shell() {
    root.innerHTML = `
      <div class="top">
        <div class="brand">
          <span class="eyebrow">BOM Builder</span>
          <input class="title-input" id="bom-title" type="text" data-k="meta" data-f="title" value="${valAttr(S.meta.title)}" aria-label="Build name">
        </div>
        <div class="actions">
          <button type="button" class="btn" data-act="import">Open spreadsheet</button>
          <button type="button" class="btn primary" data-act="export">Download spreadsheet</button>
          <button type="button" class="btn ghost" data-act="example">Load example</button>
          <button type="button" class="btn ghost" data-act="blank">Start blank</button>
          <input type="file" id="bom-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
          <span class="saved" data-saved></span>
        </div>
      </div>
      <div class="gauges" data-panel="gauges"></div>
      <div class="tabs" role="tablist" data-panel="tabs"></div>
      <div data-panel="body"></div>
      <div class="toast" data-toast hidden></div>
      <div class="footer">
        <span>Drop an .xlsx file anywhere here to open it. Nothing is uploaded: files are read and written in your browser.</span>
        <span>Currency <select id="bom-currency" data-k="meta" data-f="currency" data-struct="1" style="width:auto">${['AUD', 'USD', 'NZD', 'CAD', 'GBP', 'EUR', 'JPY'].map((c) => `<option ${c === S.meta.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></span>
      </div>`;
  }

  function renderAll() {
    C = K.compute(S);
    const t = root.querySelector('#bom-title');
    if (t && document.activeElement !== t) t.value = S.meta.title;
    const cur = root.querySelector('#bom-currency');
    if (cur) cur.value = S.meta.currency;
    renderGauges();
    renderTabs();
    renderBody();
  }

  function refresh() {
    C = K.compute(S);
    renderGauges();
    renderTabs();
    root.querySelectorAll('[data-calc]').forEach((el) => { el.textContent = calcText(el.getAttribute('data-calc')); });
    root.querySelectorAll('[data-live]').forEach((el) => { const [name, arg] = el.getAttribute('data-live').split(':'); const fn = LIVE[name]; if (fn) el.innerHTML = fn(arg); });
  }

  function warnings() {
    const w = [];
    C.elec.supplies.forEach((nd) => { if (nd.util != null && nd.util >= 0.9) w.push(nd.supply.name + ' is at ' + pct(nd.util) + ' of its current rating'); });
    if (C.elec.headroom != null && C.elec.headroom >= 0.8) w.push('Hover current is ' + pct(C.elec.headroom) + ' of the battery continuous rating');
    const esc = escCheck();
    if (esc && esc.cls === 'bad') w.push(esc.text);
    return w;
  }

  function renderGauges() {
    const e = C.elec;
    const ft = e.flightMin;
    const w = warnings();
    const g = [
      ['All-up weight', fx(C.auw, 1), 'g', C.cats.length + ' sections, ' + K.allOnboard(S).length + ' parts', ''],
      ['Build cost', money(C.cost.build), '', 'plus ' + money(C.cost.other) + ' tooling & offboard', ''],
      ['Still to buy', money(C.cost.toProcure), '', K.allOnboard(S).concat(S.tooling).filter((i) => !i.procured).length + ' items not procured', ''],
      ['Hover current', fx(e.totalI, 2), 'A', fx(e.powerW, 0) + ' W at ' + fx(e.V, 1) + ' V', ''],
      ['Hover flight time', ft == null ? '–' : fx(ft, 1), ft == null ? '' : 'min', 'on ' + fx(e.usableAh, 2) + ' Ah usable', ft != null && ft < 5 ? 'is-warn' : ''],
      ['Power checks', w.length ? String(w.length) : 'OK', w.length ? (w.length === 1 ? 'issue' : 'issues') : '', w.length ? w[0] : S.supplies.length + ' supplies, ' + S.loads.length + ' loads', w.length ? 'is-bad' : ''],
    ];
    root.querySelector('[data-panel="gauges"]').innerHTML = g.map(([lab, big, unit, sub, cls]) =>
      `<div class="gauge ${cls}"><span class="lab">${esc(lab)}</span><span class="big">${esc(big)}${unit ? `<small>${esc(unit)}</small>` : ''}</span><span class="sub">${esc(sub)}</span></div>`).join('');
  }

  function renderTabs() {
    const w = warnings().length;
    const tabs = [['parts', 'Parts list'], ['power', 'Power & current'], ['ecalc', 'eCalc'], ['breakdown', 'Breakdown']];
    root.querySelector('[data-panel="tabs"]').innerHTML = tabs.map(([id, lab]) =>
      `<button type="button" class="tab" role="tab" id="bom-tab-${id}" aria-selected="${tab === id}" data-act="tab" data-id="${id}">${lab}${id === 'power' && w ? `<span class="count">${w}</span>` : ''}</button>`).join('');
  }

  function renderBody() {
    const body = root.querySelector('[data-panel="body"]');
    body.innerHTML = { parts: partsTab, power: powerTab, ecalc: ecalcTab, breakdown: breakdownTab }[tab]();
    body.querySelectorAll('textarea[data-grow]').forEach(grow);
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 240) + 'px'; }

  // ------------------------------------------------------------ calc text (live cells)

  function calcText(key) {
    const [what, id] = key.split(':');
    const it = id ? getItem(id) : null;
    switch (what) {
      case 'wt': return it ? (K.isNum(it.unitWt) || (typeof it.unitWt === 'string' && isFinite(+it.unitWt) && it.unitWt.trim() !== '') ? fx(K.itemWt(it), 1) : '–') : '';
      case 'unit': return it ? money(K.unitPrice(it)) : '';
      case 'cost': return it ? (K.unitPrice(it) == null ? (it.costNote ? '—' : '–') : money(K.itemCost(it))) : '';
      case 'catwt': { const c = C.cats.find((x) => x.id === id); return c ? fx(c.wt, 1) + ' g' : ''; }
      case 'catcost': { const c = C.cats.find((x) => x.id === id); return c ? money(c.cost) : ''; }
      case 'listcost': return money(S[id].reduce((a, i) => a + K.itemCost(i), 0));
      case 'listwt': return fx(S[id].reduce((a, i) => a + K.itemWt(i), 0), 1) + ' g';
      default: return '';
    }
  }

  // ------------------------------------------------------------ parts tab

  const ON_COLS = 21;
  const OFF_COLS = 15;
  function itemRow(it, onboard) {
    const linked = linksFor(it.id);
    const wt = typeof it.unitWt === 'number' ? it.unitWt : it.unitWt || '';
    return `<tr class="${it.procured ? 'is-procured' : ''}">
      <td class="sticky-col w-comp"><input type="text" id="c-${it.id}" data-k="item" data-id="${it.id}" data-f="component" value="${valAttr(it.component)}" placeholder="Component" aria-label="Component"></td>
      <td class="w-part"><input type="text" id="p-${it.id}" data-k="item" data-id="${it.id}" data-f="part" value="${valAttr(it.part)}" placeholder="Part / source" aria-label="Part or source"></td>
      <td class="w-qty"><input type="number" id="q-${it.id}" step="any" min="0" data-k="item" data-id="${it.id}" data-f="qty" data-t="num" value="${valAttr(it.qty)}" aria-label="Quantity"></td>
      <td class="w-num"><input type="text" class="numlike" id="w-${it.id}" inputmode="decimal" data-k="item" data-id="${it.id}" data-f="unitWt" data-t="wt" value="${valAttr(wt)}" placeholder="g" aria-label="Unit weight in grams"></td>
      <td class="calc" data-calc="wt:${it.id}">${calcText('wt:' + it.id)}</td>
      <td class="w-num"><input type="number" id="fp-${it.id}" step="any" min="0" data-k="item" data-id="${it.id}" data-f="fullPrice" data-t="num" value="${valAttr(it.fullPrice)}" placeholder="${sym().trim()}" aria-label="Pack price"></td>
      <td class="w-qty"><input type="number" id="pk-${it.id}" step="1" min="1" data-k="item" data-id="${it.id}" data-f="pack" data-t="num" value="${valAttr(it.pack)}" aria-label="Units per pack"></td>
      <td class="calc" data-calc="unit:${it.id}">${calcText('unit:' + it.id)}</td>
      <td class="calc" data-calc="cost:${it.id}" title="${valAttr(it.costNote)}">${calcText('cost:' + it.id)}</td>
      ${onboard ? K.FLAGS.map((f) => `<td class="c flagcol"><input type="checkbox" id="${f.key}-${it.id}" data-k="item" data-id="${it.id}" data-f="${f.key}" data-t="bool" ${it[f.key] ? 'checked' : ''} aria-label="${f.label}" title="${f.label}"></td>`).join('') : ''}
      <td class="c flagcol"><input type="checkbox" id="cf-${it.id}" data-k="item" data-id="${it.id}" data-f="confirmed" data-t="bool" ${it.confirmed ? 'checked' : ''} aria-label="Confirmed" title="Confirmed"></td>
      <td class="c flagcol"><input type="checkbox" id="rq-${it.id}" data-k="item" data-id="${it.id}" data-f="reqSent" data-t="bool" ${it.reqSent ? 'checked' : ''} aria-label="Request sent" title="Request sent"></td>
      <td class="c flagcol"><input type="checkbox" id="pr-${it.id}" data-k="item" data-id="${it.id}" data-f="procured" data-t="bool" data-struct="1" ${it.procured ? 'checked' : ''} aria-label="Procured" title="Procured"></td>
      <td class="w-store"><input type="text" id="st-${it.id}" data-k="item" data-id="${it.id}" data-f="store" value="${valAttr(it.store)}" placeholder="Store" aria-label="Store"></td>
      <td class="w-notes"><textarea id="n-${it.id}" rows="1" data-grow data-k="item" data-id="${it.id}" data-f="notes" placeholder="Notes" aria-label="Notes">${esc(it.notes)}</textarea></td>
      ${onboard ? `<td class="w-act">${linked}</td>` : ''}
      <td class="w-act">
        <button type="button" class="icon-btn" data-act="up-item" data-id="${it.id}" title="Move up" aria-label="Move up">↑</button>
        <button type="button" class="icon-btn" data-act="down-item" data-id="${it.id}" title="Move down" aria-label="Move down">↓</button>
        <button type="button" class="icon-btn danger" data-act="del-item" data-id="${it.id}" title="Delete part" aria-label="Delete part">✕</button>
      </td>
    </tr>`;
  }

  function linksFor(itemId) {
    const sup = S.supplies.filter((x) => x.itemId === itemId);
    const lds = S.loads.filter((x) => x.itemId === itemId);
    const chips = sup.map((x) => `<button type="button" class="chip link" data-act="tab" data-id="power" title="Power supply">⏚ ${esc(x.name)} ${fx(n(x.vout), 1)} V</button>`)
      .concat(lds.map((x) => `<button type="button" class="chip link" data-act="tab" data-id="power" title="Load">⚡ ${fx(n(x.watts), 2)} W</button>`));
    if (!chips.length) chips.push(`<button type="button" class="chip" data-act="item-load" data-id="${itemId}" title="Add this part as a power load">+ load</button><button type="button" class="chip" data-act="item-supply" data-id="${itemId}" title="Use this part as a power supply">+ supply</button>`);
    return `<div class="chip-row">${chips.join('')}</div>`;
  }

  function headRow(onboard) {
    return `<tr>
      <th class="sticky-col">Component</th><th>Part / Source</th><th class="r">Qty</th><th class="r">Unit g</th><th class="r">Total g</th>
      <th class="r">Pack price</th><th class="r" title="Units per pack">/pack</th><th class="r">Unit price</th><th class="r">Cost</th>
      ${onboard ? K.FLAGS.map((f) => `<th class="c" title="${f.label}">${f.short}</th>`).join('') : ''}
      <th class="c" title="Confirmed">Conf</th><th class="c" title="Request sent">Req</th><th class="c" title="Procured">Got</th>
      <th>Store</th><th>Notes</th>${onboard ? '<th>Power link</th>' : ''}<th></th></tr>`;
  }

  function partsTab() {
    const cats = S.categories.map((c, ci) => `
      <tr class="cat"><td colspan="${ON_COLS}"><div class="cat-inner">
        <input type="text" class="cat-name" id="cat-${c.id}" data-k="cat" data-id="${c.id}" data-f="name" value="${valAttr(c.name)}" aria-label="Section name">
        <span class="num muted" data-calc="catwt:${c.id}">${calcText('catwt:' + c.id)}</span>
        <span class="num muted" data-calc="catcost:${c.id}">${calcText('catcost:' + c.id)}</span>
        <span>
          <button type="button" class="icon-btn" data-act="up-cat" data-id="${c.id}" ${ci === 0 ? 'disabled' : ''} title="Move section up" aria-label="Move section up">↑</button>
          <button type="button" class="icon-btn" data-act="down-cat" data-id="${c.id}" ${ci === S.categories.length - 1 ? 'disabled' : ''} title="Move section down" aria-label="Move section down">↓</button>
          <button type="button" class="icon-btn danger" data-act="del-cat" data-id="${c.id}" title="Delete section" aria-label="Delete section">✕</button>
        </span>
      </div></td></tr>
      ${c.items.map((it) => itemRow(it, true)).join('')}
      <tr class="add"><td colspan="${ON_COLS}"><div class="add-inner"><button type="button" class="btn sm" data-act="add-item" data-id="${c.id}">+ Add part to ${esc(K.titleCase(c.name))}</button></div></td></tr>`).join('');

    const list = (key, label, hint) => `
      <section>
        <div class="section-head"><h2>${label}</h2><span class="meta">${hint} · <span data-calc="listcost:${key}">${calcText('listcost:' + key)}</span></span></div>
        <div class="tbl-wrap"><table class="grid"><thead>${headRow(false)}</thead><tbody>
          ${S[key].length ? S[key].map((it) => itemRow(it, false)).join('') : `<tr class="empty"><td colspan="${OFF_COLS}">Nothing here yet.</td></tr>`}
          <tr class="add"><td colspan="${OFF_COLS}"><div class="add-inner"><button type="button" class="btn sm" data-act="add-item" data-id="${key}">+ Add to ${label.toLowerCase()}</button></div></td></tr>
        </tbody></table></div>
      </section>`;

    return `<div class="stack">
      <section>
        <div class="section-head">
          <h2>Onboard BOM</h2>
          <span class="meta">Everything that flies. Tick Acc/Bat/Mot/ESC/Prop so the eCalc weights split correctly.</span>
        </div>
        <div class="tbl-wrap"><table class="grid"><thead>${headRow(true)}</thead><tbody>${cats}</tbody></table></div>
        <div style="margin-top:10px"><button type="button" class="btn sm" data-act="add-cat">+ Add section</button></div>
      </section>
      ${list('offboard', 'Offboard BOM', 'Ground station, radios and anything that stays on the ground')}
      ${list('tooling', 'Tooling', 'Tools and consumables for the build')}
    </div>`;
  }

  // ------------------------------------------------------------ power tab

  function itemOptions(sel) {
    const opts = ['<option value="">— not linked —</option>'];
    S.categories.forEach((c) => {
      opts.push(`<optgroup label="${esc(K.titleCase(c.name))}">` + c.items.map((it) => `<option value="${it.id}" ${it.id === sel ? 'selected' : ''}>${esc(K.itemLabel(it))}</option>`).join('') + '</optgroup>');
    });
    return opts.join('');
  }
  function supplyOptions(sel, exclude) {
    const blocked = new Set();
    if (exclude) { // a supply cannot be fed by itself or anything downstream of it
      blocked.add(exclude);
      let grew = true;
      while (grew) { grew = false; S.supplies.forEach((x) => { if (!blocked.has(x.id) && blocked.has(K.supplyParent(S, x))) { blocked.add(x.id); grew = true; } }); }
    }
    return `<option value="battery" ${sel === 'battery' || !sel ? 'selected' : ''}>Battery (${fx(n(S.elec.vSupply), 1)} V)</option>` +
      S.supplies.filter((x) => !blocked.has(x.id)).map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)} (${fx(n(x.vout), 1)} V)</option>`).join('');
  }

  function escCheck() {
    const e = C.elec;
    const rating = n(S.elec.escRatingA);
    if (!rating || e.perMotorA == null) return null;
    const maxPer = n(S.ecalc.maxA) && e.nMotors ? n(S.ecalc.maxA) / e.nMotors : null;
    if (maxPer != null) {
      const r = maxPer / rating;
      return { cls: status(r, 0.85, 1), text: 'ESC at full throttle: ' + fx(maxPer, 1) + ' A of ' + fx(rating, 0) + ' A per motor (' + pct(r) + ')' };
    }
    const r = e.perMotorA / rating;
    return { cls: status(r, 0.4, 0.6), text: 'ESC at hover: ' + fx(e.perMotorA, 1) + ' A of ' + fx(rating, 0) + ' A per motor (' + pct(r) + ')' };
  }

  const LIVE = {
    current() {
      const e = C.elec;
      return `<dl class="readout">
        <div><dt>${e.nMotors || 0}× motors at hover<small>${fx(e.hoverW, 1)} W ÷ ${fx(e.V, 1)} V</small></dt><dd>${fx(e.motorI, 3)} A</dd></div>
        <div><dt>ESC loss<small>P × (1 − ${fx(n(S.elec.escEff), 0)}%) = ${fx(e.escLossW, 2)} W</small></dt><dd>${fx(e.escLossI, 3)} A</dd></div>
        <div><dt>Accessories<small>${fx(e.accW, 2)} W incl. converter losses</small></dt><dd>${fx(e.accI, 3)} A</dd></div>
        <div class="total"><dt>Total from battery</dt><dd>${fx(e.totalI, 3)} A</dd></div>
      </dl>`;
    },
    battery() {
      const e = C.elec;
      const hr = e.headroom;
      const escc = escCheck();
      return `<dl class="readout">
        <div><dt>Pack capacity<small>${n(S.battery.cells)}S${n(S.battery.parallel) || 1}P · ${fx(e.energyWh, 1)} Wh</small></dt><dd>${fx(e.packAh, 2)} Ah</dd></div>
        <div><dt>Usable capacity<small>at ${fx(n(S.battery.maxDischarge), 0)}% max discharge</small></dt><dd>${fx(e.usableAh, 2)} Ah</dd></div>
        <div><dt>Hover flight time</dt><dd>${e.flightMin == null ? '–' : fx(e.flightMin, 1) + ' min'}</dd></div>
        <div><dt>Max continuous current<small>${S.battery.cCont ? fx(n(S.battery.cCont), 0) + 'C' : 'set the C-rating'}${e.maxBurstA ? ' · burst ' + fx(e.maxBurstA, 0) + ' A' : ''}</small></dt><dd>${e.maxContA ? fx(e.maxContA, 0) + ' A' : '–'}</dd></div>
        <div><dt>Hover draw vs continuous rating</dt><dd>${hr == null ? '–' : `<span class="chip ${status(hr, 0.5, 0.8)}">${pct(hr, 1)}</span>`}</dd></div>
        <div><dt>Voltage sag at hover<small>${fx(n(S.battery.resistance) * 1000, 1)} mΩ/cell</small></dt><dd>${fx(e.sagV, 2)} V → ${fx(e.vLoaded, 2)} V</dd></div>
        <div><dt>Hover power</dt><dd>${fx(e.powerW, 1)} W</dd></div>
        ${escc ? `<div><dt>ESC headroom<small>${esc(escc.text)}</small></dt><dd><span class="chip ${escc.cls}">${escc.cls === 'good' ? 'OK' : escc.cls === 'warn' ? 'Tight' : 'Over'}</span></dd></div>` : ''}
        ${e.twr != null ? `<div><dt>Thrust-to-weight<small>${e.nMotors} × ${fx(n(S.elec.thrustG), 0)} g ÷ ${fx(C.auw, 0)} g</small></dt><dd><span class="chip ${e.twr < 1.6 ? 'bad' : e.twr < 2 ? 'warn' : 'good'}">${fx(e.twr, 2)} : 1</span></dd></div>` : ''}
      </dl>`;
    },
    supW(id) { const nd = supNode(id); return nd ? fx(nd.outW, 2) + ' W' : ''; },
    supA(id) { const nd = supNode(id); return nd ? fx(nd.outA, 2) + ' A' : ''; },
    supLoss(id) { const nd = supNode(id); return nd ? fx(nd.lossW, 2) + ' W' : ''; },
    supU(id) {
      const nd = supNode(id);
      if (!nd) return '';
      const u = nd.util;
      return u == null ? '<span class="muted small">set max A</span>' : `<div class="meter ${status(u, 0.7, 0.9)}" title="${pct(u)}"><i style="width:${Math.min(100, u * 100)}%"></i></div><span class="small">${pct(u)} of ${fx(nd.maxA, 1)} A</span>`;
    },
    loadRail(id) {
      const l = S.loads.find((x) => x.id === id);
      if (!l) return '';
      const sp = K.loadSupply(S, l);
      const nd = sp === 'battery' ? null : supNode(sp);
      const railV = nd ? nd.vout : n(S.elec.vSupply);
      return (railV > 0 ? fx(n(l.watts) / railV, 3) : '–') + ' A @ ' + fx(railV, 1) + ' V';
    },
    loadBatt(id) { const l = S.loads.find((x) => x.id === id); return l && C.elec.V > 0 ? fx(n(l.watts) / C.elec.V, 3) + ' A' : '–'; },
    supplies() {
      if (!S.supplies.length) return `<tr class="empty"><td colspan="11">No power supplies yet. Add one for each BEC, buck converter or power module, then point loads at it.</td></tr>`;
      return C.elec.supplies.map((nd) => {
        const x = nd.supply;
        return `<tr>
          <td class="sticky-col w-comp"><input type="text" id="sn-${x.id}" data-k="supply" data-id="${x.id}" data-f="name" data-opts="1" value="${valAttr(x.name)}" aria-label="Supply name"></td>
          <td class="w-sel"><select id="si-${x.id}" data-k="supply" data-id="${x.id}" data-f="itemId" data-struct="1" aria-label="Linked BOM part">${itemOptions(x.itemId)}</select></td>
          <td class="w-sel"><select id="sf-${x.id}" data-k="supply" data-id="${x.id}" data-f="from" data-struct="1" aria-label="Fed from">${supplyOptions(x.from, x.id)}</select></td>
          <td class="w-num"><input type="number" id="sv-${x.id}" step="any" data-k="supply" data-id="${x.id}" data-f="vout" data-t="num" value="${valAttr(x.vout)}" aria-label="Output volts"></td>
          <td class="w-num"><input type="number" id="se-${x.id}" step="any" min="1" max="100" data-k="supply" data-id="${x.id}" data-f="eff" data-t="num" value="${valAttr(x.eff)}" aria-label="Efficiency percent"></td>
          <td class="w-num"><input type="number" id="sa-${x.id}" step="any" min="0" data-k="supply" data-id="${x.id}" data-f="maxA" data-t="num" value="${valAttr(x.maxA)}" placeholder="A" aria-label="Max output current"></td>
          <td class="calc" data-live="supW:${x.id}">${LIVE.supW(x.id)}</td>
          <td class="calc" data-live="supA:${x.id}">${LIVE.supA(x.id)}</td>
          <td style="min-width:130px;padding-top:9px" data-live="supU:${x.id}">${LIVE.supU(x.id)}</td>
          <td class="calc" data-live="supLoss:${x.id}">${LIVE.supLoss(x.id)}</td>
          <td class="w-act"><button type="button" class="icon-btn danger" data-act="del-supply" data-id="${x.id}" title="Delete supply" aria-label="Delete supply">✕</button></td>
        </tr>`;
      }).join('');
    },
    tree() {
      const t = C.elec.tree;
      const ldNode = (l) => `<li><div class="node ld"><span class="nm">${esc(l.name || '(unnamed load)')}</span><span class="val num">${fx(n(l.watts), 2)} W</span></div></li>`;
      const supNode = (nd) => {
        const u = nd.util;
        return `<li><div class="node sup"><span class="nm">${esc(nd.supply.name)}</span><span class="muted small">${fx(nd.vout, 1)} V · η ${fx(nd.eff, 0)}%</span>
          ${u != null ? `<span class="chip ${status(u, 0.7, 0.9)}">${fx(nd.outA, 2)} / ${fx(nd.maxA, 1)} A</span>` : ''}
          <span class="val num">${fx(nd.inW, 2)} W in</span></div>
          ${nd.loads.length || nd.kids.length ? `<ul>${nd.loads.map(ldNode).join('')}${nd.kids.map(supNode).join('')}</ul>` : ''}</li>`;
      };
      return `<div class="tree"><div class="node src"><span class="nm">Battery</span><span class="small">${n(S.battery.cells)}S · ${fx(n(S.elec.vSupply), 1)} V</span><span class="val num">${fx(t.outW + C.elec.hoverW + C.elec.escLossW, 1)} W</span></div>
        <ul>
          <li><div class="node ld"><span class="nm">Motors via ESC (hover)</span><span class="val num">${fx(C.elec.hoverW + C.elec.escLossW, 1)} W</span></div></li>
          ${t.loads.map(ldNode).join('')}${t.kids.map(supNode).join('')}
        </ul></div>`;
    },
  };

  function supNode(id) { return C.elec.supplies.find((x) => x.id === id); }

  function loadRow(l) {
    const sp = K.loadSupply(S, l);
    return `<tr>
      <td class="sticky-col w-comp"><input type="text" id="ln-${l.id}" data-k="load" data-id="${l.id}" data-f="name" value="${valAttr(l.name)}" placeholder="Load name" aria-label="Load name"></td>
      <td class="w-sel"><select id="li-${l.id}" data-k="load" data-id="${l.id}" data-f="itemId" data-struct="1" aria-label="Linked BOM part">${itemOptions(l.itemId)}</select></td>
      <td class="w-sel"><select id="ls-${l.id}" data-k="load" data-id="${l.id}" data-f="supply" data-struct="1" aria-label="Powered by">${supplyOptions(sp)}</select></td>
      <td class="w-num"><input type="number" id="lw-${l.id}" step="any" min="0" data-k="load" data-id="${l.id}" data-f="watts" data-t="num" value="${valAttr(l.watts)}" aria-label="Power in watts"></td>
      <td class="calc" data-live="loadRail:${l.id}">${LIVE.loadRail(l.id)}</td>
      <td class="calc" data-live="loadBatt:${l.id}">${LIVE.loadBatt(l.id)}</td>
      <td class="w-act"><button type="button" class="icon-btn danger" data-act="del-load" data-id="${l.id}" title="Delete load" aria-label="Delete load">✕</button></td>
    </tr>`;
  }

  function powerTab() {
    const b = S.battery, e = S.elec;
    const fld = (k, f, label, v, opts) => {
      opts = opts || {};
      return `<label class="field"><span>${label}</span><input type="${opts.text ? 'text' : 'number'}" id="${k}-${f}" ${opts.text ? '' : 'step="any"'} data-k="${k}" data-f="${f}" ${opts.text ? '' : 'data-t="num"'} ${opts.struct ? 'data-struct="1"' : ''} value="${valAttr(v)}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''}></label>`;
    };
    return `<div class="stack">
      <div class="cols">
        <section class="card">
          <header><h2>Battery</h2><span class="muted small">${esc(K.itemLabel(K.allOnboard(S).find((i) => i.batt)) || 'Tick “Bat” on the battery in the parts list')}</span></header>
          <div class="form">
            ${fld('batt', 'cells', 'Cells (S)', b.cells, { struct: 1 })}
            ${fld('batt', 'parallel', 'Parallel (P)', b.parallel)}
            ${fld('batt', 'capacity', 'Capacity (mAh)', b.capacity)}
            ${fld('batt', 'cellV', 'Nominal V / cell', b.cellV)}
            ${fld('batt', 'maxDischarge', 'Max discharge (%)', b.maxDischarge)}
            ${fld('batt', 'resistance', 'Resistance (Ω / cell)', b.resistance)}
            ${fld('batt', 'cCont', 'C-rate (cont)', b.cCont)}
            ${fld('batt', 'cMax', 'C-rate (max)', b.cMax)}
            <label class="field"><span>Supply voltage (V)</span><div class="with-btn"><input type="number" id="elec-vSupply" step="any" data-k="elec" data-f="vSupply" data-t="num" data-struct="1" value="${valAttr(e.vSupply)}"><button type="button" class="btn sm" data-act="v-nominal" title="Set to cells × nominal volts">${fx(n(b.cells) * n(b.cellV), 1)}</button></div></label>
          </div>
        </section>
        <section class="card">
          <header><h2>Drive</h2><span class="muted small">Hover power comes from your eCalc run</span></header>
          <div class="form">
            ${fld('elec', 'hoverW', 'Motors at hover (W)', e.hoverW, { ph: 'from eCalc' })}
            ${fld('elec', 'escEff', 'ESC efficiency (%)', e.escEff)}
            ${fld('elec', 'escRatingA', 'ESC rating (A / motor)', e.escRatingA, { ph: 'e.g. 65' })}
            ${fld('elec', 'thrustG', 'Max thrust / motor (g)', e.thrustG, { ph: 'optional' })}
          </div>
          <div data-live="current">${LIVE.current()}</div>
        </section>
        <section class="card">
          <header><h2>Battery checks</h2></header>
          <div data-live="battery">${LIVE.battery()}</div>
        </section>
      </div>

      <section>
        <div class="section-head"><h2>Power supplies</h2><span class="meta">BECs, buck converters and power modules. Link each to its part in the BOM.</span></div>
        <div class="tbl-wrap"><table class="grid">
          <thead><tr><th class="sticky-col">Supply</th><th>BOM part</th><th>Fed from</th><th class="r">V out</th><th class="r">η %</th><th class="r">Max A</th><th class="r">Load</th><th class="r">Out I</th><th>Utilisation</th><th class="r">Loss</th><th></th></tr></thead>
          <tbody>${LIVE.supplies()}</tbody>
        </table></div>
        <div style="margin-top:10px"><button type="button" class="btn sm" data-act="add-supply">+ Add power supply</button></div>
      </section>

      <section>
        <div class="section-head"><h2>Loads</h2><span class="meta">Electronics and what powers them. Watts from the spec sheet; current is worked out at the rail and at the battery.</span></div>
        <div class="tbl-wrap"><table class="grid">
          <thead><tr><th class="sticky-col">Load</th><th>BOM part</th><th>Powered by</th><th class="r">Power W</th><th class="r">At rail</th><th class="r">From battery</th><th></th></tr></thead>
          <tbody>${S.loads.length ? S.loads.map(loadRow).join('') : '<tr class="empty"><td colspan="7">No loads yet. Add the flight controller, companion computer, radios and sensors here.</td></tr>'}</tbody>
        </table></div>
        <div style="margin-top:10px"><button type="button" class="btn sm" data-act="add-load">+ Add load</button></div>
      </section>

      <section class="card">
        <header><h2>Power distribution</h2><span class="muted small">Watts drawn at each stage, losses included</span></header>
        <div data-live="tree">${LIVE.tree()}</div>
      </section>
    </div>`;
  }

  // ------------------------------------------------------------ eCalc tab

  function ecalcTab() {
    const ei = C.ecalcIn;
    const row = (label, sub, v, unit, d) => `<div><dt>${label}${sub ? `<small>${sub}</small>` : ''}</dt><dd>${fx(v, d == null ? 1 : d)} ${unit}<button type="button" class="icon-btn copy" data-act="copy" data-id="${fx(v, d == null ? 1 : d).replace(/,/g, '')}" title="Copy value" aria-label="Copy ${esc(label)}">⧉</button></dd></div>`;
    const b = S.battery;
    const bf = (key, label, inner) => `<tr><td>${label}</td><td class="w-num">${inner}</td><td><input type="text" id="fn-${key}" data-k="fnote" data-f="${key}" value="${valAttr(b.fieldNotes[key])}" placeholder="Notes" aria-label="${label} notes"></td></tr>`;
    const bnum = (f, v) => `<input type="number" id="eb-${f}" step="any" data-k="batt" data-f="${f}" data-t="num" value="${valAttr(v)}" aria-label="${f}">`;
    return `<div class="stack">
      <div class="cols">
        <section class="card">
          <header><h2>eCalc inputs</h2><span class="muted small">Weights in grams, from the parts list</span></header>
          <p class="hint">eCalc adds accessory weight on top of model weight. Enter <b>Model weight incl. drive</b> (AUW minus accessories) and the accessories separately, or eCalc will count them twice.</p>
          <dl class="readout">
            ${row('Model weight incl. drive', 'AUW − accessories', ei.inclDrive, 'g')}
            ${row('Accessories', 'parts ticked “Acc”', ei.acc, 'g')}
            ${row('Accessory current drain', 'all loads incl. converter losses', C.elec.accI, 'A', 2)}
            ${row('AUW', 'everything onboard', ei.auw, 'g')}
            ${row('Model weight w/o drive', 'AUW − battery, motors, ESC, props', ei.woDrive, 'g')}
            ${row('Model weight w/o battery', '', ei.woBatt, 'g')}
            ${row('Drive', 'battery + motors + ESC + props', ei.drive, 'g')}
            ${row('Battery cell weight', C.cells + ' cells', C.cellW, 'g')}
          </dl>
        </section>
        <section class="card">
          <header><h2>eCalc outputs</h2><span class="muted small">Copy these in after each run</span></header>
          <div class="form">
            ${K.ECALC_OUTPUTS.map((f) => {
              const k = f.key === 'hoverW' ? 'elec' : 'ecalc';
              const v = f.key === 'hoverW' ? S.elec.hoverW : S.ecalc[f.key];
              return `<label class="field"><span>${esc(f.label)}</span><input type="number" step="any" id="eo-${f.key}" data-k="${k}" data-f="${f.key}" data-t="num" value="${valAttr(v)}"></label>`;
            }).join('')}
          </div>
          <div data-live="auwcheck">${LIVE.auwcheck()}</div>
        </section>
      </div>
      <section class="card">
        <header><h2>Battery spec</h2><span class="muted small">Shared with the Power tab</span></header>
        <div class="cols">
          <div class="field"><span>For the free version of eCalc</span>
            <div class="with-btn"><input type="text" id="batt-freeSpec" data-k="batt" data-f="freeSpec" value="${valAttr(b.freeSpec)}" placeholder="${esc(K.freeSpecText(S))}"><button type="button" class="btn sm" data-act="gen-free">Fill in</button></div>
          </div>
        </div>
        <div class="tbl-wrap"><table class="grid">
          <thead><tr><th>Field (paid version)</th><th class="r">Value</th><th>Notes</th></tr></thead>
          <tbody>
            ${bf('type', 'Type', `<input type="text" id="eb-type" data-k="batt" data-f="type" value="${valAttr(b.type)}" aria-label="Type">`)}
            ${bf('config', 'Configuration', `<span class="num">${n(b.cells)}S ${n(b.parallel) || 1}P</span>`)}
            ${bf('capacity', 'Cell capacity (mAh)', bnum('capacity', b.capacity))}
            ${bf('maxDischarge', 'Max discharge (%)', bnum('maxDischarge', b.maxDischarge))}
            ${bf('resistance', 'Resistance (Ω)', bnum('resistance', b.resistance))}
            ${bf('cellV', 'Voltage (V / cell)', bnum('cellV', b.cellV))}
            ${bf('cCont', 'C-rate (cont)', bnum('cCont', b.cCont))}
            ${bf('cMax', 'C-rate (max)', bnum('cMax', b.cMax))}
            ${bf('cellWt', 'Weight (g / cell)', `<span class="num">${fx(C.cellW, 1)}</span>`)}
          </tbody>
        </table></div>
        <div>
          <h3 style="margin-bottom:8px">Battery notes</h3>
          ${noteList('bnote', b.notes, 'Add battery note')}
        </div>
      </section>
      <section class="card">
        <header><h2>Build notes</h2><span class="muted small">Saved to the NOTES column of the spreadsheet</span></header>
        ${noteList('note', S.notes, 'Add note')}
      </section>
    </div>`;
  }
  LIVE.auwcheck = function () {
    const rep = n(S.ecalc.auw);
    if (!rep) return '<p class="hint">Enter eCalc’s all-up weight to check it against the BOM.</p>';
    const diff = rep - C.auw;
    const r = Math.abs(diff) / (C.auw || 1);
    const cls = r > 0.05 ? 'bad' : r > 0.02 ? 'warn' : 'good';
    return `<dl class="readout">
      <div><dt>BOM all-up weight</dt><dd>${fx(C.auw, 1)} g</dd></div>
      <div><dt>eCalc all-up weight</dt><dd>${fx(rep, 1)} g</dd></div>
      <div class="total"><dt>Difference</dt><dd><span class="chip ${cls}">${diff > 0 ? '+' : ''}${fx(diff, 1)} g</span></dd></div>
    </dl>${cls === 'bad' && Math.abs(diff - C.accW) < Math.abs(diff) * 0.5 ? '<p class="hint">The gap is close to your accessory weight, which usually means accessories were counted twice. Re-run eCalc with model weight = AUW − accessories.</p>' : cls !== 'good' ? '<p class="hint">Weights in eCalc no longer match the BOM. Re-run eCalc with the inputs on the left.</p>' : ''}`;
  };

  function noteList(kind, arr, addLabel) {
    return `<div class="note-list">${arr.map((t, i) => `<div class="note"><textarea id="${kind}-${i}" rows="1" data-grow data-k="${kind}" data-id="${i}" aria-label="Note ${i + 1}">${esc(t)}</textarea><button type="button" class="icon-btn danger" data-act="del-${kind}" data-id="${i}" title="Delete note" aria-label="Delete note">✕</button></div>`).join('')}
      <div><button type="button" class="btn sm" data-act="add-${kind}">+ ${addLabel}</button></div></div>`;
  }

  // ------------------------------------------------------------ breakdown tab

  function bars(rows, fmt) {
    const max = Math.max.apply(null, rows.map((r) => r[1]).concat([0])) || 1;
    const tot = rows.reduce((a, r) => a + r[1], 0) || 1;
    return `<div class="bars">${rows.map(([lab, v]) => `<div class="bar-row"><span>${esc(lab)}</span><span class="track"><i style="width:${(v / max) * 100}%"></i></span><span class="v">${fmt(v)}<small>${pct(v / tot)}</small></span></div>`).join('')}</div>`;
  }
  function breakdownTab() {
    const onboard = K.allOnboard(S);
    const procured = onboard.filter((i) => i.procured).length;
    const requested = onboard.filter((i) => i.reqSent).length;
    const confirmed = onboard.filter((i) => i.confirmed).length;
    const noWt = onboard.filter((i) => !K.isNum(i.unitWt) && !(typeof i.unitWt === 'string' && i.unitWt.trim() !== '' && isFinite(+i.unitWt)));
    const noPrice = onboard.filter((i) => i.fullPrice == null || i.fullPrice === '');
    const flags = [['Battery', 'batt'], ['Motors', 'motor'], ['ESC', 'esc'], ['Props', 'prop'], ['Accessories', 'acc']].map(([l, k]) => [l, onboard.filter((i) => i[k]).reduce((a, i) => a + K.itemWt(i), 0)]);
    const unflagged = C.auw - flags.reduce((a, f) => a + f[1], 0);
    return `<div class="cols">
      <section class="card"><header><h2>Weight by section</h2><span class="num">${fx(C.auw, 1)} g AUW</span></header>${bars(C.cats.map((c) => [K.titleCase(c.name), c.wt]), (v) => fx(v, 1) + ' g')}</section>
      <section class="card"><header><h2>Cost by section</h2><span class="num">${money(C.cost.build)}</span></header>${bars(C.cats.map((c) => [K.titleCase(c.name), c.cost]), money)}
        <dl class="readout">
          <div><dt>Tooling</dt><dd>${money(C.cost.tooling)}</dd></div>
          <div><dt>Offboard</dt><dd>${money(C.cost.offboard)}</dd></div>
          <div class="total"><dt>Everything</dt><dd>${money(C.cost.build + C.cost.other)}</dd></div>
        </dl></section>
      <section class="card"><header><h2>Weight by role</h2><span class="muted small">From the Acc/Bat/Mot/ESC/Prop ticks</span></header>${bars(flags.concat([['Frame & other', Math.max(0, unflagged)]]), (v) => fx(v, 1) + ' g')}</section>
      <section class="card"><header><h2>Procurement</h2></header>
        <dl class="readout">
          <div><dt>Confirmed</dt><dd>${confirmed} / ${onboard.length}</dd></div>
          <div><dt>Request sent</dt><dd>${requested} / ${onboard.length}</dd></div>
          <div><dt>Procured</dt><dd>${procured} / ${onboard.length}</dd></div>
          <div class="total"><dt>Still to buy (incl. tooling)<small>whole packs at pack price</small></dt><dd>${money(C.cost.toProcure)}</dd></div>
        </dl>
        ${noWt.length ? `<p class="hint">No weight yet: ${noWt.map((i) => esc(i.component || i.part)).join(', ')}.</p>` : ''}
        ${noPrice.length ? `<p class="hint">No price yet: ${noPrice.map((i) => esc(i.component || i.part)).join(', ')}.</p>` : ''}
      </section>
    </div>`;
  }

  // ------------------------------------------------------------ events

  function parseVal(el) {
    const t = el.getAttribute('data-t');
    if (t === 'bool') return el.checked;
    if (t === 'num') return el.value === '' ? null : parseFloat(el.value);
    if (t === 'wt') { const v = el.value.trim(); return v === '' ? null : isFinite(+v) ? +v : v; }
    return el.value;
  }

  function onEdit(e) {
    const el = e.target;
    const kind = el.getAttribute && el.getAttribute('data-k');
    if (!kind) return;
    if (el.tagName === 'TEXTAREA' && el.hasAttribute('data-grow')) grow(el);
    const v = parseVal(el);
    if (kind === 'note' || kind === 'bnote') {
      const arr = kind === 'note' ? S.notes : S.battery.notes;
      arr[+el.getAttribute('data-id')] = v;
    } else {
      const obj = target(kind, el.getAttribute('data-id'));
      if (!obj) return;
      obj[el.getAttribute('data-f')] = v;
    }
    saveDraft();
    const structural = el.hasAttribute('data-struct') && e.type === 'change';
    if (structural) { const y = window.scrollY; renderAll(); window.scrollTo(0, y); } else refresh();
    if (el.hasAttribute('data-opts')) refreshSupplyOptions();
  }

  function refreshSupplyOptions() {
    root.querySelectorAll('select[data-f="supply"], select[data-f="from"]').forEach((sel) => {
      const isFrom = sel.getAttribute('data-f') === 'from';
      const obj = target(isFrom ? 'supply' : 'load', sel.getAttribute('data-id'));
      if (obj) sel.innerHTML = supplyOptions(isFrom ? obj.from : K.loadSupply(S, obj), isFrom ? obj.id : null);
    });
  }

  function moveItem(id, dir) {
    const f = findItem(id);
    if (!f) return;
    const j = f.i + dir;
    if (j >= 0 && j < f.list.length) { const [x] = f.list.splice(f.i, 1); f.list.splice(j, 0, x); return; }
    if (!f.cat) return; // offboard/tooling: stop at the ends
    const ci = S.categories.indexOf(f.cat) + dir;
    if (ci < 0 || ci >= S.categories.length) return;
    const [x] = f.list.splice(f.i, 1);
    if (dir < 0) S.categories[ci].items.push(x); else S.categories[ci].items.unshift(x);
  }

  function actions(act, id, btn) {
    switch (act) {
      case 'tab': tab = id; renderTabs(); renderBody(); try { localStorage.setItem(STORE_KEY + '-tab', tab); } catch (e) { /* ignore */ } return false;
      case 'import': root.querySelector('#bom-file').click(); return false;
      case 'export': exportXlsx(); return false;
      case 'example': snapshot(); S = K.normalize(JSON.parse(JSON.stringify(SAMPLE))); toast('Loaded the example build', { undo: true }); break;
      case 'blank': snapshot(); S = K.newState(); toast('Started a blank build', { undo: true }); break;
      case 'undo': if (undoSnap) { S = K.normalize(JSON.parse(undoSnap)); undoSnap = null; root.querySelector('[data-toast]').hidden = true; } break;
      case 'add-item': {
        const it = K.newItem();
        if (id === 'offboard' || id === 'tooling') S[id].push(it); else { const c = S.categories.find((x) => x.id === id); if (c) c.items.push(it); }
        commitStructure();
        const el = root.querySelector('#c-' + it.id);
        if (el) el.focus();
        return false;
      }
      case 'del-item': {
        const f = findItem(id);
        if (!f) return false;
        snapshot();
        const [gone] = f.list.splice(f.i, 1);
        S.loads.forEach((l) => { if (l.itemId === id) l.itemId = null; });
        S.supplies.forEach((x) => { if (x.itemId === id) x.itemId = null; });
        toast('Deleted ' + (gone.component || gone.part || 'part'), { undo: true });
        break;
      }
      case 'up-item': moveItem(id, -1); break;
      case 'down-item': moveItem(id, 1); break;
      case 'add-cat': { const c = K.newCategory('NEW SECTION'); S.categories.push(c); commitStructure(); const el = root.querySelector('#cat-' + c.id); if (el) { el.focus(); el.select(); } return false; }
      case 'del-cat': {
        const i = S.categories.findIndex((c) => c.id === id);
        if (i < 0) return false;
        snapshot();
        const [c] = S.categories.splice(i, 1);
        if (!S.categories.length) S.categories.push(K.newCategory('GENERAL'));
        toast('Deleted section ' + c.name + (c.items.length ? ' and its ' + c.items.length + ' parts' : ''), { undo: true });
        break;
      }
      case 'up-cat': case 'down-cat': {
        const i = S.categories.findIndex((c) => c.id === id), j = i + (act === 'up-cat' ? -1 : 1);
        if (i >= 0 && j >= 0 && j < S.categories.length) { const [c] = S.categories.splice(i, 1); S.categories.splice(j, 0, c); }
        break;
      }
      case 'add-supply': S.supplies.push(K.newSupply({ name: 'Supply ' + (S.supplies.length + 1) })); break;
      case 'del-supply': {
        snapshot();
        const sp = S.supplies.find((x) => x.id === id);
        S.supplies = S.supplies.filter((x) => x.id !== id);
        S.loads.forEach((l) => { if (l.supply === id) l.supply = sp ? sp.from : 'battery'; });
        S.supplies.forEach((x) => { if (x.from === id) x.from = sp ? sp.from : 'battery'; });
        toast('Deleted ' + (sp ? sp.name : 'supply') + '. Its loads now draw from what fed it.', { undo: true });
        break;
      }
      case 'add-load': S.loads.push(K.newLoad({ name: '' })); break;
      case 'del-load': snapshot(); S.loads = S.loads.filter((x) => x.id !== id); toast('Deleted load', { undo: true }); break;
      case 'item-load': {
        const it = getItem(id);
        S.loads.push(K.newLoad({ name: it ? it.component || it.part : '', itemId: id, watts: 0 }));
        tab = 'power';
        toast('Added ' + (it ? it.component || it.part : 'part') + ' as a load. Enter its power in watts.');
        break;
      }
      case 'item-supply': {
        const it = getItem(id);
        const m = it ? /(\d+(?:\.\d+)?)\s*V\b(?:\s+(\d+(?:\.\d+)?)\s*A\b)?/i.exec((it.notes || '') + ' ' + (it.part || '')) : null;
        S.supplies.push(K.newSupply({ name: it ? it.component || it.part : 'Supply', itemId: id, vout: m ? +m[1] : 5, maxA: m && m[2] ? +m[2] : null }));
        tab = 'power';
        toast('Added ' + (it ? it.component || it.part : 'part') + ' as a power supply.');
        break;
      }
      case 'v-nominal': S.elec.vSupply = +(n(S.battery.cells) * n(S.battery.cellV)).toFixed(2); break;
      case 'gen-free': S.battery.freeSpec = K.freeSpecText(S); break;
      case 'add-note': S.notes.push(''); break;
      case 'del-note': snapshot(); S.notes.splice(+id, 1); break;
      case 'add-bnote': S.battery.notes.push(''); break;
      case 'del-bnote': snapshot(); S.battery.notes.splice(+id, 1); break;
      case 'copy': {
        const done = () => { const o = btn.textContent; btn.textContent = '✓'; setTimeout(() => { btn.textContent = o; }, 1200); };
        try { navigator.clipboard.writeText(id).then(done, () => toast('Copy this value: ' + id)); } catch (e) { toast('Copy this value: ' + id); }
        return false;
      }
      default: return false;
    }
    return true;
  }

  function commitStructure() { saveDraft(); const y = window.scrollY; renderAll(); window.scrollTo(0, y); }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !root.contains(btn) || btn.disabled) return;
    if (actions(btn.getAttribute('data-act'), btn.getAttribute('data-id'), btn)) commitStructure();
  });
  root.addEventListener('input', (e) => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') onEdit(e); });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'bom-file') { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); return; }
    if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT' || e.target.hasAttribute('data-struct')) onEdit(e);
  });
  ['dragenter', 'dragover'].forEach((t) => root.addEventListener(t, (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); root.classList.add('drop-active'); } }));
  ['dragleave', 'drop'].forEach((t) => root.addEventListener(t, (e) => { if (t === 'dragleave' && root.contains(e.relatedTarget)) return; root.classList.remove('drop-active'); }));
  root.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) importFile(f); });

  // ------------------------------------------------------------ file I/O

  function needExcel() {
    if (window.ExcelJS) return true;
    toast('The spreadsheet library did not load. Check your connection and reload the page.', { err: true });
    return false;
  }

  function importFile(file) {
    if (!/\.xlsx$/i.test(file.name)) { toast('Open an .xlsx file. Save other formats (Google Sheets, .xls, Numbers) as Excel .xlsx first.', { err: true }); return; }
    if (!needExcel()) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const next = await K.importXlsx(window.ExcelJS, reader.result);
        snapshot();
        S = next;
        commitStructure();
        const parts = K.allOnboard(S).length;
        toast('Opened ' + file.name + ': ' + parts + ' parts, ' + S.loads.length + ' loads, ' + S.supplies.length + ' supplies', { undo: true });
      } catch (err) {
        toast('Could not read ' + file.name + '. ' + (err && err.message ? err.message : '') + ' The sheet needs an ONBOARD BOM title with a Component header row under it.', { err: true });
      }
    };
    reader.onerror = () => toast('Could not read ' + file.name + '.', { err: true });
    reader.readAsArrayBuffer(file);
  }

  async function exportXlsx() {
    if (!needExcel()) return;
    try {
      const wb = K.buildWorkbook(window.ExcelJS, S);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const name = ((S.meta.title || 'BOM').normalize('NFKD').replace(/[^\w .()-]+/g, '-').replace(/\s*-[\s-]*/g, '-').replace(/\s+/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '') || 'BOM') + '.xlsx';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      toast('Downloaded ' + name);
    } catch (err) {
      toast('Could not build the spreadsheet: ' + (err && err.message ? err.message : err), { err: true });
    }
  }

  // ------------------------------------------------------------ boot

  try { const t = localStorage.getItem(STORE_KEY + '-tab'); if (t && ['parts', 'power', 'ecalc', 'breakdown'].includes(t)) tab = t; } catch (e) { /* ignore */ }
  const hash = (location.hash || '').replace('#', '');
  if (['parts', 'power', 'ecalc', 'breakdown'].includes(hash)) tab = hash;
  shell();
  renderAll();
  setSaved(loadDraft() ? 'Saved in this browser' : 'Example build loaded — edit it, open your own spreadsheet, or start blank');
})();

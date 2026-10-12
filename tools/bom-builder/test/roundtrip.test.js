// Export the sample build to .xlsx, read it back, and check nothing is lost
// and the calculations agree. Run: npm install && npm test
const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const Core = require('../src/core.js');
const sample = require('../src/sample.json');

const strip = (s) => JSON.parse(JSON.stringify(s, (k, v) => (['id', 'itemId', 'supply', 'from'].includes(k) ? undefined : v)));
const byName = (a, b) => a.name.localeCompare(b.name);

test('sample computes the same numbers as the source spreadsheet', () => {
  const c = Core.compute(Core.normalize(sample));
  assert.strictEqual(+c.auw.toFixed(1), 915.5);
  assert.strictEqual(+c.ecalcIn.drive.toFixed(1), 363.4);
  assert.strictEqual(+c.ecalcIn.acc.toFixed(1), 202.1);
  assert.strictEqual(+c.cost.build.toFixed(2), 1153.17);
  assert.strictEqual(+c.elec.totalI.toFixed(4), 16.8407);
});

test('export then import keeps the build', async () => {
  const s = Core.normalize(sample);
  const buf = await Core.buildWorkbook(ExcelJS, s).xlsx.writeBuffer();
  const back = await Core.importXlsx(ExcelJS, buf);
  const a = strip(s), b = strip(back);
  a.loads.sort(byName); b.loads.sort(byName);
  assert.deepStrictEqual(b, a);
  const link = (st) => st.loads.map((l) => [l.name, (st.supplies.find((x) => x.id === l.supply) || { name: 'battery' }).name, Core.itemLabel(Core.allItems(st).find((i) => i.id === l.itemId))].join('|')).sort();
  assert.deepStrictEqual(link(back), link(s));
  assert.deepStrictEqual(Core.compute(back).elec.totalI, Core.compute(s).elec.totalI);
});

test('supplies can feed other supplies', () => {
  const s = Core.newState();
  const a = Core.newSupply({ name: 'PM', eff: 100, vout: 12 });
  const b = Core.newSupply({ name: 'BEC', eff: 80, vout: 5, from: a.id, maxA: 2 });
  s.supplies.push(a, b);
  s.loads.push(Core.newLoad({ name: 'Pi', watts: 8, supply: b.id }));
  const t = Core.powerTree(s);
  assert.strictEqual(t.kids[0].kids[0].inW, 10);
  assert.strictEqual(t.outW, 10);
  assert.strictEqual(t.kids[0].kids[0].util, 0.8);
});

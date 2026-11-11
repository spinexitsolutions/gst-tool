const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const C = require('../js/gst-core.js');
const P = require('../js/parsers.js');

const SELLER = '27AAPFU0939F1ZV';
const SAMPLES = path.join(__dirname, '..', 'sample-data');

function loadSamples() {
  let records = [];
  fs.readdirSync(SAMPLES).filter((f) => /\.(csv|xlsx)$/.test(f)).forEach((f) => {
    const wb = XLSX.read(fs.readFileSync(path.join(SAMPLES, f)), { type: 'buffer', cellDates: true, raw: f.endsWith('.csv') });
    records = records.concat(P.parseWorkbook(XLSX, wb, f).records);
  });
  return records;
}

function rec(o) {
  return Object.assign({ file: 't.csv', row: 2, platform: 'amazon', ecoKey: 'amazon', kind: 'sale', invoiceNo: 'INV1', date: new Date(2025, 9, 5),
    sellerGstin: SELLER, buyerGstin: '', pos: '27', hsn: '61091000', qty: 1, uqc: 'NOS', rate: 5, txval: 100, tax: 5, igst: 0, cgst: 2.5, sgst: 2.5, cess: 0, taxProvided: true }, o);
}

test('GSTIN validation incl. checksum and TCS (C) GSTINs', () => {
  assert.equal(C.isValidGSTIN('27AAPFU0939F1ZV'), true);
  assert.equal(C.isValidGSTIN('27AAPFU0939F1ZX'), false);
  assert.equal(C.isValidGSTIN('27AAICA3918J1CT'), true);
  assert.equal(C.isValidGSTIN('27AAPFU0939F1Z'), false);
  assert.equal(C.isValidGSTIN(''), false);
});

test('state names, aliases and codes resolve to GST state codes', () => {
  assert.equal(C.stateCode('MAHARASHTRA'), '27');
  assert.equal(C.stateCode('Tamil Nadu'), '33');
  assert.equal(C.stateCode('TAMILNADU'), '33');
  assert.equal(C.stateCode('Jammu & Kashmir'), '01');
  assert.equal(C.stateCode('ORISSA'), '21');
  assert.equal(C.stateCode('DAMAN & DIU'), '26');
  assert.equal(C.stateCode('MH'), '27');
  assert.equal(C.stateCode(7), '07');
  assert.equal(C.stateCode('Atlantis'), null);
});

test('dates in common report formats', () => {
  assert.deepEqual(C.parseDate('2025-10-05 10:15:00'), new Date(2025, 9, 5));
  assert.deepEqual(C.parseDate('05-10-2025'), new Date(2025, 9, 5));
  assert.deepEqual(C.parseDate('05/10/2025'), new Date(2025, 9, 5));
  assert.deepEqual(C.parseDate('05-Oct-2025'), new Date(2025, 9, 5));
  assert.deepEqual(C.parseDate(45935), new Date(2025, 9, 5));
  assert.equal(C.parseDate('31-02-2025'), null);
});

test('number parsing', () => {
  assert.equal(C.num('1,234.50'), 1234.5);
  assert.equal(C.num('₹ 99'), 99);
  assert.equal(C.num('(12.5)'), -12.5);
  assert.equal(C.num(''), 0);
});

test('intra-state sale goes to B2CS with CGST/SGST; inter-state with IGST', () => {
  const out = C.processRecords([
    rec({}),
    rec({ row: 3, pos: '29', igst: 5, cgst: 0, sgst: 0 }),
  ], { gstin: SELLER, period: '102025' });
  assert.equal(out.errorCount, 0);
  assert.deepEqual(out.json.b2cs, [
    { sply_ty: 'INTRA', rt: 5, typ: 'OE', pos: '27', txval: 100, csamt: 0, camt: 2.5, samt: 2.5 },
    { sply_ty: 'INTER', rt: 5, typ: 'OE', pos: '29', txval: 100, csamt: 0, iamt: 5 },
  ]);
});

test('returns are netted in B2CS and fully cancelling rows are dropped', () => {
  const out = C.processRecords([
    rec({ pos: '24', igst: 5, cgst: 0, sgst: 0 }),
    rec({ row: 3, kind: 'return', pos: '24', txval: -100, tax: -5, igst: -5, cgst: 0, sgst: 0, creditNoteNo: 'CN1' }),
  ], { gstin: SELLER, period: '102025' });
  assert.equal(out.json.b2cs, undefined);
  assert.equal(out.summary.platforms[0].returns.txval, -100);
});

test('rows of another GSTIN are excluded with a warning', () => {
  const out = C.processRecords([rec({}), rec({ row: 3, sellerGstin: '29AABCT1332L1ZA' })], { gstin: SELLER, period: '102025' });
  assert.equal(out.stats.skippedOtherGstin, 1);
  assert.ok(out.issues.some((i) => i.code === 'OTHER_GSTIN'));
});

test('verification flags tax mismatch, wrong tax type, bad rate and unknown state', () => {
  const out = C.processRecords([
    rec({ tax: 9, cgst: 4.5, sgst: 4.5 }),
    rec({ row: 3, igst: 5, cgst: 0, sgst: 0 }),
    rec({ row: 4, rate: 13 }),
    rec({ row: 5, pos: null, posRaw: 'Atlantis' }),
  ], { gstin: SELLER, period: '102025' });
  const codes = out.issues.map((i) => i.code);
  ['TAX_MISMATCH', 'SPLIT_IGST_INTRA', 'RATE_INVALID', 'POS'].forEach((c) => assert.ok(codes.includes(c), c));
  assert.ok(out.errorCount > 0);
});

test('out-of-period rows are warned or excluded', () => {
  const r = [rec({ date: new Date(2025, 8, 30) })];
  assert.ok(C.processRecords(r, { gstin: SELLER, period: '102025' }).issues.some((i) => i.code === 'OUT_OF_PERIOD'));
  const ex = C.processRecords(r, { gstin: SELLER, period: '102025', excludeOutOfPeriod: true });
  assert.equal(ex.stats.skippedOutOfPeriod, 1);
  assert.equal(ex.json.b2cs, undefined);
});

test('missing tax is computed from rate; missing rate is inferred from tax', () => {
  const out = C.processRecords([
    rec({ platform: 'generic', ecoKey: '', taxProvided: false, tax: 0, cgst: 0, sgst: 0, rate: 18 }),
    rec({ row: 3, pos: '07', rate: null, tax: 12, igst: 12, cgst: 0, sgst: 0 }),
  ], { gstin: SELLER, period: '102025' });
  const intra = out.json.b2cs.find((b) => b.pos === '27');
  assert.equal(intra.camt, 9);
  const inter = out.json.b2cs.find((b) => b.pos === '07');
  assert.equal(inter.rt, 12);
});

test('B2B sale and B2B return go to b2b / cdnr and hsn_b2b', () => {
  const buyer = '29AABCT1332L1ZA';
  const out = C.processRecords([
    rec({ buyerGstin: buyer, pos: '29', txval: 1000, tax: 180, rate: 18, igst: 180, cgst: 0, sgst: 0, invoiceNo: 'B1' }),
    rec({ row: 3, kind: 'return', buyerGstin: buyer, pos: '29', txval: -1000, tax: -180, rate: 18, igst: -180, cgst: 0, sgst: 0, invoiceNo: '', creditNoteNo: 'CN9' }),
  ], { gstin: SELLER, period: '102025' });
  assert.equal(out.json.b2b[0].inv[0].val, 1180);
  assert.deepEqual(out.json.b2b[0].inv[0].itms[0].itm_det, { txval: 1000, rt: 18, iamt: 180, csamt: 0 });
  assert.equal(out.json.cdnr[0].nt[0].ntty, 'C');
  assert.equal(out.json.cdnr[0].nt[0].val, 1180);
  assert.equal(out.json.hsn.hsn_b2b.length, 1);
  assert.equal(out.json.hsn.hsn_b2c.length, 0);
});

test('inter-state unregistered invoice above 1 lakh goes to B2CL', () => {
  const out = C.processRecords([rec({ pos: '07', txval: 100000, tax: 18000, rate: 18, igst: 18000, cgst: 0, sgst: 0, invoiceNo: 'BIG1' })], { gstin: SELLER, period: '102025' });
  assert.equal(out.json.b2cl[0].pos, '07');
  assert.equal(out.json.b2cl[0].inv[0].val, 118000);
  assert.equal(out.json.b2cs, undefined);
});

test('Table 14 (supeco) uses the ECO GSTIN and is validated', () => {
  const ok = C.processRecords([rec({})], { gstin: SELLER, period: '102025', ecoGstins: { amazon: '27AAICA3918J1CT' } });
  assert.deepEqual(ok.json.supeco, { clttx: [{ etin: '27AAICA3918J1CT', suppval: 100, igst: 0, cgst: 2.5, sgst: 2.5, cess: 0 }] });
  const bad = C.processRecords([rec({})], { gstin: SELLER, period: '102025', ecoGstins: { amazon: '27AAICA3918J1CX' } });
  assert.ok(bad.issues.some((i) => i.code === 'ECO_GSTIN_INVALID'));
  assert.equal(bad.json.supeco, undefined);
});

test('document series are grouped by prefix', () => {
  const out = C.processRecords([rec({ invoiceNo: 'A-0009' }), rec({ row: 3, invoiceNo: 'A-0011', itemId: 'x' }), rec({ row: 4, invoiceNo: 'A-0010', itemId: 'y' })], { gstin: SELLER, period: '102025' });
  assert.deepEqual(out.json.doc_issue.doc_det[0].docs[0], { num: 1, from: 'A-0009', to: 'A-0011', totnum: 3, cancel: 0, net_issue: 3 });
});

test('sample files: all platforms detected and totals reconcile', () => {
  const records = loadSamples();
  const platforms = new Set(records.map((r) => r.platform));
  ['amazon', 'flipkart', 'meesho', 'generic'].forEach((p) => assert.ok(platforms.has(p), p));

  const out = C.processRecords(records, { gstin: SELLER, period: '102025', ecoGstins: { amazon: '27AAICA3918J1CT', flipkart: '27AACCF0683K1CS' } });
  assert.equal(out.errorCount, 0, JSON.stringify(out.issues));

  // B2CS + B2B + HSN totals must all equal the overall net taxable value
  const sum = (arr, k) => C.round2(arr.reduce((a, x) => a + (x[k] || 0), 0));
  const b2bTx = out.json.b2b.reduce((a, c) => a + c.inv.reduce((b, i) => b + i.itms.reduce((d, it) => d + it.itm_det.txval, 0), 0), 0);
  const total = out.summary.total.txval;
  assert.equal(C.round2(sum(out.json.b2cs, 'txval') + b2bTx), total);
  assert.equal(C.round2(sum(out.json.hsn.hsn_b2c, 'txval') + sum(out.json.hsn.hsn_b2b, 'txval')), total);
  assert.equal(out.stats.skippedCancel, 1);

  // Meesho: 4 sales minus 1 return
  const meesho = out.summary.platforms.find((p) => p.platform === 'meesho');
  assert.equal(meesho.net.txval, C.round2(285.71 + 571.43 + 285.71 + 338.98 - 285.71));
});

test('HSN: official master check, partial match, digits by turnover, SKU conflict', () => {
  const master = { 6109: 'T-shirts, singlets', 61091000: 'Of cotton', 7323: 'Table, kitchen articles of iron' };
  const out = C.processRecords([
    rec({ hsn: '61091000', sku: 'TS1' }),
    rec({ row: 3, hsn: '73239390', sku: 'B1', platform: 'flipkart', ecoKey: 'flipkart' }),
    rec({ row: 4, hsn: '99999999', sku: 'X' }),
    rec({ row: 5, hsn: '6105', sku: 'TS1', platform: 'flipkart', ecoKey: 'flipkart' }),
  ], { gstin: SELLER, period: '102025', hsnMaster: master, aatoAbove5Cr: true });
  const codes = out.issues.map((i) => i.code);
  ['HSN_NOT_IN_MASTER', 'HSN_PARTIAL_MASTER', 'HSN_DIGITS', 'HSN_SKU_CONFLICT'].forEach((c) => assert.ok(codes.includes(c), c));
  const h = out.json.hsn.hsn_b2c.find((x) => x.hsn_sc === '61091000');
  assert.equal(h.desc, 'Of cotton');
  assert.equal(out.summary.hsn.find((x) => x.hsn_sc === '99999999').status, 'invalid');
  assert.equal(out.summary.hsn.find((x) => x.hsn_sc === '73239390').status, 'partial');
});

test('TCS reconciliation against portal credit (GSTR-8)', () => {
  const out = C.processRecords([
    rec({ txval: 10000, tax: 500, cgst: 250, sgst: 250 }), // intra
    rec({ row: 3, pos: '07', txval: 20000, tax: 1000, igst: 1000, cgst: 0, sgst: 0 }), // inter
    rec({ row: 4, kind: 'return', pos: '07', txval: -2000, tax: -100, igst: -100, cgst: 0, sgst: 0, creditNoteNo: 'C1' }),
  ], { gstin: SELLER, period: '102025' });
  assert.equal(C.tcsRate('102025'), 0.5);
  assert.equal(C.tcsRate('052024'), 1);
  const [ok] = C.reconcileTcs(out.summary.eco, { amazon: { gross: 30000, returns: 2000, net: 28000, igst: 90, cgst: 25, sgst: 25 } }, '102025');
  assert.equal(ok.status, 'match');
  assert.deepEqual(ok.expectedTcs, { igst: 90, cgst: 25, sgst: 25 });
  const [bad] = C.reconcileTcs(out.summary.eco, { amazon: { gross: 35000, returns: 2000, net: 33000 } }, '102025');
  assert.equal(bad.status, 'mismatch');
  assert.equal(bad.diffNet, -5000);
  assert.ok(bad.notes.length >= 2);
  const [pending] = C.reconcileTcs(out.summary.eco, {}, '102025');
  assert.equal(pending.status, 'pending');
});

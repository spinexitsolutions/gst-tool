const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/parsers.js');

test('Amazon MTR: fraction rates, refunds negative, cancel kept as cancel', () => {
  const rows = [
    ['Seller Gstin', 'Invoice Number', 'Invoice Date', 'Transaction Type', 'Order Id', 'Shipment Item Id', 'Quantity', 'Hsn/sac', 'Ship To State',
      'Tax Exclusive Gross', 'Total Tax Amount', 'Cgst Rate', 'Sgst Rate', 'Igst Rate', 'Igst Tax', 'Credit Note No'],
    ['27AAPFU0939F1ZV', 'IN1', '2025-10-01', 'Shipment', 'O1', 'S1', '1', '6109', 'KARNATAKA', '100', '5', '0', '0', '0.05', '5', ''],
    ['27AAPFU0939F1ZV', 'CN1', '2025-10-02', 'Refund', 'O1', 'S1', '1', '6109', 'KARNATAKA', '-100', '-5', '0', '0', '0.05', '-5', ''],
    ['27AAPFU0939F1ZV', 'IN2', '2025-10-03', 'Cancel', 'O2', 'S2', '1', '6109', 'KARNATAKA', '0', '0', '0', '0', '0.05', '0', ''],
  ];
  const { platform, records } = P.parseTable(rows, 'mtr.csv');
  assert.equal(platform, 'amazon');
  assert.equal(records[0].rate, 5);
  assert.equal(records[0].pos, '29');
  assert.equal(records[1].kind, 'return');
  assert.equal(records[1].txval, -100);
  assert.equal(records[1].creditNoteNo, 'CN1');
  assert.equal(records[1].qty, -1);
  assert.equal(records[2].kind, 'cancel');
});

test('Flipkart: percent rates, return and return-cancellation events', () => {
  const rows = [
    ['Seller GSTIN', 'Order ID', 'Order Item ID', 'HSN Code', 'Event Type', 'Event Sub Type', 'Item Quantity', 'Taxable Value (Final Invoice Amount -Taxes)',
      'IGST Rate', 'IGST Amount', 'CGST Rate', 'CGST Amount', 'SGST Rate (or UTGST as applicable)', 'SGST Amount (Or UTGST as applicable)', 'Buyer Invoice ID', 'Buyer Invoice Date', "Customer's Delivery State"],
    ['27AAPFU0939F1ZV', 'OD1', '1', '6109', 'Sale', 'Sale', 1, 100, 0, 0, 2.5, 2.5, 2.5, 2.5, 'F1', '2025-10-01', 'Maharashtra'],
    ['27AAPFU0939F1ZV', 'OD1', '1', '6109', 'Return', 'Return', 1, 100, 0, 0, 2.5, 2.5, 2.5, 2.5, 'F1', '2025-10-03', 'Maharashtra'],
    ['27AAPFU0939F1ZV', 'OD1', '1', '6109', 'Return', 'Return Cancellation', 1, 100, 0, 0, 2.5, 2.5, 2.5, 2.5, 'F1', '2025-10-04', 'Maharashtra'],
  ];
  const { platform, records } = P.parseTable(rows, 'fk.xlsx', 'Sales Report');
  assert.equal(platform, 'flipkart');
  assert.equal(records[0].rate, 5);
  assert.equal(records[0].tax, 5);
  assert.equal(records[1].kind, 'return');
  assert.equal(records[1].txval, -100);
  assert.equal(records[2].kind, 'sale');
  assert.equal(records[2].txval, 100);
});

test('Meesho: return file detected by name and negated', () => {
  const rows = [
    ['sub_order_num', 'order_date', 'hsn_code', 'quantity', 'gst_rate', 'total_taxable_sale_value', 'tax_amount', 'end_customer_state_new'],
    ['A_1', '2025-10-01', 6109, 1, 5, 200, 10, 'West Bengal'],
  ];
  const sale = P.parseTable(rows, 'tcs_sales.xlsx');
  assert.equal(sale.platform, 'meesho');
  assert.equal(sale.records[0].txval, 200);
  assert.equal(sale.records[0].pos, '19');
  const ret = P.parseTable(rows, 'tcs_sales_return.xlsx');
  assert.equal(ret.isReturnFile, true);
  assert.equal(ret.records[0].txval, -200);
  assert.equal(ret.records[0].tax, -10);
});

test('header row can be below a title row; unknown sheets return null', () => {
  const rows = [['Meesho GST Report'], [], ['sub_order_num', 'total_taxable_sale_value', 'gst_rate', 'end_customer_state_new'], ['A', 100, 5, 'Goa']];
  assert.equal(P.parseTable(rows, 'x.xlsx').records.length, 1);
  assert.equal(P.parseTable([['foo', 'bar'], [1, 2]], 'x.csv'), null);
});

test('generic template: tax optional, platform becomes ECO key', () => {
  const rows = [P.GENERIC_TEMPLATE_HEADERS, ['JioMart', 'J1', '05-10-2025', 'sale', 'o', '', 'Kerala', '6109', 'Tee', 1, 'NOS', 100, 5, '', '', '', '']];
  const { records } = P.parseTable(rows, 'other.csv');
  assert.equal(records[0].ecoKey, 'jiomart');
  assert.equal(records[0].taxProvided, false);
  assert.equal(records[0].pos, '32');
});

test('sheet with a wrong stored range (Flipkart export bug) still yields all rows', () => {
  const XLSX = require('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([['Event Sub Type', 'Taxable Value (Final Invoice Amount -Taxes)', 'IGST Rate', "Customer's Delivery State"], ['Sale', 100, 5, 'Goa'], ['Sale', 200, 5, 'Goa']]);
  ws['!ref'] = 'A1:D1'; // what the broken file declares
  const wb = { SheetNames: ['Sales Report'], Sheets: { 'Sales Report': ws } };
  const res = P.parseWorkbook(XLSX, wb, 'fk.xlsx');
  assert.equal(res.sheets[0].count, 2);
  assert.equal(res.sheets[0].rangeFixed, true);
});

test('unknown layout: suggested mapping, manual mapping and remembered mapping', () => {
  const XLSX = require('xlsx');
  const rows = [
    ['Myntra Seller Tax Report'],
    ['Packet Id', 'Order Release Date', 'Return Type', 'Ship State', 'HSN', 'Units', 'Base Value', 'Tax Rate', 'IGST Amt', 'CGST Amt', 'SGST Amt'],
    ['P1', '05-10-2025', 'Forward', 'Karnataka', '6109', 1, 1000, 5, 50, 0, 0],
    ['P2', '06-10-2025', 'RTO Return', 'Karnataka', '6109', 1, 1000, 5, 50, 0, 0],
  ];
  assert.equal(P.parseTable(rows, 'm.xlsx'), null);
  const cols = P.suggestMapping(rows[1]);
  assert.equal(cols.taxable_value, undefined); // "Base Value" is not guessable
  assert.equal(cols.pos_state, 3);
  assert.equal(cols.igst, 8);
  assert.equal(cols.gst_rate, 7);
  const m = { headerRow: 1, platform: 'Myntra', cols: Object.assign({}, cols, { taxable_value: 6, type: 2 }) };
  const out = P.applyMapping(rows, m, 'm.xlsx', '');
  assert.equal(out.records.length, 2);
  assert.equal(out.records[0].txval, 1000);
  assert.equal(out.records[0].pos, '29');
  assert.equal(out.records[0].ecoKey, 'myntra');
  assert.equal(out.records[1].kind, 'return');
  assert.equal(out.records[1].txval, -1000);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = { SheetNames: ['Sheet1'], Sheets: { Sheet1: ws } };
  const first = P.parseWorkbook(XLSX, wb, 'm.xlsx');
  assert.equal(first.raw.length, 1);
  const again = P.parseWorkbook(XLSX, wb, 'm.xlsx', { [first.raw[0].signature]: m });
  assert.equal(again.sheets[0].mapped, true);
  assert.equal(again.records.length, 2);
});

test('mapping with only a total tax column and an all-returns sheet', () => {
  const rows = [['state', 'taxable', 'gst amount'], ['Goa', 100, 18]];
  const out = P.applyMapping(rows, { headerRow: 0, cols: { pos_state: 0, taxable_value: 1, total_tax: 2 }, allReturns: true }, 'r.csv', '');
  assert.equal(out.records[0].kind, 'return');
  assert.equal(out.records[0].txval, -100);
  assert.equal(out.records[0].tax, -18);
  assert.equal(out.records[0].taxProvided, true);
});

test('Flipkart Cash Back Report: credit notes reduce, debit notes add, missing HSN/state/rate taken from the sale', () => {
  const XLSX = require('xlsx');
  const sales = XLSX.utils.aoa_to_sheet([
    ['Seller GSTIN', 'Order ID', 'Order Item ID', 'HSN Code', 'Event Type', 'Event Sub Type', 'Item Quantity', 'Taxable Value (Final Invoice Amount -Taxes)', 'IGST Rate', 'IGST Amount', 'Buyer Invoice ID', 'Buyer Invoice Date', "Customer's Delivery State"],
    ['27AAPFU0939F1ZV', 'OD1', 'I1', '6109', 'Sale', 'Sale', 1, 1000, 5, 50, 'F1', '2025-10-01', 'Gujarat'],
  ]);
  const cb = XLSX.utils.aoa_to_sheet([
    ['Seller GSTIN', 'Order ID', 'Order Item ID', 'Document Type', 'Document Sub Type', 'Credit Note ID/ Debit Note ID', 'Document Date', 'Taxable Value', 'IGST Rate', 'IGST Amount'],
    ['27AAPFU0939F1ZV', 'OD1', 'I1', 'Credit Note', 'Sale', 'CN-1', '2025-10-05', 100, 5, 5],
    ['27AAPFU0939F1ZV', 'OD1', 'I1', 'Debit Note', 'Sale', 'DN-1', '2025-10-06', 20, 5, 1],
  ]);
  const simple = XLSX.utils.aoa_to_sheet([['Seller GSTIN', 'Order ID', 'Credit Note ID', 'Amount'], ['27AAPFU0939F1ZV', 'OD1', 'CB1', 105]]);
  const wb = { SheetNames: ['Help', 'Sales Report', 'Cash Back Report'], Sheets: { Help: XLSX.utils.aoa_to_sheet([['help text']]), 'Sales Report': sales, 'Cash Back Report': cb } };
  const res = P.parseWorkbook(XLSX, wb, 'fk.xlsx');
  assert.equal(res.sheets.length, 2);
  const [cn, dn] = res.records.filter((r) => r.adjustment);
  assert.equal(cn.kind, 'return'); assert.equal(cn.txval, -100); assert.equal(cn.tax, -5); assert.equal(cn.creditNoteNo, 'CN-1');
  assert.equal(cn.hsn, '6109'); assert.equal(cn.pos, '24');
  assert.equal(dn.kind, 'sale'); assert.equal(dn.txval, 20); assert.equal(dn.debitNoteNo, 'DN-1'); assert.equal(dn.invoiceNo, '');

  // Tax-inclusive "Amount" only: split using the sale's rate (105 incl. 5% = 100 + 5)
  const wb2 = { SheetNames: ['Sales Report', 'Cash Back Report'], Sheets: { 'Sales Report': sales, 'Cash Back Report': simple } };
  const r2 = P.parseWorkbook(XLSX, wb2, 'fk.xlsx').records.find((r) => r.adjustment);
  assert.equal(r2.rate, 5);
  assert.equal(Math.round(r2.txval * 100) / 100, -100);
  assert.equal(Math.round(r2.tax * 100) / 100, -5);

  const C = require('../js/gst-core.js');
  const out = C.processRecords(res.records, { gstin: '27AAPFU0939F1ZV', period: '102025' });
  assert.equal(out.errorCount, 0, JSON.stringify(out.issues));
  assert.deepEqual(out.json.b2cs, [{ sply_ty: 'INTER', rt: 5, typ: 'OE', pos: '24', txval: 920, csamt: 0, iamt: 46 }]);
  const types = out.json.doc_issue.doc_det.map((d) => d.doc_num).sort();
  assert.deepEqual(types, [1, 4, 5]);
});

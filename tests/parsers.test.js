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

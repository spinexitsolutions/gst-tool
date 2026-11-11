// Generates demo report files in /sample-data that mimic each platform's real export format.
// Run: npm run samples
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const OUT = path.join(__dirname, '..', 'sample-data');
fs.mkdirSync(OUT, { recursive: true });

const SELLER = '27AAPFU0939F1ZV'; // Maharashtra (GSTN's published sample GSTIN)
const B2B_BUYER = '29AABCT1332L1ZA';
const r2 = (n) => Math.round(n * 100) / 100;

function writeCsv(name, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  fs.writeFileSync(path.join(OUT, name), XLSX.utils.sheet_to_csv(ws));
}
function writeXlsx(name, sheets) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([sheet, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet));
  XLSX.writeFile(wb, path.join(OUT, name));
}

// ------------------------------------------------------------ Amazon MTR
const AMZ_HEADERS = ['Seller Gstin', 'Invoice Number', 'Invoice Date', 'Transaction Type', 'Order Id', 'Shipment Id', 'Shipment Date', 'Order Date',
  'Shipment Item Id', 'Quantity', 'Item Description', 'Asin', 'Hsn/sac', 'Sku', 'Product Tax Code', 'Bill From State', 'Ship From State',
  'Ship To City', 'Ship To State', 'Ship To Country', 'Ship To Postal Code', 'Invoice Amount', 'Tax Exclusive Gross', 'Total Tax Amount',
  'Cgst Rate', 'Sgst Rate', 'Utgst Rate', 'Igst Rate', 'Compensatory Cess Rate', 'Principal Amount', 'Principal Amount Basis',
  'Cgst Tax', 'Sgst Tax', 'Utgst Tax', 'Igst Tax', 'Compensatory Cess Tax', 'Shipping Amount', 'Shipping Amount Basis',
  'Shipping Cgst Tax', 'Shipping Sgst Tax', 'Shipping Utgst Tax', 'Shipping Igst Tax', 'Item Promo Discount', 'Item Promo Discount Basis',
  'Item Promo Tax', 'Fulfillment Channel', 'Payment Method Code', 'Customer Bill To Gstid', 'Customer Ship To Gstid', 'Buyer Name',
  'Credit Note No', 'Credit Note Date'];

function amzRow(o) {
  const intra = o.state === 'MAHARASHTRA';
  const rate = o.rate / 100;
  const sign = o.type === 'Refund' ? -1 : 1;
  const base = o.type === 'Cancel' ? 0 : sign * o.taxable;
  const tax = r2(base * rate);
  const row = {
    'Seller Gstin': SELLER, 'Invoice Number': o.inv, 'Invoice Date': o.date + ' 10:15:00', 'Transaction Type': o.type,
    'Order Id': o.order, 'Shipment Id': 'S' + o.order.slice(-6), 'Shipment Date': o.date + ' 09:00:00', 'Order Date': o.date + ' 08:00:00',
    'Shipment Item Id': 'SI' + o.order.slice(-6), Quantity: o.qty, 'Item Description': o.desc, Asin: 'B0' + o.order.slice(-8), 'Hsn/sac': o.hsn,
    Sku: 'SKU-' + o.hsn, 'Product Tax Code': 'A_GEN_STANDARD', 'Bill From State': 'MAHARASHTRA', 'Ship From State': 'MAHARASHTRA',
    'Ship To City': o.city, 'Ship To State': o.state, 'Ship To Country': 'IN', 'Ship To Postal Code': o.pin,
    'Invoice Amount': r2(base + tax), 'Tax Exclusive Gross': r2(base), 'Total Tax Amount': tax,
    'Cgst Rate': intra ? rate / 2 : 0, 'Sgst Rate': intra ? rate / 2 : 0, 'Utgst Rate': 0, 'Igst Rate': intra ? 0 : rate, 'Compensatory Cess Rate': 0,
    'Principal Amount': r2(base + tax), 'Principal Amount Basis': r2(base),
    'Cgst Tax': intra ? r2(tax / 2) : 0, 'Sgst Tax': intra ? r2(tax / 2) : 0, 'Utgst Tax': 0, 'Igst Tax': intra ? 0 : tax, 'Compensatory Cess Tax': 0,
    'Shipping Amount': 0, 'Shipping Amount Basis': 0, 'Shipping Cgst Tax': 0, 'Shipping Sgst Tax': 0, 'Shipping Utgst Tax': 0, 'Shipping Igst Tax': 0,
    'Item Promo Discount': 0, 'Item Promo Discount Basis': 0, 'Item Promo Tax': 0, 'Fulfillment Channel': 'MFN', 'Payment Method Code': 'COD',
    'Customer Bill To Gstid': o.buyer || '', 'Customer Ship To Gstid': o.buyer || '', 'Buyer Name': o.buyer ? 'Test Traders Pvt Ltd' : '',
    'Credit Note No': o.cn || '', 'Credit Note Date': o.cn ? o.date + ' 11:00:00' : '',
  };
  return AMZ_HEADERS.map((h) => row[h]);
}

writeCsv('amazon_mtr_b2c_oct2025.csv', [AMZ_HEADERS,
  amzRow({ inv: 'IN-BOM7-1001', date: '2025-10-02', type: 'Shipment', order: '402-1111111-1000001', qty: 1, desc: 'Cotton T-Shirt Men', hsn: '61091000', city: 'PUNE', state: 'MAHARASHTRA', pin: '411001', taxable: 476.19, rate: 5 }),
  amzRow({ inv: 'IN-BOM7-1002', date: '2025-10-05', type: 'Shipment', order: '402-1111111-1000002', qty: 2, desc: 'Cotton T-Shirt Men', hsn: '61091000', city: 'BENGALURU', state: 'KARNATAKA', pin: '560001', taxable: 952.38, rate: 5 }),
  amzRow({ inv: 'IN-BOM7-1003', date: '2025-10-09', type: 'Shipment', order: '402-1111111-1000003', qty: 1, desc: 'Steel Water Bottle 1L', hsn: '73239390', city: 'NEW DELHI', state: 'DELHI', pin: '110001', taxable: 423.73, rate: 18 }),
  amzRow({ inv: 'IN-BOM7-1004', date: '2025-10-12', type: 'Shipment', order: '402-1111111-1000004', qty: 1, desc: 'Steel Water Bottle 1L', hsn: '73239390', city: 'MUMBAI', state: 'MAHARASHTRA', pin: '400001', taxable: 423.73, rate: 18 }),
  amzRow({ inv: 'IN-BOM7-1005', date: '2025-10-14', type: 'Cancel', order: '402-1111111-1000005', qty: 1, desc: 'Cotton T-Shirt Men', hsn: '61091000', city: 'CHENNAI', state: 'TAMIL NADU', pin: '600001', taxable: 476.19, rate: 5 }),
  amzRow({ inv: 'CN-BOM7-201', date: '2025-10-20', type: 'Refund', order: '402-1111111-1000002', qty: 1, desc: 'Cotton T-Shirt Men', hsn: '61091000', city: 'BENGALURU', state: 'KARNATAKA', pin: '560001', taxable: 476.19, rate: 5 }),
]);

writeCsv('amazon_mtr_b2b_oct2025.csv', [AMZ_HEADERS,
  amzRow({ inv: 'IN-BOM7-1006', date: '2025-10-15', type: 'Shipment', order: '402-1111111-1000006', qty: 10, desc: 'Steel Water Bottle 1L', hsn: '73239390', city: 'BENGALURU', state: 'KARNATAKA', pin: '560002', taxable: 4237.29, rate: 18, buyer: B2B_BUYER }),
]);

// ------------------------------------------------------------ Flipkart Sales Report
const FK_HEADERS = ['Seller GSTIN', 'Order ID', 'Order Item ID', 'Product Title/Description', 'FSN', 'SKU', 'HSN Code', 'Event Type', 'Event Sub Type',
  'Order Type', 'Fulfilment Type', 'Order Date', 'Order Approval Date ', 'Item Quantity', 'Order Shipped From (State)', 'Warehouse ID',
  'Price before discount', 'Total Discount', 'Seller Share ', 'Bank Offer Share', 'Price after discount (Price before discount-Total discount)',
  'Shipping Charges', 'Final Invoice Amount (Price after discount+Shipping Charges)', 'Type of tax', 'Taxable Value (Final Invoice Amount -Taxes)',
  'CST Rate', 'CST Amount', 'VAT Rate', 'VAT Amount', 'Luxury Cess Rate', 'Luxury Cess Amount', 'IGST Rate', 'IGST Amount', 'CGST Rate',
  'CGST Amount', 'SGST Rate (or UTGST as applicable)', 'SGST Amount (Or UTGST as applicable)', 'TCS IGST Rate', 'TCS IGST Amount',
  'TCS CGST Rate', 'TCS CGST Amount', 'TCS SGST Rate', 'TCS SGST Amount', 'Total TCS Deducted', 'Buyer Invoice ID', 'Buyer Invoice Date',
  'Buyer Invoice Amount ', "Customer's Billing Pincode", "Customer's Billing State", "Customer's Delivery Pincode", "Customer's Delivery State",
  'Usual Price', 'Is Shopsy Order?', 'TDS Rate', 'TDS Amount', 'IRN'];

function fkRow(o) {
  const intra = o.state === 'Maharashtra';
  const sign = o.sub === 'Sale' ? 1 : -1;
  const txval = r2(sign * o.taxable);
  const tax = r2(txval * o.rate / 100);
  const row = {
    'Seller GSTIN': SELLER, 'Order ID': o.order, 'Order Item ID': o.item, 'Product Title/Description': o.desc, FSN: 'FSN' + o.item, SKU: 'SKU-' + o.hsn,
    'HSN Code': o.hsn, 'Event Type': o.sub === 'Sale' ? 'Sale' : o.sub === 'Return' ? 'Return' : 'Cancellation', 'Event Sub Type': o.sub,
    'Order Type': 'Prepaid', 'Fulfilment Type': 'NON_FBF', 'Order Date': o.date, 'Order Approval Date ': o.date, 'Item Quantity': sign * o.qty,
    'Order Shipped From (State)': 'Maharashtra', 'Warehouse ID': 'WH1',
    'Final Invoice Amount (Price after discount+Shipping Charges)': r2(txval + tax), 'Type of tax': intra ? 'CGST+SGST' : 'IGST',
    'Taxable Value (Final Invoice Amount -Taxes)': txval, 'Luxury Cess Rate': 0, 'Luxury Cess Amount': 0,
    'IGST Rate': intra ? 0 : o.rate, 'IGST Amount': intra ? 0 : tax, 'CGST Rate': intra ? o.rate / 2 : 0, 'CGST Amount': intra ? r2(tax / 2) : 0,
    'SGST Rate (or UTGST as applicable)': intra ? o.rate / 2 : 0, 'SGST Amount (Or UTGST as applicable)': intra ? r2(tax / 2) : 0,
    'Buyer Invoice ID': o.inv, 'Buyer Invoice Date': o.date, 'Buyer Invoice Amount ': r2(txval + tax),
    "Customer's Billing State": o.state, "Customer's Delivery State": o.state, 'Is Shopsy Order?': 'FALSE',
  };
  return FK_HEADERS.map((h) => (row[h] === undefined ? '' : row[h]));
}

writeXlsx('flipkart_sales_report_oct2025.xlsx', {
  'Sales Report': [FK_HEADERS,
    fkRow({ order: 'OD1001', item: '50001', desc: 'Cotton T-Shirt Men', hsn: '61091000', sub: 'Sale', date: '2025-10-03', qty: 1, state: 'Maharashtra', taxable: 499, rate: 5, inv: 'FAABCD2600001' }),
    fkRow({ order: 'OD1002', item: '50002', desc: 'Cotton T-Shirt Men', hsn: '61091000', sub: 'Sale', date: '2025-10-04', qty: 1, state: 'Gujarat', taxable: 499, rate: 5, inv: 'FAABCD2600002' }),
    fkRow({ order: 'OD1003', item: '50003', desc: 'Steel Water Bottle 1L', hsn: '73239390', sub: 'Sale', date: '2025-10-07', qty: 3, state: 'Uttar Pradesh', taxable: 1270, rate: 18, inv: 'FAABCD2600003' }),
    fkRow({ order: 'OD1004', item: '50004', desc: 'Steel Water Bottle 1L', hsn: '73239390', sub: 'Sale', date: '2025-10-10', qty: 1, state: 'Maharashtra', taxable: 423.73, rate: 18, inv: 'FAABCD2600004' }),
    fkRow({ order: 'OD1002', item: '50002', desc: 'Cotton T-Shirt Men', hsn: '61091000', sub: 'Return', date: '2025-10-18', qty: 1, state: 'Gujarat', taxable: 499, rate: 5, inv: 'FAABCD2600002' }),
  ],
  'Cash Back Report': [['Seller GSTIN', 'Order ID', 'Credit Note ID', 'Amount'], [SELLER, 'OD1001', 'CB001', 10]],
});

// ------------------------------------------------------------ Meesho tcs_sales / tcs_sales_return
const MS_HEADERS = ['identifier', 'sub_order_num', 'order_date', 'hsn_code', 'quantity', 'gst_rate', 'total_taxable_sale_value', 'tax_amount',
  'total_invoice_value', 'taxable_shipping', 'end_customer_state_new', 'enrollment_no', 'financial_year', 'month_number', 'supplier_id'];
function msRow(o) {
  const tax = r2(o.taxable * o.rate / 100);
  return ['', o.sub, o.date, o.hsn, o.qty, o.rate, o.taxable, tax, r2(o.taxable + tax), 0, o.state, '', 2025, 10, 123456];
}
writeXlsx('tcs_sales.xlsx', {
  tcs_sales: [MS_HEADERS,
    msRow({ sub: '178123456_1', date: '2025-10-01', hsn: '6109', qty: 1, rate: 5, taxable: 285.71, state: 'Maharashtra' }),
    msRow({ sub: '178123457_1', date: '2025-10-06', hsn: '6109', qty: 2, rate: 5, taxable: 571.43, state: 'Rajasthan' }),
    msRow({ sub: '178123458_1', date: '2025-10-11', hsn: '6109', qty: 1, rate: 5, taxable: 285.71, state: 'West Bengal' }),
    msRow({ sub: '178123459_1', date: '2025-10-21', hsn: '7323', qty: 1, rate: 18, taxable: 338.98, state: 'Bihar' }),
  ],
});
writeXlsx('tcs_sales_return.xlsx', {
  tcs_sales_return: [MS_HEADERS.concat(['cancel_return_date']),
    msRow({ sub: '178123458_1', date: '2025-10-11', hsn: '6109', qty: 1, rate: 5, taxable: 285.71, state: 'West Bengal' }).concat(['2025-10-25']),
  ],
});

// ------------------------------------------------------------ Generic template (other platforms / own website)
writeCsv('other_platforms_template.csv', [
  ['platform', 'invoice_no', 'invoice_date', 'type', 'order_id', 'buyer_gstin', 'pos_state', 'hsn', 'description', 'qty', 'uqc', 'taxable_value', 'gst_rate', 'igst', 'cgst', 'sgst', 'cess'],
  ['JioMart', 'JM/25-26/0001', '08-10-2025', 'sale', 'JM10001', '', 'Kerala', '61091000', 'Cotton T-Shirt Men', 1, 'NOS', 476.19, 5, 23.81, '', '', 0],
  ['', 'WEB/25-26/0001', '16-10-2025', 'sale', 'W1001', '', 'Maharashtra', '73239390', 'Steel Water Bottle 1L', 2, 'NOS', 847.46, 18, '', 76.27, 76.27, 0],
]);

console.log('Sample files written to', OUT);

// ------------------------------------------------------------ GST portal "TDS and TCS Credit Received" (demo)
// Field names follow the portal's GSTR-8 style; the tool also accepts other names, Excel downloads and copy-paste.
fs.writeFileSync(path.join(OUT, 'gst_portal_tcs_credit_oct2025.json'), JSON.stringify({
  gstin: SELLER, ret_period: '102025',
  tcs: [
    { ctin: '27AAICA3918J1CT', trdnm: 'Amazon Seller Services Private Limited', supR: 6513.32, retsupR: 476.19, amt: 6037.13, iamt: 25.69, camt: 2.25, samt: 2.25 },
    { ctin: '27AACCF0683K1CS', trdnm: 'Flipkart Internet Private Limited', supR: 2691.73, retsupR: 499, amt: 2192.73, iamt: 6.35, camt: 2.33, samt: 2.33 },
    { ctin: '27AAFCF6235C1C6', trdnm: 'Fashnear Technologies Private Limited', supR: 1767.54, retsupR: 285.71, amt: 1481.83, iamt: 6.0, camt: 0.71, samt: 0.71 },
  ],
}, null, 2));

/*
 * Platform report parsers. Each parser turns one sheet (array of rows, first
 * matching row = headers) into normalized records:
 *
 * { file, row, platform, ecoKey, kind: 'sale'|'return'|'cancel',
 *   invoiceNo, creditNoteNo, creditNoteDate, date, orderId, itemId,
 *   sellerGstin, buyerGstin, pos, posRaw, hsn, desc, qty, uqc,
 *   rate, txval, tax, igst, cgst, sgst, cess, taxProvided }
 *
 * Returns/cancellations are always stored with negative amounts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gst-core.js'));
  else root.GSTParsers = factory(root.GSTCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const key = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

  /** Builds a column finder over a header row. Names ending in '*' match by prefix. */
  function headerIndex(headers) {
    const keys = headers.map(key);
    const find = (...names) => {
      for (const n of names) {
        const k = key(n);
        const i = n.endsWith('*') ? keys.findIndex((h) => h.startsWith(k)) : keys.indexOf(k);
        if (i >= 0) return i;
      }
      return -1;
    };
    return { keys, find, has: (...n) => find(...n) >= 0 };
  }

  const DETECTORS = [
    { platform: 'amazon', test: (h) => h.has('Transaction Type') && h.has('Tax Exclusive Gross', 'Ship To State') },
    { platform: 'flipkart', test: (h) => h.has('Event Sub Type') || (h.has('Event Type') && h.has('Taxable Value*')) },
    { platform: 'meesho', test: (h) => h.has('sub_order_num') && h.has('total_taxable_sale_value') },
    { platform: 'generic', test: (h) => h.has('taxable_value') && h.has('pos_state', 'pos', 'place_of_supply') },
  ];

  /** Finds the header row (within the first 15 rows) and the platform it belongs to. */
  function detect(rows) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const h = headerIndex((rows[i] || []).map((c) => (c == null ? '' : String(c))));
      const d = DETECTORS.find((x) => x.test(h));
      if (d) return { platform: d.platform, headerRow: i, h };
    }
    return null;
  }

  const signed = (kind, v) => (kind === 'sale' ? v : -Math.abs(v));
  const cleanHsn = (v) => String(v == null ? '' : v).replace(/\.0+$/, '').replace(/\D/g, '');
  const str = (v) => (v == null ? '' : String(v).trim());

  function makeGetter(row, h) {
    const get = (...names) => { const i = h.find(...names); return i >= 0 ? row[i] : undefined; };
    const n = (...names) => C.num(get(...names));
    const sum = (...names) => names.reduce((a, nm) => a + n(nm), 0);
    return { get, n, sum };
  }

  // ---------------------------------------------------------------- Amazon MTR (B2C + B2B)
  function amazonRow(row, h) {
    const { get, n, sum } = makeGetter(row, h);
    const tt = key(get('Transaction Type'));
    const kind = tt === 'refund' ? 'return' : tt === 'cancel' ? 'cancel' : 'sale';

    let rate = sum('Cgst Rate', 'Sgst Rate', 'Utgst Rate', 'Igst Rate');
    if (rate > 0 && rate <= 1) rate *= 100; // Amazon gives rates as fractions (0.18)
    rate = Math.round(rate * 1000) / 1000;

    const igst = sum('Igst Tax', 'Shipping Igst Tax', 'Gift Wrap Igst Tax');
    const cgst = sum('Cgst Tax', 'Shipping Cgst Tax', 'Gift Wrap Cgst Tax');
    const sgst = sum('Sgst Tax', 'Utgst Tax', 'Shipping Sgst Tax', 'Shipping Utgst Tax', 'Gift Wrap Sgst Tax', 'Gift Wrap Utgst Tax');
    const tax = h.has('Total Tax Amount') ? n('Total Tax Amount') : igst + cgst + sgst;
    const txval = h.has('Tax Exclusive Gross') ? n('Tax Exclusive Gross')
      : sum('Principal Amount Basis', 'Shipping Amount Basis', 'Gift Wrap Amount Basis') - sum('Item Promo Discount Basis', 'Shipping Promo Discount Basis');
    const posRaw = str(get('Ship To State')) || str(get('Bill To State'));
    const invoiceNo = str(get('Invoice Number'));

    return {
      kind,
      invoiceNo: kind === 'sale' ? invoiceNo : '',
      creditNoteNo: kind === 'sale' ? '' : (str(get('Credit Note No')) || invoiceNo),
      creditNoteDate: C.parseDate(get('Credit Note Date')),
      date: kind === 'return' ? (C.parseDate(get('Credit Note Date')) || C.parseDate(get('Invoice Date'))) : C.parseDate(get('Invoice Date')),
      orderId: str(get('Order Id')),
      itemId: str(get('Shipment Item Id')) || str(get('Order Id')),
      sellerGstin: str(get('Seller Gstin')).toUpperCase(),
      buyerGstin: str(get('Customer Bill To Gstid', 'Customer Ship To Gstid')).toUpperCase(),
      posRaw, pos: C.stateCode(posRaw),
      hsn: cleanHsn(get('Hsn/sac', 'Hsn/Sac', 'HSN')),
      desc: str(get('Item Description')),
      qty: signed(kind, n('Quantity')),
      rate,
      txval: signed(kind, txval),
      tax: signed(kind, tax), igst: signed(kind, igst), cgst: signed(kind, cgst), sgst: signed(kind, sgst),
      cess: signed(kind, sum('Compensatory Cess Tax', 'Shipping Cess Tax Amount', 'Gift Wrap Compensatory Cess Tax')),
      taxProvided: true,
    };
  }

  // ---------------------------------------------------------------- Flipkart Sales Report
  function flipkartRow(row, h) {
    const { get, n } = makeGetter(row, h);
    const ev = key(get('Event Sub Type') || get('Event Type'));
    const kind = ev === 'sale' || ev === 'returncancellation' ? 'sale'
      : ev.indexOf('return') === 0 ? 'return'
        : ev.indexOf('cancel') === 0 ? 'cancel' : 'sale';

    const igstRate = n('IGST Rate'); const cgstRate = n('CGST Rate'); const sgstRate = n('SGST Rate*');
    let rate = igstRate || (cgstRate + sgstRate);
    if (rate > 0 && rate < 1 && C.snapRate(rate * 100) != null && C.snapRate(rate) == null) rate *= 100;

    const igst = n('IGST Amount'); const cgst = n('CGST Amount'); const sgst = n('SGST Amount*');
    const posRaw = str(get("Customer's Delivery State", 'Customers Delivery State')) || str(get("Customer's Billing State"));

    return {
      kind,
      invoiceNo: kind === 'sale' ? str(get('Buyer Invoice ID')) : '',
      creditNoteNo: '',
      date: C.parseDate(get('Buyer Invoice Date')) || C.parseDate(get('Order Date')),
      orderId: str(get('Order ID')),
      itemId: str(get('Order Item ID')),
      sellerGstin: str(get('Seller GSTIN')).toUpperCase(),
      buyerGstin: str(get('Business GST Number', 'Buyer GSTIN', 'Customer GSTIN')).toUpperCase(),
      posRaw, pos: C.stateCode(posRaw),
      hsn: cleanHsn(get('HSN Code')),
      desc: str(get('Product Title/Description', 'Product Title')),
      qty: signed(kind, n('Item Quantity')),
      rate,
      txval: signed(kind, n('Taxable Value*')),
      tax: signed(kind, igst + cgst + sgst), igst: signed(kind, igst), cgst: signed(kind, cgst), sgst: signed(kind, sgst),
      cess: signed(kind, n('Luxury Cess Amount')),
      taxProvided: true,
    };
  }

  // ---------------------------------------------------------------- Meesho tcs_sales / tcs_sales_return
  function meeshoRow(row, h, ctx) {
    const { get, n } = makeGetter(row, h);
    const kind = ctx.meeshoReturn ? 'return' : 'sale';
    const posRaw = str(get('end_customer_state_new', 'end_customer_state'));
    const tax = n('tax_amount');
    return {
      kind,
      invoiceNo: '',
      creditNoteNo: '',
      date: C.parseDate(get('cancel_return_date')) || C.parseDate(get('order_date')),
      orderId: str(get('sub_order_num')),
      itemId: str(get('sub_order_num')),
      sellerGstin: str(get('gstin', 'supplier_gstin')).toUpperCase(),
      buyerGstin: '',
      posRaw, pos: C.stateCode(posRaw),
      hsn: cleanHsn(get('hsn_code')),
      desc: '',
      qty: signed(kind, n('quantity')),
      rate: h.has('gst_rate') ? n('gst_rate') : null,
      txval: signed(kind, n('total_taxable_sale_value')),
      tax: signed(kind, tax), igst: 0, cgst: 0, sgst: 0, cess: 0,
      taxProvided: h.has('tax_amount'),
    };
  }

  // ---------------------------------------------------------------- Generic template (any other platform / own website)
  function genericRow(row, h) {
    const { get, n } = makeGetter(row, h);
    const t = key(get('type'));
    const kind = t === 'returncancellation' || t === 'returncancelled' ? 'sale'
      : /return|refund|creditnote|rto/.test(t) ? 'return'
        : /cancel/.test(t) ? 'cancel' : 'sale';
    const platform = str(get('platform'));
    const igst = n('igst'); const cgst = n('cgst'); const sgst = n('sgst');
    const taxProvided = h.has('igst', 'cgst', 'sgst') && (igst || cgst || sgst || n('gst_rate') === 0);
    const posRaw = str(get('pos_state', 'pos', 'place_of_supply'));
    const rateCell = get('gst_rate', 'rate');
    return {
      ecoKey: platform ? key(platform) : '',
      ecoLabel: platform,
      kind,
      invoiceNo: kind === 'sale' ? str(get('invoice_no', 'invoice_number')) : '',
      creditNoteNo: kind === 'sale' ? '' : str(get('credit_note_no', 'invoice_no', 'invoice_number')),
      date: C.parseDate(get('invoice_date', 'date')),
      orderId: str(get('order_id')),
      itemId: str(get('order_item_id', 'order_id')),
      sellerGstin: str(get('seller_gstin')).toUpperCase(),
      buyerGstin: str(get('buyer_gstin')).toUpperCase(),
      posRaw, pos: C.stateCode(posRaw),
      hsn: cleanHsn(get('hsn')),
      desc: str(get('description')),
      qty: signed(kind, n('qty', 'quantity')),
      uqc: str(get('uqc')).toUpperCase() || 'NOS',
      rate: rateCell === undefined || rateCell === '' ? null : C.num(rateCell),
      txval: signed(kind, n('taxable_value')),
      tax: signed(kind, igst + cgst + sgst), igst: signed(kind, igst), cgst: signed(kind, cgst), sgst: signed(kind, sgst),
      cess: signed(kind, n('cess')),
      taxProvided,
    };
  }

  const ROW_PARSERS = { amazon: amazonRow, flipkart: flipkartRow, meesho: meeshoRow, generic: genericRow };

  /** Parses one sheet given as an array of arrays. Returns null if the format is not recognised. */
  function parseTable(rows, file, sheet) {
    const d = detect(rows);
    if (!d) return null;
    const ctx = { meeshoReturn: d.platform === 'meesho' && (/return/i.test(file || '') || /return/i.test(sheet || '') || d.h.has('cancel_return_date')) };
    const records = [];
    for (let i = d.headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
      const rec = ROW_PARSERS[d.platform](row, d.h, ctx);
      rec.file = file + (sheet ? ' [' + sheet + ']' : '');
      rec.row = i + 1;
      rec.platform = d.platform;
      if (rec.uqc == null) rec.uqc = 'NOS';
      if (d.platform !== 'generic') rec.ecoKey = d.platform;
      records.push(rec);
    }
    return { platform: d.platform, isReturnFile: ctx.meeshoReturn, headerRow: d.headerRow, records };
  }

  /**
   * Some marketplace exports (notably Flipkart) store a wrong <dimension> such as "A1:BD1",
   * which makes SheetJS read only the header row. Recompute the range from the actual cells.
   */
  function fixSheetRange(XLSX, ws) {
    let maxR = -1; let maxC = -1;
    Object.keys(ws).forEach((k) => {
      if (k[0] === '!') return;
      const a = XLSX.utils.decode_cell(k);
      if (a.r > maxR) maxR = a.r;
      if (a.c > maxC) maxC = a.c;
    });
    if (maxR < 0) return false;
    const want = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    const had = ws['!ref'];
    if (had) {
      const r = XLSX.utils.decode_range(had);
      if (r.e.r >= maxR && r.e.c >= maxC) return false;
    }
    ws['!ref'] = want;
    return true;
  }

  /** First non-empty row (likely the header), for diagnostics and the column mapper. */
  function previewHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const filled = (rows[i] || []).filter((c) => String(c).trim() !== '').length;
      if (filled >= 3) return { headerRow: i, headers: rows[i].map((c) => String(c == null ? '' : c).trim()) };
    }
    return { headerRow: 0, headers: (rows[0] || []).map((c) => String(c == null ? '' : c).trim()) };
  }

  /** Signature used to remember a user's column mapping for the same report layout. */
  function headerSignature(headers) {
    return headers.map(key).filter(Boolean).join('|');
  }

  /**
   * Parses every sheet of a SheetJS workbook.
   * mappings: { [headerSignature]: mapping } saved by the user for unknown layouts (see applyMapping).
   */
  function parseWorkbook(XLSX, wb, file, mappings) {
    const result = { file, sheets: [], records: [], unrecognized: [], raw: [] };
    wb.SheetNames.forEach((name) => {
      const ws = wb.Sheets[name];
      const fixed = fixSheetRange(XLSX, ws);
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
      const sheetLabel = wb.SheetNames.length > 1 ? name : '';
      let parsed = parseTable(rows, file, sheetLabel);
      const pv = previewHeader(rows);
      const sig = headerSignature(pv.headers);
      if (!parsed && mappings && mappings[sig]) parsed = applyMapping(rows, mappings[sig], file, sheetLabel);
      if (!parsed) {
        if (rows.length) {
          result.unrecognized.push(name);
          result.raw.push({ sheet: name, sheetLabel, rows, headerRow: pv.headerRow, headers: pv.headers, signature: sig, dataRows: Math.max(0, rows.length - pv.headerRow - 1) });
        }
        return;
      }
      result.sheets.push({ sheet: name, platform: parsed.platform, label: parsed.label, mapped: !!parsed.mapped, isReturnFile: parsed.isReturnFile, count: parsed.records.length, rangeFixed: fixed, dataRows: Math.max(0, rows.length - (parsed.headerRow || 0) - 1) });
      parsed.records.forEach((r) => result.records.push(r));
    });
    return result;
  }

  // ---------------------------------------------------------------- manual column mapping
  /** Fields the user can map for an unknown report. `need` = required for a usable result. */
  const MAP_FIELDS = [
    { f: 'taxable_value', label: 'Taxable value (tax se pehle)', need: true, hints: ['taxablevalue', 'taxable', 'taxexclusive', 'assessable', 'netsale', 'salevalue'] },
    { f: 'pos_state', label: 'Customer state (place of supply)', need: true, hints: ['deliverystate', 'shiptostate', 'customerstate', 'placeofsupply', 'pos', 'state', 'billingstate'] },
    { f: 'gst_rate', label: 'GST rate %', hints: ['gstrate', 'taxrate', 'rate', 'igstrate'] },
    { f: 'igst', label: 'IGST amount', hints: ['igstamount', 'igsttax', 'igst'] },
    { f: 'cgst', label: 'CGST amount', hints: ['cgstamount', 'cgsttax', 'cgst'] },
    { f: 'sgst', label: 'SGST/UTGST amount', hints: ['sgstamount', 'sgsttax', 'utgstamount', 'sgst'] },
    { f: 'total_tax', label: 'Total tax amount (agar alag-alag nahi hai)', hints: ['totaltax', 'taxamount', 'gstamount'] },
    { f: 'cess', label: 'Cess amount', hints: ['cessamount', 'cess'] },
    { f: 'hsn', label: 'HSN code', hints: ['hsn', 'hsncode', 'hsnsac'] },
    { f: 'qty', label: 'Quantity', hints: ['quantity', 'qty', 'itemquantity', 'units'] },
    { f: 'invoice_no', label: 'Invoice number', hints: ['invoicenumber', 'invoiceno', 'invoiceid', 'buyerinvoiceid'] },
    { f: 'invoice_date', label: 'Invoice / order date', hints: ['invoicedate', 'buyerinvoicedate', 'orderdate', 'date'] },
    { f: 'type', label: 'Type (sale / return / cancel)', hints: ['eventsubtype', 'transactiontype', 'eventtype', 'type', 'ordertype'] },
    { f: 'order_id', label: 'Order ID', hints: ['orderitemid', 'suborderno', 'orderid', 'suborder'] },
    { f: 'buyer_gstin', label: 'Buyer GSTIN (B2B)', hints: ['buyergstin', 'customergstin', 'billtogstid', 'businessgst'] },
    { f: 'seller_gstin', label: 'Seller (aapka) GSTIN', hints: ['sellergstin', 'suppliergstin', 'gstin'] },
    { f: 'description', label: 'Product description', hints: ['producttitle', 'itemdescription', 'productname', 'description', 'title'] },
  ];

  /** Best-guess mapping of headers to fields, used to pre-fill the mapper. */
  function suggestMapping(headers) {
    const keys = headers.map(key);
    const used = new Set();
    const cols = {};
    MAP_FIELDS.forEach((fd) => {
      for (const h of fd.hints) {
        let i = keys.findIndex((k, idx) => !used.has(idx) && k === h);
        if (i < 0) i = keys.findIndex((k, idx) => !used.has(idx) && k && k.indexOf(h) >= 0 && !/tcs|tds|rate/.test(k.replace(h, '')) );
        if (i >= 0) { cols[fd.f] = i; used.add(i); break; }
      }
    });
    return cols;
  }

  /**
   * Parses rows with a user-defined mapping:
   * { headerRow, cols: { field: columnIndex }, platform: 'Myntra' | '', allReturns: bool, ratesAreFractions: bool }
   */
  function applyMapping(rows, m, file, sheet) {
    const width = rows.reduce((a, r) => Math.max(a, (r || []).length), 0);
    const hdr = new Array(width).fill('');
    Object.keys(m.cols || {}).forEach((f) => { const i = m.cols[f]; if (i != null && i >= 0) hdr[i] = f === 'total_tax' ? '__total_tax' : f; });
    const h = headerIndex(hdr);
    const records = [];
    for (let i = (m.headerRow || 0) + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
      const rec = genericRow(row, h);
      if (m.allReturns && rec.kind === 'sale') {
        rec.kind = 'return';
        ['txval', 'tax', 'igst', 'cgst', 'sgst', 'cess', 'qty'].forEach((k) => { rec[k] = -Math.abs(rec[k] || 0); });
        rec.creditNoteNo = rec.invoiceNo; rec.invoiceNo = '';
      }
      const ti = h.find('__total_tax');
      if (ti >= 0 && !(rec.igst || rec.cgst || rec.sgst)) {
        const t = C.num(row[ti]);
        rec.tax = rec.kind === 'sale' ? t : -Math.abs(t);
        rec.taxProvided = true;
      }
      if (rec.rate != null && m.ratesAreFractions && rec.rate > 0 && rec.rate <= 1) rec.rate = Math.round(rec.rate * 100000) / 1000;
      const plat = String(m.platform || '').trim();
      rec.ecoKey = plat ? key(plat) : '';
      rec.ecoLabel = plat;
      rec.file = file + (sheet ? ' [' + sheet + ']' : '');
      rec.row = i + 1;
      rec.platform = 'generic';
      if (!rec.uqc) rec.uqc = 'NOS';
      records.push(rec);
    }
    return { platform: 'generic', label: m.platform || 'Mapped', mapped: true, isReturnFile: !!m.allReturns, headerRow: m.headerRow || 0, records };
  }

  const GENERIC_TEMPLATE_HEADERS = ['platform', 'invoice_no', 'invoice_date', 'type', 'order_id', 'buyer_gstin', 'pos_state', 'hsn', 'description', 'qty', 'uqc', 'taxable_value', 'gst_rate', 'igst', 'cgst', 'sgst', 'cess'];

  return { parseTable, parseWorkbook, detect, fixSheetRange, applyMapping, suggestMapping, headerSignature, MAP_FIELDS, GENERIC_TEMPLATE_HEADERS };
});

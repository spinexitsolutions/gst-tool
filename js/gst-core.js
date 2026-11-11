/*
 * GST core: state codes, GSTIN validation, number/date helpers,
 * verification and GSTR-1 JSON builder.
 *
 * Works in the browser (window.GSTCore) and in Node (module.exports),
 * so the same logic is covered by the tests in /tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GSTCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- states
  const STATES = {
    '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
    '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
    '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
    '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
    '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
    '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
    '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
    '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
    '97': 'Other Territory',
  };

  const STATE_ALIASES = {
    ORISSA: '21', PONDICHERRY: '34', UTTARANCHAL: '05', NEWDELHI: '07', NCTOFDELHI: '07',
    DAMANANDDIU: '26', DAMANDIU: '26', DADRANAGARHAVELI: '26', DADRAANDNAGARHAVELI: '26',
    DADRAANDNAGARHAVELIANDDAMANANDDIU: '26', DNHDD: '26', ANDAMANANDNICOBAR: '35',
    ANDAMANNICOBAR: '35', ANDAMANNICOBARISLANDS: '35', JAMMUKASHMIR: '01', CHATTISGARH: '22',
    TELENGANA: '36', TAMILNADU: '33', OTHERTERRITORY: '97',
    // two-letter abbreviations
    JK: '01', HP: '02', PB: '03', CH: '04', UK: '05', UT: '05', HR: '06', DL: '07', RJ: '08',
    UP: '09', BR: '10', SK: '11', AR: '12', NL: '13', MN: '14', MZ: '15', TR: '16', ML: '17',
    AS: '18', WB: '19', JH: '20', OD: '21', OR: '21', CG: '22', CT: '22', MP: '23', GJ: '24',
    DN: '26', DD: '26', DH: '26', MH: '27', KA: '29', GA: '30', LD: '31', KL: '32', TN: '33',
    PY: '34', AN: '35', TS: '36', TG: '36', AP: '37', LA: '38', OT: '97',
  };

  const STATE_BY_NAME = {};
  Object.keys(STATES).forEach((code) => { STATE_BY_NAME[normKey(STATES[code])] = code; });

  function normKey(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/&/g, 'AND').replace(/[^A-Z0-9]/g, '');
  }

  /** Converts a state name / abbreviation / code ("Maharashtra", "MH", "27", 27) to a 2-digit code. */
  function stateCode(value) {
    if (value == null || value === '') return null;
    const raw = String(value).trim();
    if (/^\d{1,2}$/.test(raw)) {
      const c = raw.padStart(2, '0');
      if (c === '25') return '26';
      if (c === '28') return '37';
      return STATES[c] ? c : null;
    }
    const k = normKey(raw);
    return STATE_BY_NAME[k] || STATE_ALIASES[k] || null;
  }

  // ---------------------------------------------------------------- GSTIN
  const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function gstinChecksum(first14) {
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const v = GSTIN_CHARS.indexOf(first14[i]);
      if (v < 0) return null;
      const p = v * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(p / 36) + (p % 36);
    }
    return GSTIN_CHARS[(36 - (sum % 36)) % 36];
  }

  /** Validates format + check digit. Accepts normal (..Z.) and TCS/ECO (..C.) GSTINs. */
  function isValidGSTIN(gstin) {
    const g = String(gstin || '').trim().toUpperCase();
    if (!/^\d{2}[A-Z0-9]{13}$/.test(g)) return false;
    if (!STATES[g.slice(0, 2)] && g.slice(0, 2) !== '99') return false;
    return gstinChecksum(g.slice(0, 14)) === g[14];
  }

  // ---------------------------------------------------------------- helpers
  function round2(n) {
    const v = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    return Object.is(v, -0) ? 0 : v;
  }

  /** Parses numbers like "1,234.50", "₹ 99", "(12.5)", "" -> 0. */
  function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v).trim().replace(/[₹,\s]|INR|Rs\.?/gi, '');
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return neg ? -n : n;
  }

  const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

  /** Parses Date objects, Excel serials, ISO, dd-mm-yyyy, dd/mm/yyyy, dd-Mon-yyyy. Returns a Date at local midnight or null. */
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) { // Excel serial date
        const d = new Date(Math.round((v - 25569) * 86400000));
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
      return null;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return mkDate(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) return mkDate(fullYear(+m[3]), +m[2] - 1, +m[1]);
    m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{2,4})/);
    if (m && MONTHS[m[2].toUpperCase()] != null) return mkDate(fullYear(+m[3]), MONTHS[m[2].toUpperCase()], +m[1]);
    m = s.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && MONTHS[m[1].toUpperCase()] != null) return mkDate(+m[3], MONTHS[m[1].toUpperCase()], +m[2]);
    return null;
  }
  function fullYear(y) { return y < 100 ? 2000 + y : y; }
  function mkDate(y, mo, d) {
    const dt = new Date(y, mo, d);
    return dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d ? dt : null;
  }

  function fmtDate(d) {
    if (!d) return '';
    return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
  }

  /** GST slabs in percent. 12 and 28 remain valid for periods before 22-Sep-2025. */
  const VALID_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

  function snapRate(r) {
    let best = null; let diff = Infinity;
    VALID_RATES.forEach((v) => { const d = Math.abs(v - r); if (d < diff) { diff = d; best = v; } });
    return diff <= 0.3 ? best : null;
  }

  function isValidRate(r) { return VALID_RATES.indexOf(Number(r)) >= 0; }

  // ---------------------------------------------------------------- issues
  /** Collects validation issues, grouping repeats of the same problem so huge files stay readable. */
  function IssueLog() { this.map = new Map(); }
  IssueLog.prototype.add = function (level, code, message, ctx) {
    ctx = ctx || {};
    const key = level + '|' + code + '|' + (ctx.file || '') + '|' + (ctx.platform || '');
    let it = this.map.get(key);
    if (!it) {
      it = { level, code, message, file: ctx.file || '', platform: ctx.platform || '', count: 0, examples: [] };
      this.map.set(key, it);
    }
    it.count++;
    if (ctx.example && it.examples.length < 5) it.examples.push(ctx.example);
  };
  IssueLog.prototype.list = function () {
    const order = { error: 0, warning: 1, info: 2 };
    return Array.from(this.map.values()).sort((a, b) => order[a.level] - order[b.level]);
  };

  const PLATFORM_LABELS = { amazon: 'Amazon', flipkart: 'Flipkart', meesho: 'Meesho', generic: 'Own website / Other' };

  // ---------------------------------------------------------------- processing
  /**
   * Verifies normalized records and builds the GSTR-1 JSON plus summaries.
   *
   * records: output of GSTParsers.parse*() — see parsers.js for the shape.
   * opts: { gstin, period: 'MMYYYY', ecoGstins: {amazon, flipkart, ...},
   *         excludeOutOfPeriod: bool, includeDocs: bool, version }
   */
  function processRecords(records, opts) {
    const log = new IssueLog();
    const gstin = String(opts.gstin || '').trim().toUpperCase();
    const fp = String(opts.period || '');
    const ecoGstins = opts.ecoGstins || {};

    if (!isValidGSTIN(gstin)) log.add('error', 'GSTIN', 'Aapka GSTIN galat hai (format/checksum fail). Sahi GSTIN daaliye.');
    if (!/^(0[1-9]|1[0-2])\d{4}$/.test(fp)) log.add('error', 'PERIOD', 'Return period (month/year) select kijiye.');
    const homeState = gstin.slice(0, 2);
    const master = opts.hsnMaster || null; // { code: description } from the official HSN_SAC list
    const minHsnDigits = opts.aatoAbove5Cr ? 6 : 4;
    const pMonth = +fp.slice(0, 2) - 1; const pYear = +fp.slice(2);

    const used = [];
    const stats = { totalRows: records.length, used: 0, skippedCancel: 0, skippedOtherGstin: 0, skippedOutOfPeriod: 0, skippedZero: 0 };

    records.forEach((r) => {
      const ctx = { file: r.file, platform: r.platform, example: 'Row ' + r.row + (r.orderId ? ' (Order ' + r.orderId + ')' : '') };

      if (r.sellerGstin && gstin && r.sellerGstin.toUpperCase() !== gstin) {
        stats.skippedOtherGstin++;
        log.add('warning', 'OTHER_GSTIN', 'Ye rows kisi doosre GSTIN (' + r.sellerGstin + ') ki hain, isliye shamil nahi ki gayi.', ctx);
        return;
      }
      if (r.kind === 'cancel' && !r.txval && !r.tax) { stats.skippedCancel++; return; }

      if (r.date && fp) {
        if (r.date.getMonth() !== pMonth || r.date.getFullYear() !== pYear) {
          if (opts.excludeOutOfPeriod) {
            stats.skippedOutOfPeriod++;
            log.add('warning', 'OUT_OF_PERIOD_SKIPPED', 'Date return period se bahar hai — ye rows hata di gayi.', ctx);
            return;
          }
          log.add('warning', 'OUT_OF_PERIOD', 'Date return period se bahar hai (fir bhi shamil hai). Check kijiye ki sahi mahine ki report hai.', ctx);
        }
      } else if (!r.date) {
        log.add('info', 'NO_DATE', 'Date nahi mili — period check nahi ho paya.', ctx);
      }

      // Place of supply
      let pos = r.pos;
      if (!pos) {
        log.add('error', 'POS', 'Customer ka state (place of supply) samajh nahi aaya: "' + (r.posRaw || '') + '". Ye rows home state maan kar li gayi hain — file check kijiye.', ctx);
        pos = homeState;
      }
      const intra = pos === homeState;

      // Rate
      let rate = r.rate;
      if (rate == null || !isFinite(rate) || (rate === 0 && r.tax)) {
        const inferred = r.txval && r.taxProvided ? snapRate(Math.abs(r.tax / r.txval) * 100) : null;
        if (inferred == null) {
          log.add('error', 'RATE_MISSING', 'GST rate nahi mila aur tax se bhi nikal nahi paya.', ctx);
          rate = 0;
        } else {
          log.add('info', 'RATE_INFERRED', 'GST rate file mein nahi tha — tax amount se nikala gaya (' + inferred + '%).', ctx);
          rate = inferred;
        }
      } else if (!isValidRate(rate)) {
        const s = snapRate(rate);
        log.add('error', 'RATE_INVALID', 'GST rate ' + rate + '% valid slab nahi hai' + (s != null ? ' — ' + s + '% maana gaya.' : '.'), ctx);
        rate = s == null ? rate : s;
      }

      // Tax: verify against rate, then split by intra/inter
      const expected = (r.txval * rate) / 100;
      let tax = r.tax;
      if (r.taxProvided) {
        if (Math.abs(expected - tax) > Math.max(1, Math.abs(expected) * 0.01)) {
          log.add('warning', 'TAX_MISMATCH', 'Tax amount, taxable value × rate se match nahi karta (file ka tax hi use kiya gaya).', { file: r.file, platform: r.platform, example: ctx.example + ': taxable ' + round2(r.txval) + ' × ' + rate + '% = ' + round2(expected) + ', file mein ' + round2(tax) });
        }
        if (intra && r.igst && Math.abs(r.igst) > 0.01) log.add('warning', 'SPLIT_IGST_INTRA', 'Same state ki sale par IGST lagaya gaya hai — CGST+SGST hona chahiye. JSON mein CGST/SGST mein baant diya gaya.', ctx);
        if (!intra && (Math.abs(r.cgst || 0) > 0.01 || Math.abs(r.sgst || 0) > 0.01)) log.add('warning', 'SPLIT_CGST_INTER', 'Doosre state ki sale par CGST/SGST lagaya gaya hai — IGST hona chahiye. JSON mein IGST maana gaya.', ctx);
      } else {
        tax = expected;
      }

      if (!r.hsn) log.add('warning', 'HSN_MISSING', 'HSN code nahi hai — HSN summary mein "NA" jayega, portal reject kar sakta hai.', ctx);
      else if (!/^\d{4,8}$/.test(r.hsn)) log.add('warning', 'HSN_FORMAT', 'HSN code 4–8 digit ka hona chahiye: "' + r.hsn + '".', ctx);
      else if (r.hsn.length < minHsnDigits) log.add('warning', 'HSN_DIGITS', 'Turnover ₹5 crore se zyada hai, isliye HSN kam se kam 6 digit ka hona chahiye.', { file: r.file, platform: r.platform, example: ctx.example + ': ' + r.hsn });
      if (r.hsn && master) {
        const m = hsnLookup(master, r.hsn);
        if (!m.found) log.add('error', 'HSN_NOT_IN_MASTER', 'HSN code GST ki official HSN list mein nahi hai — portal JSON reject karega. Sahi HSN daaliye.', { file: r.file, platform: r.platform, example: ctx.example + ': ' + r.hsn });
        else if (!m.exact) log.add('warning', 'HSN_PARTIAL_MASTER', 'Ye ' + r.hsn.length + '-digit HSN official list mein nahi hai, sirf iska ' + m.code.length + '-digit heading (' + m.code + ') hai. Portal par HSN dropdown se sahi code check kijiye.', { file: r.file, platform: r.platform, example: ctx.example + ': ' + r.hsn });
      }

      let b2b = false;
      if (r.buyerGstin) {
        if (isValidGSTIN(r.buyerGstin)) b2b = true;
        else log.add('warning', 'BUYER_GSTIN', 'Buyer GSTIN galat hai (' + r.buyerGstin + ') — sale B2C mein daali gayi.', ctx);
      }

      if (!r.txval && !tax) { stats.skippedZero++; return; }

      used.push({
        src: r, platform: r.platform, kind: r.kind, pos, intra, rate, b2b,
        txval: r.txval, cess: r.cess || 0,
        iamt: intra ? 0 : tax, camt: intra ? tax / 2 : 0, samt: intra ? tax / 2 : 0,
      });
    });
    stats.used = used.length;
    if (!records.length) log.add('error', 'NO_DATA', 'Koi data nahi mila. Platform ki report files upload kijiye.');

    checkHsnConsistency(used, log);

    // Duplicate rows (same platform + order item + event + amount)
    const seen = new Set();
    records.forEach((r) => {
      if (!r.itemId) return;
      const k = [r.platform, r.itemId, r.kind, round2(r.txval), r.invoiceNo, r.creditNoteNo, r.debitNoteNo, r.adjustment ? 'adj' : ''].join('|');
      if (seen.has(k)) log.add('warning', 'DUPLICATE', 'Duplicate row mili — kahin same file do baar to upload nahi hui?', { file: r.file, platform: r.platform, example: 'Row ' + r.row + ' (' + r.itemId + ')' });
      seen.add(k);
    });

    const out = buildGstr1(used, { gstin, fp, homeState, ecoGstins, master, includeDocs: opts.includeDocs !== false, version: opts.version, log });
    out.stats = stats;
    out.issues = log.list();
    out.errorCount = out.issues.filter((i) => i.level === 'error').length;
    return out;
  }

  function addAmt(t, s) {
    t.txval += s.txval; t.iamt += s.iamt; t.camt += s.camt; t.samt += s.samt; t.csamt += s.cess;
  }
  function zeroAmt() { return { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }; }
  function roundAmt(o) {
    ['txval', 'iamt', 'camt', 'samt', 'csamt', 'val', 'qty'].forEach((k) => { if (k in o) o[k] = round2(o[k]); });
    return o;
  }

  function buildGstr1(rows, cfg) {
    const { gstin, fp, homeState, ecoGstins, log } = cfg;
    const b2csMap = new Map(); const b2bMap = new Map(); const cdnrMap = new Map(); const b2clMap = new Map();
    const hsnMap = new Map(); const ecoMap = new Map(); const platMap = new Map(); const nilMap = new Map();

    // B2CL: inter-state invoice to unregistered buyer with invoice value above ₹1 lakh
    const invTotals = new Map();
    rows.forEach((s) => {
      if (s.b2b || s.intra || s.kind !== 'sale' || !s.src.invoiceNo) return;
      const k = s.platform + '|' + s.src.invoiceNo;
      invTotals.set(k, (invTotals.get(k) || 0) + s.txval + s.iamt + s.cess);
    });

    rows.forEach((s) => {
      const r = s.src;
      const pk = r.ecoKey || s.platform;
      const p = platMap.get(pk) || { platform: pk, label: r.ecoLabel || PLATFORM_LABELS[s.platform] || pk, sales: zeroAmt(), returns: zeroAmt(), net: zeroAmt(), rows: 0 };
      p.rows++;
      addAmt(s.kind === 'sale' ? p.sales : p.returns, s); addAmt(p.net, s);
      platMap.set(pk, p);

      // Table 14: supplies through e-commerce operators (TCS u/s 52)
      if (s.platform !== 'generic' || r.ecoKey) {
        const ek = r.ecoKey || s.platform;
        const e = ecoMap.get(ek) || Object.assign({ key: ek, label: r.ecoLabel || PLATFORM_LABELS[s.platform] || ek, sales: 0, returns: 0, inter: 0, intra: 0 }, zeroAmt());
        addAmt(e, s);
        if (s.kind === 'sale') e.sales += s.txval; else e.returns += s.txval;
        if (s.intra) e.intra += s.txval; else e.inter += s.txval;
        ecoMap.set(ek, e);
      }

      // HSN summary (Table 12) split into B2B / B2C
      const hk = (s.b2b ? 'B2B' : 'B2C') + '|' + (r.hsn || 'NA') + '|' + s.rate;
      const h = hsnMap.get(hk) || Object.assign({ b2b: s.b2b, hsn_sc: r.hsn || 'NA', desc: '', uqc: r.uqc || 'NOS', qty: 0, rt: s.rate }, zeroAmt());
      addAmt(h, s); h.qty += r.qty || 0; if (!h.desc && r.desc) h.desc = String(r.desc).slice(0, 30);
      hsnMap.set(hk, h);

      if (s.rate === 0) { // nil/exempt supplies go to Table 8, not B2CS/B2B
        const ty = (s.intra ? 'INTRA' : 'INTER') + (s.b2b ? 'B2B' : 'B2C');
        nilMap.set(ty, (nilMap.get(ty) || 0) + s.txval);
        return;
      }

      if (s.b2b) {
        if (s.kind === 'sale') {
          const invNo = r.invoiceNo || ('ORD-' + (r.orderId || r.row));
          if (!r.invoiceNo) log.add('warning', 'B2B_NO_INVOICE', 'B2B sale mein invoice number nahi hai — Order ID use kiya gaya.', { file: r.file, platform: r.platform, example: 'Row ' + r.row });
          const k = r.buyerGstin + '|' + invNo;
          const inv = b2bMap.get(k) || { ctin: r.buyerGstin, inum: invNo, idt: fmtDate(r.date), pos: s.pos, val: 0, items: new Map() };
          addLine(inv, s); b2bMap.set(k, inv);
        } else {
          const ntNo = r.creditNoteNo || ('CN-' + (r.invoiceNo || r.orderId || r.row));
          if (!r.creditNoteNo) log.add('warning', 'B2B_NO_CN', 'B2B return ka credit note number nahi mila — "' + ntNo + '" use kiya gaya. Platform se sahi number check kijiye.', { file: r.file, platform: r.platform, example: 'Row ' + r.row });
          const k = r.buyerGstin + '|' + ntNo;
          const nt = cdnrMap.get(k) || { ctin: r.buyerGstin, nt_num: ntNo, nt_dt: fmtDate(r.creditNoteDate || r.date), pos: s.pos, val: 0, items: new Map() };
          addLine(nt, s, true); cdnrMap.set(k, nt);
        }
        return;
      }

      if (!s.intra && s.kind === 'sale' && r.invoiceNo && invTotals.get(s.platform + '|' + r.invoiceNo) > 100000) {
        const k = s.pos + '|' + r.invoiceNo;
        const inv = b2clMap.get(k) || { pos: s.pos, inum: r.invoiceNo, idt: fmtDate(r.date), val: 0, items: new Map() };
        addLine(inv, s); b2clMap.set(k, inv);
        return;
      }

      const sply = s.intra ? 'INTRA' : 'INTER';
      const bk = s.pos + '|' + s.rate + '|' + sply;
      const b = b2csMap.get(bk) || Object.assign({ sply_ty: sply, rt: s.rate, typ: 'OE', pos: s.pos }, zeroAmt());
      addAmt(b, s); b2csMap.set(bk, b);
    });

    const json = { gstin, fp, version: cfg.version || 'GST3.2.1', hash: 'hash' };

    const b2cs = Array.from(b2csMap.values()).map((b) => {
      const o = { sply_ty: b.sply_ty, rt: b.rt, typ: 'OE', pos: b.pos, txval: b.txval, csamt: b.csamt };
      if (b.sply_ty === 'INTER') o.iamt = b.iamt; else { o.camt = b.camt; o.samt = b.samt; }
      roundAmt(o);
      if (o.txval < 0) log.add('warning', 'B2CS_NEGATIVE', 'State ' + b.pos + ' / ' + b.rt + '% mein returns sales se zyada hain (net negative). Portal accept karta hai, par check kar lijiye.');
      return o;
    }).filter((o) => o.txval || o.iamt || o.camt || o.samt || o.csamt)
      .sort((a, b) => a.pos.localeCompare(b.pos) || a.rt - b.rt);
    if (b2cs.length) json.b2cs = b2cs;

    if (b2bMap.size) {
      const byCtin = new Map();
      b2bMap.forEach((inv) => {
        const list = byCtin.get(inv.ctin) || [];
        list.push({ inum: inv.inum, idt: inv.idt, val: round2(inv.val), pos: inv.pos, rchrg: 'N', inv_typ: 'R', itms: lineItems(inv) });
        byCtin.set(inv.ctin, list);
      });
      json.b2b = Array.from(byCtin.entries()).map(([ctin, inv]) => ({ ctin, inv }));
    }

    if (b2clMap.size) {
      const byPos = new Map();
      b2clMap.forEach((inv) => {
        const list = byPos.get(inv.pos) || [];
        list.push({ inum: inv.inum, idt: inv.idt, val: round2(inv.val), itms: lineItems(inv) });
        byPos.set(inv.pos, list);
      });
      json.b2cl = Array.from(byPos.entries()).map(([pos, inv]) => ({ pos, inv }));
    }

    if (cdnrMap.size) {
      const byCtin = new Map();
      cdnrMap.forEach((nt) => {
        const list = byCtin.get(nt.ctin) || [];
        list.push({ ntty: 'C', nt_num: nt.nt_num, nt_dt: nt.nt_dt, val: round2(nt.val), pos: nt.pos, rchrg: 'N', inv_typ: 'R', itms: lineItems(nt) });
        byCtin.set(nt.ctin, list);
      });
      json.cdnr = Array.from(byCtin.entries()).map(([ctin, nt]) => ({ ctin, nt }));
    }

    if (nilMap.size) {
      json.nil = { inv: Array.from(nilMap.entries()).map(([sply_ty, amt]) => ({ sply_ty, nil_amt: 0, expt_amt: round2(amt), ngsup_amt: 0 })) };
      log.add('info', 'NIL_RATED', '0% GST wali sale Table 8 mein "Exempted" ke roop mein daali gayi. Agar ye nil-rated hai to portal par column badal lijiye.');
    }

    const hsnRows = Array.from(hsnMap.values());
    const hsnOut = (list) => list.sort((a, b) => a.hsn_sc.localeCompare(b.hsn_sc) || a.rt - b.rt).map((h, i) => {
      const official = cfg.master ? hsnLookup(cfg.master, h.hsn_sc) : null;
      const desc = official && official.found ? official.desc : h.desc;
      const o = { num: i + 1, hsn_sc: h.hsn_sc, desc: String(desc || '').slice(0, 30), user_desc: String(h.desc || desc || '').slice(0, 30), uqc: h.uqc, qty: h.qty, rt: h.rt, txval: h.txval, iamt: h.iamt, camt: h.camt, samt: h.samt, csamt: h.csamt };
      return roundAmt(o);
    });
    const hsn_b2b = hsnOut(hsnRows.filter((h) => h.b2b));
    const hsn_b2c = hsnOut(hsnRows.filter((h) => !h.b2b));
    if (hsn_b2b.length || hsn_b2c.length) json.hsn = { hsn_b2b, hsn_b2c };

    // Table 13: documents issued (invoice / credit note series per platform)
    const docSeries = cfg.includeDocs ? buildDocSeries(rows) : [];
    if (docSeries.length) {
      const byType = new Map();
      docSeries.forEach((d) => {
        const list = byType.get(d.doc_num) || [];
        list.push({ num: list.length + 1, from: d.from, to: d.to, totnum: d.totnum, cancel: 0, net_issue: d.totnum });
        byType.set(d.doc_num, list);
      });
      json.doc_issue = { doc_det: Array.from(byType.entries()).map(([doc_num, docs]) => ({ doc_num, docs })) };
    }

    // Table 14(a): supplies through ECOs who collect TCS
    const eco = [];
    const ecoRows = Array.from(ecoMap.values()).map((e) => {
      const etin = String(ecoGstins[e.key] || '').trim().toUpperCase();
      const row = { platform: e.key, label: e.label, etin, suppval: round2(e.txval), igst: round2(e.iamt), cgst: round2(e.camt), sgst: round2(e.samt), cess: round2(e.csamt),
        sales: round2(e.sales), returns: round2(-e.returns), inter: round2(e.inter), intra: round2(e.intra) };
      if (!etin) log.add('warning', 'ECO_GSTIN_MISSING', e.label + ' ka TCS GSTIN nahi diya — Table 14 mein ye platform nahi jayega. (GST portal → TCS credit received / GSTR-2B mein milta hai.)', { platform: e.key });
      else if (!isValidGSTIN(etin)) log.add('error', 'ECO_GSTIN_INVALID', e.label + ' ka TCS GSTIN galat hai: ' + etin);
      else if (etin.slice(0, 2) !== homeState) log.add('warning', 'ECO_GSTIN_STATE', e.label + ' ka TCS GSTIN aapke state (' + homeState + ') ka nahi hai — aapke state wala GSTIN daaliye.');
      if (etin && isValidGSTIN(etin)) eco.push({ etin, suppval: row.suppval, igst: row.igst, cgst: row.cgst, sgst: row.sgst, cess: row.cess });
      return row;
    });
    if (eco.length) {
      // merge in case two platforms were given the same ECO GSTIN
      const merged = new Map();
      eco.forEach((e) => {
        const m = merged.get(e.etin) || { etin: e.etin, suppval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
        ['suppval', 'igst', 'cgst', 'sgst', 'cess'].forEach((k) => { m[k] = round2(m[k] + e[k]); });
        merged.set(e.etin, m);
      });
      json.supeco = { clttx: Array.from(merged.values()) };
    }

    // Summaries for screen / Excel / GSTR-3B
    const total = zeroAmt(); rows.forEach((s) => addAmt(total, s));
    const interUnreg = new Map();
    rows.forEach((s) => {
      if (s.intra || s.b2b || s.rate === 0) return;
      const t = interUnreg.get(s.pos) || { pos: s.pos, txval: 0, iamt: 0 };
      t.txval += s.txval; t.iamt += s.iamt; interUnreg.set(s.pos, t);
    });
    const taxable = zeroAmt(); rows.forEach((s) => { if (s.rate !== 0) addAmt(taxable, s); });
    const nilTotal = rows.filter((s) => s.rate === 0).reduce((a, s) => a + s.txval, 0);

    return {
      json,
      summary: {
        total: roundAmt(total),
        platforms: Array.from(platMap.values()).map((p) => ({ platform: p.platform, label: p.label, rows: p.rows, sales: roundAmt(p.sales), returns: roundAmt(p.returns), net: roundAmt(p.net) })),
        eco: ecoRows,
        hsn: hsnRows.map((h) => {
          const m = cfg.master ? hsnLookup(cfg.master, h.hsn_sc) : null;
          const status = !cfg.master ? 'unchecked' : !m.found ? 'invalid' : m.exact ? 'ok' : 'partial';
          const heading = m && m.found && h.hsn_sc.length > 4 ? cfg.master[h.hsn_sc.slice(0, 4)] : null;
          const official = m && m.found ? (heading && heading !== m.desc ? heading + ' › ' + m.desc : m.desc) : '';
          return roundAmt({ type: h.b2b ? 'B2B' : 'B2C', hsn_sc: h.hsn_sc, desc: h.desc, official, status, uqc: h.uqc, qty: h.qty, rt: h.rt, txval: h.txval, iamt: h.iamt, camt: h.camt, samt: h.samt, csamt: h.csamt });
        }),
        docs: docSeries,
        gstr3b: {
          t31a: roundAmt(taxable),
          t31c: round2(nilTotal),
          t32: Array.from(interUnreg.values()).map((t) => roundAmt(t)).filter((t) => t.txval || t.iamt).sort((a, b) => a.pos.localeCompare(b.pos)),
        },
      },
    };
  }

  /** Looks a code up in the official list; falls back to its 6/4/2-digit heading. */
  function hsnLookup(master, code) {
    const c = String(code || '');
    if (master[c] != null) return { found: true, exact: true, code: c, desc: master[c] };
    for (let len = c.length - 2; len >= 4; len -= 2) {
      const p = c.slice(0, len);
      if (master[p] != null) return { found: true, exact: false, code: p, desc: master[p] };
    }
    return { found: false, exact: false, code: c, desc: '' };
  }

  /** Same product (SKU) with different HSN codes, and one HSN sold at several GST rates. */
  function checkHsnConsistency(rows, log) {
    const bySku = new Map(); const byHsn = new Map();
    rows.forEach((s) => {
      const r = s.src;
      if (r.hsn && r.sku) {
        const m = bySku.get(r.sku) || new Map();
        if (!m.has(r.hsn)) m.set(r.hsn, r.ecoLabel || PLATFORM_LABELS[r.platform]);
        bySku.set(r.sku, m);
      }
      if (r.hsn && s.rate) {
        const set = byHsn.get(r.hsn) || new Set();
        set.add(s.rate); byHsn.set(r.hsn, set);
      }
    });
    bySku.forEach((m, sku) => {
      if (m.size < 2) return;
      log.add('warning', 'HSN_SKU_CONFLICT', 'Ek hi product (SKU) alag-alag HSN code ke saath bika hai. Har platform par ek hi sahi HSN rakhiye.',
        { example: 'SKU ' + sku + ': ' + Array.from(m.entries()).map(([h, p]) => h + ' (' + p + ')').join(', ') });
    });
    byHsn.forEach((set, hsn) => {
      if (set.size < 2) return;
      log.add('info', 'HSN_MULTI_RATE', 'Ek HSN code alag-alag GST rate par bika hai. Kapdon/joote jaise price-based slab mein ye sahi ho sakta hai, warna rate check kijiye.',
        { example: 'HSN ' + hsn + ': ' + Array.from(set).sort((a, b) => a - b).join('%, ') + '%' });
    });
  }

  /** TCS rate (total %) the e-commerce operator collects for a return period 'MMYYYY'. */
  function tcsRate(fp) {
    const ym = +String(fp).slice(2) * 100 + +String(fp).slice(0, 2);
    return ym >= 202407 ? 0.5 : 1; // reduced from 1% to 0.5% w.e.f. 10-Jul-2024
  }

  /**
   * Compares sales computed from platform reports with the "TCS credit received" figures
   * that each e-commerce operator reported on the GST portal (GSTR-8).
   * portal: { [platformKey]: { gross, returns, net, igst, cgst, sgst } } (any can be blank)
   */
  function reconcileTcs(ecoRows, portal, fp) {
    const rate = tcsRate(fp);
    return ecoRows.map((e) => {
      const p = (portal && portal[e.platform]) || {};
      const has = (k) => p[k] !== '' && p[k] != null && isFinite(num(p[k]));
      const v = (k) => (has(k) ? num(p[k]) : null);
      const gross = v('gross'); const returns = v('returns') == null ? null : Math.abs(v('returns'));
      let net = v('net');
      if (net == null && gross != null) net = gross - (returns || 0);
      const expected = { igst: round2(e.inter * rate / 100), cgst: round2(e.intra * rate / 200), sgst: round2(e.intra * rate / 200) };
      const out = {
        platform: e.platform, label: e.label, etin: e.etin, rate,
        ours: { gross: e.sales, returns: e.returns, net: e.suppval, inter: e.inter, intra: e.intra },
        portal: { gross, returns, net, igst: v('igst'), cgst: v('cgst'), sgst: v('sgst') },
        expectedTcs: expected, notes: [],
      };
      if (net == null) { out.status = 'pending'; return out; }

      out.diffNet = round2(e.suppval - net);
      const tol = Math.max(100, Math.abs(net) * 0.005);
      out.status = Math.abs(out.diffNet) <= 1 ? 'match' : Math.abs(out.diffNet) <= tol ? 'minor' : 'mismatch';
      if (gross != null) out.diffGross = round2(e.sales - gross);
      if (returns != null) out.diffReturns = round2(e.returns - returns);

      // The TCS amounts tell how the platform split the value between inter-state (IGST) and intra-state (CGST+SGST)
      const pi = v('igst'); const pc = v('cgst'); const ps = v('sgst');
      if (pi != null || pc != null || ps != null) {
        out.diffTcs = { igst: pi == null ? null : round2(expected.igst - pi), cgst: pc == null ? null : round2(expected.cgst - pc), sgst: ps == null ? null : round2(expected.sgst - ps) };
        out.impliedInter = pi == null ? null : round2(pi * 100 / rate);
        out.impliedIntra = pc == null && ps == null ? null : round2(((pc || 0) + (ps || 0)) * 100 / rate);
        const tcsOff = [out.diffTcs.igst, out.diffTcs.cgst, out.diffTcs.sgst].some((d) => d != null && Math.abs(d) > Math.max(5, Math.abs(net) * rate / 100 * 0.01));
        if (tcsOff) out.notes.push('TCS amount aapki sale ke ' + rate + '% se match nahi karta. Inter-state (IGST) aur same-state (CGST+SGST) ka bantwara check kijiye — platform ne customer state alag maani ho sakti hai.');
        if (out.status === 'match' && tcsOff) out.status = 'minor';
      }
      if (out.status !== 'match') {
        if (out.diffGross != null && Math.abs(out.diffGross) > tol) out.notes.push('Gross sale mein ₹' + round2(Math.abs(out.diffGross)) + ' ka farak — kuch orders report mein chhoot gaye ya doosre mahine mein gine gaye (shipped vs delivered date). Saari report files upload hui hain na?');
        if (out.diffReturns != null && Math.abs(out.diffReturns) > tol) out.notes.push('Returns mein ₹' + round2(Math.abs(out.diffReturns)) + ' ka farak — platform pichhle mahine ki sale ke returns is mahine ghata deta hai; cancellation/RTO alag gine ja sakte hain.');
        if (out.diffNet > 0) out.notes.push('Aapki sale portal se zyada hai — portal par kam TCS dikha hai. Ho sakta hai platform ne kuch orders agle mahine report kiye hon.');
        else out.notes.push('Portal par sale aapki report se zyada hai — kahin koi report file (B2B, cashback, returns) upload karna to nahi bhoole?');
      }
      return out;
    });
  }

  function addLine(doc, s, isNote) {
    const it = doc.items.get(s.rate) || Object.assign({ rt: s.rate }, zeroAmt());
    const sign = isNote ? -1 : 1; // credit notes are reported with positive values
    it.txval += sign * s.txval; it.iamt += sign * s.iamt; it.camt += sign * s.camt; it.samt += sign * s.samt; it.csamt += sign * s.cess;
    doc.items.set(s.rate, it);
    doc.val += sign * (s.txval + s.iamt + s.camt + s.samt + s.cess);
  }

  function lineItems(doc) {
    return Array.from(doc.items.values()).map((it, i) => {
      const d = { txval: round2(it.txval), rt: it.rt };
      if (it.iamt) d.iamt = round2(it.iamt);
      if (it.camt || it.samt) { d.camt = round2(it.camt); d.samt = round2(it.samt); }
      if (!it.iamt && !it.camt && !it.samt) d.iamt = 0;
      d.csamt = round2(it.csamt);
      return { num: Math.round(it.rt * 100) + i + 1, itm_det: d };
    });
  }

  /** Groups invoice / credit-note numbers into series by their non-numeric prefix. */
  function buildDocSeries(rows) {
    const series = new Map();
    const seen = new Set();
    rows.forEach((s) => {
      const r = s.src;
      const isNote = s.kind !== 'sale';
      const no = r.debitNoteNo || (isNote ? r.creditNoteNo : r.invoiceNo);
      if (!no) return;
      const docNum = r.debitNoteNo ? 4 : isNote ? 5 : 1; // 1 = invoices for outward supply, 4 = debit notes, 5 = credit notes
      const key = s.platform + '|' + docNum + '|' + no;
      if (seen.has(key)) return;
      seen.add(key);
      const m = String(no).match(/^(.*?)(\d+)$/);
      const prefix = m ? m[1] : String(no);
      const n = m ? parseInt(m[2], 10) : 0;
      const sk = s.platform + '|' + docNum + '|' + prefix + '|' + (m ? m[2].length : 0);
      const ser = series.get(sk) || { platform: s.platform, doc_num: docNum, from: no, to: no, min: n, max: n, totnum: 0 };
      if (n < ser.min) { ser.min = n; ser.from = no; }
      if (n > ser.max) { ser.max = n; ser.to = no; }
      ser.totnum++;
      series.set(sk, ser);
    });
    return Array.from(series.values()).map((s) => ({ platform: s.platform, doc_num: s.doc_num, from: s.from, to: s.to, totnum: s.totnum }));
  }

  return {
    STATES, VALID_RATES, PLATFORM_LABELS,
    stateCode, isValidGSTIN, gstinChecksum, round2, num, parseDate, fmtDate, snapRate, isValidRate, normKey,
    processRecords, IssueLog, reconcileTcs, tcsRate, hsnLookup,
  };
});

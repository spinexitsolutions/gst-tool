/* UI wiring: file loading, settings, rendering of results and downloads. */
(function () {
  'use strict';
  const C = window.GSTCore;
  const P = window.GSTParsers;
  const $ = (id) => document.getElementById(id);

  const state = { files: [], result: null, tab: 'b2cs' };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOC_TYPES = { 1: 'Invoices for outward supply', 5: 'Credit Note' };

  const store = {
    get(k, d) { try { const v = localStorage.getItem('gsttool.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('gsttool.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const stateName = (code) => (C.STATES[code] ? code + ' - ' + C.STATES[code] : code);

  // ------------------------------------------------------------ settings
  function initSettings() {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1); // returns are usually filed for last month
    $('month').innerHTML = MONTHS.map((m, i) => '<option value="' + (i + 1) + '">' + m + '</option>').join('');
    let years = '';
    for (let y = now.getFullYear() + 1; y >= 2017; y--) years += '<option>' + y + '</option>';
    $('year').innerHTML = years;
    $('month').value = String(prev.getMonth() + 1);
    $('year').value = String(prev.getFullYear());
    $('gstin').value = store.get('gstin', '');
    showGstinInfo();

    $('gstin').addEventListener('input', () => { $('gstin').value = $('gstin').value.toUpperCase().replace(/\s/g, ''); showGstinInfo(); store.set('gstin', $('gstin').value); recompute(); });
    ['month', 'year', 'excludeOut', 'includeDocs'].forEach((id) => $(id).addEventListener('change', recompute));
  }

  function showGstinInfo() {
    const g = $('gstin').value;
    const el = $('gstinInfo');
    if (!g) { el.textContent = '15 digit GSTIN daaliye'; el.className = 'hint'; return; }
    if (C.isValidGSTIN(g)) { el.textContent = '✓ Valid — State: ' + C.STATES[g.slice(0, 2)]; el.className = 'hint ok-text'; }
    else { el.textContent = g.length < 15 ? 'Abhi ' + g.length + '/15 characters' : '✗ GSTIN galat hai (checksum match nahi hua)'; el.className = 'hint err-text'; }
  }

  function period() { return String($('month').value).padStart(2, '0') + $('year').value; }

  // ------------------------------------------------------------ files
  function initFiles() {
    const drop = $('drop');
    $('files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
    $('dlTemplate').addEventListener('click', (e) => { e.preventDefault(); downloadTemplate(); });
  }

  function addFiles(list) {
    Array.from(list).forEach((f) => {
      if (state.files.some((x) => x.name === f.name && x.size === f.size)) return; // same file twice
      const reader = new FileReader();
      reader.onload = () => {
        const entry = { name: f.name, size: f.size };
        try {
          const isCsv = /\.csv$/i.test(f.name);
          const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: true, raw: isCsv });
          Object.assign(entry, P.parseWorkbook(XLSX, wb, f.name));
        } catch (err) {
          entry.error = 'File padh nahi paye: ' + err.message;
          entry.records = []; entry.sheets = []; entry.unrecognized = [];
        }
        state.files.push(entry);
        renderFiles();
        recompute();
      };
      reader.readAsArrayBuffer(f);
    });
  }

  function renderFiles() {
    $('fileList').innerHTML = state.files.map((f, i) => {
      let badges = f.sheets.map((s) => '<span class="badge ' + s.platform + '">' + esc(C.PLATFORM_LABELS[s.platform]) + (s.isReturnFile ? ' (returns)' : '') + ' · ' + s.count + ' rows' + (f.sheets.length > 1 || s.sheet !== 'Sheet1' ? ' · ' + esc(s.sheet) : '') + '</span>').join(' ');
      if (f.error) badges = '<span class="badge bad">' + esc(f.error) + '</span>';
      else if (!f.sheets.length) badges = '<span class="badge bad">Format pehchana nahi gaya — sahi report ya template use kijiye</span>';
      const skipped = f.unrecognized.length && f.sheets.length ? '<span class="hint">Chhodi gayi sheets: ' + esc(f.unrecognized.join(', ')) + '</span>' : '';
      return '<div class="file"><span class="name">📄 ' + esc(f.name) + '</span>' + badges + skipped + '<button class="x" title="Hatao" data-i="' + i + '">×</button></div>';
    }).join('');
    $('fileList').querySelectorAll('.x').forEach((b) => b.addEventListener('click', () => { state.files.splice(+b.dataset.i, 1); renderFiles(); recompute(); }));
  }

  // ------------------------------------------------------------ processing
  function ecoGstins() { return store.get('eco.' + $('gstin').value, {}); }

  function recompute() {
    const records = state.files.reduce((a, f) => a.concat(f.records), []);
    if (!state.files.length) { $('results').hidden = true; $('ecoCard').hidden = true; state.result = null; return; }
    state.result = C.processRecords(records, {
      gstin: $('gstin').value, period: period(), ecoGstins: ecoGstins(),
      excludeOutOfPeriod: $('excludeOut').checked, includeDocs: $('includeDocs').checked,
    });
    state.records = records;
    render();
  }

  function renderEco() {
    const eco = state.result.summary.eco;
    $('ecoCard').hidden = !eco.length;
    const saved = ecoGstins();
    const focused = document.activeElement && document.activeElement.dataset.eco;
    $('ecoInputs').innerHTML = eco.map((e) => {
      const v = saved[e.platform] || '';
      const ok = v && C.isValidGSTIN(v);
      return '<label>' + esc(e.label) + ' — TCS GSTIN<input data-eco="' + esc(e.platform) + '" maxlength="15" value="' + esc(v) + '" placeholder="' + esc($('gstin').value.slice(0, 2) || '27') + 'XXXXX0000X1C?">' +
        '<small class="hint ' + (v ? (ok ? 'ok-text' : 'err-text') : '') + '">' + (v ? (ok ? '✓ Valid' : '✗ Galat GSTIN') : 'Net sale: ₹' + money(e.suppval)) + '</small></label>';
    }).join('');
    $('ecoInputs').querySelectorAll('input').forEach((inp) => {
      if (inp.dataset.eco === focused) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      inp.addEventListener('input', () => {
        inp.value = inp.value.toUpperCase().replace(/\s/g, '');
        const all = ecoGstins(); all[inp.dataset.eco] = inp.value;
        store.set('eco.' + $('gstin').value, all);
        if (!inp.value || inp.value.length === 15) recompute();
      });
    });
  }

  function table(cols, rows, totalRow) {
    if (!rows.length) return '<p class="hint">Is section mein koi entry nahi hai.</p>';
    const th = cols.map((c) => '<th class="' + (c.n ? 'n' : '') + '">' + esc(c.h) + '</th>').join('');
    const tr = (r, cls) => '<tr class="' + (cls || '') + '">' + cols.map((c) => {
      const v = typeof c.k === 'function' ? c.k(r) : r[c.k];
      return '<td class="' + (c.n ? 'n' : '') + '">' + (c.n && typeof v === 'number' ? (c.int ? v.toLocaleString('en-IN') : money(v)) : esc(v)) + '</td>';
    }).join('') + '</tr>';
    return '<table><thead><tr>' + th + '</tr></thead><tbody>' + rows.map((r) => tr(r)).join('') + (totalRow ? tr(totalRow, 'total') : '') + '</tbody></table>';
  }

  function sumRows(rows, keys, label) {
    const t = { _label: label || 'Total' };
    keys.forEach((k) => { t[k] = C.round2(rows.reduce((a, r) => a + (Number(typeof k === 'function' ? k(r) : r[k]) || 0), 0)); });
    return t;
  }

  function render() {
    const R = state.result;
    $('results').hidden = false;
    renderEco();

    const errs = R.issues.filter((i) => i.level === 'error').length;
    const warns = R.issues.filter((i) => i.level === 'warning').length;
    $('status').innerHTML = errs
      ? '<div class="banner err">✗ ' + errs + ' error(s) mile — neeche verification report dekh kar theek kijiye.</div>'
      : warns ? '<div class="banner warn">⚠ JSON ready hai, par ' + warns + ' warning(s) ek baar check kar lijiye.</div>'
        : '<div class="banner ok">✓ Sab verify ho gaya — JSON download karke GST portal par upload kijiye.</div>';

    const t = R.summary.total;
    const kp = [['Net taxable value', t.txval], ['IGST', t.iamt], ['CGST', t.camt], ['SGST/UTGST', t.samt], ['Cess', t.csamt], ['Total tax', t.iamt + t.camt + t.samt + t.csamt]];
    $('kpis').innerHTML = kp.map(([l, v]) => '<div class="kpi"><div class="l">' + l + '</div><div class="v">₹' + money(v) + '</div></div>').join('') +
      '<div class="kpi"><div class="l">Rows used / total</div><div class="v">' + R.stats.used + ' / ' + R.stats.totalRows + '</div></div>';

    const plats = R.summary.platforms.map((p) => ({ label: p.label, rows: p.rows, sales: p.sales.txval, returns: p.returns.txval, net: p.net.txval, tax: p.net.iamt + p.net.camt + p.net.samt, invoice: p.net.txval + p.net.iamt + p.net.camt + p.net.samt + p.net.csamt }));
    $('platforms').innerHTML = table([
      { h: 'Platform', k: (r) => r.label || r._label }, { h: 'Rows', k: 'rows', n: 1, int: 1 }, { h: 'Sales (taxable)', k: 'sales', n: 1 },
      { h: 'Returns (taxable)', k: 'returns', n: 1 }, { h: 'Net taxable', k: 'net', n: 1 }, { h: 'Net tax', k: 'tax', n: 1 }, { h: 'Net invoice value', k: 'invoice', n: 1 },
    ], plats, plats.length > 1 ? sumRows(plats, ['rows', 'sales', 'returns', 'net', 'tax', 'invoice']) : null);

    const s = R.stats;
    const skipped = [];
    if (s.skippedCancel) skipped.push(s.skippedCancel + ' cancelled orders (zero value)');
    if (s.skippedOtherGstin) skipped.push(s.skippedOtherGstin + ' doosre GSTIN ki rows');
    if (s.skippedOutOfPeriod) skipped.push(s.skippedOutOfPeriod + ' period ke bahar ki rows');
    if (s.skippedZero) skipped.push(s.skippedZero + ' zero value rows');
    $('issues').innerHTML = (R.issues.length ? R.issues.map((i) =>
      '<div class="issue ' + i.level + '"><b>' + { error: 'Error', warning: 'Warning', info: 'Info' }[i.level] + ':</b> ' + esc(i.message) +
      '<div class="meta">' + (i.count > 1 ? i.count + ' rows' : '') + (i.file ? ' · ' + esc(i.file) : '') + '</div>' +
      (i.examples.length ? '<ul>' + i.examples.map((e) => '<li>' + esc(e) + '</li>').join('') + (i.count > i.examples.length ? '<li>…</li>' : '') + '</ul>' : '') + '</div>'
    ).join('') : '<div class="issue info">Koi problem nahi mili. ✓</div>') +
      (skipped.length ? '<p class="hint">Shamil nahi kiya: ' + skipped.join(', ') + '.</p>' : '');

    $('dlJson').disabled = !C.isValidGSTIN($('gstin').value);
    renderTab();
  }

  function renderTab() {
    const R = state.result; const j = R.json; const S = R.summary;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    const amtCols = [{ h: 'Taxable value', k: 'txval', n: 1 }, { h: 'IGST', k: 'iamt', n: 1 }, { h: 'CGST', k: 'camt', n: 1 }, { h: 'SGST', k: 'samt', n: 1 }, { h: 'Cess', k: 'csamt', n: 1 }];
    const amtKeys = ['txval', 'iamt', 'camt', 'samt', 'csamt'];
    let html = '';
    switch (state.tab) {
      case 'b2cs': {
        const rows = j.b2cs || [];
        html = table([{ h: 'Place of supply', k: (r) => r._label || stateName(r.pos) }, { h: 'Type', k: 'sply_ty' }, { h: 'Rate %', k: 'rt' }].concat(amtCols), rows, rows.length ? sumRows(rows, amtKeys) : null);
        break;
      }
      case 'b2b': {
        const inv = [];
        (j.b2b || []).forEach((c) => c.inv.forEach((i) => i.itms.forEach((it) => inv.push(Object.assign({ sec: 'B2B (4A)', party: c.ctin, no: i.inum, dt: i.idt, pos: i.pos, val: i.val }, it.itm_det)))));
        (j.cdnr || []).forEach((c) => c.nt.forEach((i) => i.itms.forEach((it) => inv.push(Object.assign({ sec: 'Credit note (9B)', party: c.ctin, no: i.nt_num, dt: i.nt_dt, pos: i.pos, val: i.val }, it.itm_det)))));
        (j.b2cl || []).forEach((c) => c.inv.forEach((i) => i.itms.forEach((it) => inv.push(Object.assign({ sec: 'B2CL (5)', party: 'Unregistered', no: i.inum, dt: i.idt, pos: c.pos, val: i.val }, it.itm_det)))));
        html = table([{ h: 'Table', k: 'sec' }, { h: 'Buyer GSTIN', k: 'party' }, { h: 'Doc no.', k: 'no' }, { h: 'Date', k: 'dt' }, { h: 'POS', k: (r) => stateName(r.pos) }, { h: 'Doc value', k: 'val', n: 1 }, { h: 'Rate %', k: 'rt' }].concat(amtCols), inv);
        break;
      }
      case 'hsn':
        html = table([{ h: 'B2B/B2C', k: 'type' }, { h: 'HSN', k: 'hsn_sc' }, { h: 'Description', k: 'desc' }, { h: 'UQC', k: 'uqc' }, { h: 'Qty', k: 'qty', n: 1 }, { h: 'Rate %', k: 'rt' }].concat(amtCols), S.hsn, S.hsn.length ? sumRows(S.hsn, amtKeys.concat(['qty'])) : null);
        break;
      case 'eco':
        html = table([{ h: 'Platform', k: (r) => r.label || r._label }, { h: 'ECO GSTIN', k: (r) => r.etin || (r._label ? '' : '— nahi diya —') }, { h: 'Net value', k: 'suppval', n: 1 }, { h: 'IGST', k: 'igst', n: 1 }, { h: 'CGST', k: 'cgst', n: 1 }, { h: 'SGST', k: 'sgst', n: 1 }, { h: 'Cess', k: 'cess', n: 1 }], S.eco) +
          '<p class="hint">Table 14(a): woh supplies jin par e-commerce operator TCS (Sec 52) kaat-ta hai. Sirf woh platforms JSON mein jaate hain jinka valid GSTIN diya gaya hai.</p>';
        break;
      case 'docs':
        html = table([{ h: 'Platform', k: (r) => C.PLATFORM_LABELS[r.platform] || r.platform }, { h: 'Document type', k: (r) => DOC_TYPES[r.doc_num] }, { h: 'From', k: 'from' }, { h: 'To', k: 'to' }, { h: 'Total', k: 'totnum' }], S.docs) +
          '<p class="hint">Invoice series report mein aaye numbers se banayi gayi hai (cancelled = 0 maana gaya). Meesho report mein invoice number nahi hota — Meesho ki series portal par khud daaliye.</p>';
        break;
      case 'g3b': {
        const a = S.gstr3b.t31a;
        html = '<h3>Table 3.1 — Outward supplies</h3>' + table([{ h: 'Nature of supply', k: 'n' }].concat(amtCols), [
          Object.assign({ n: '(a) Outward taxable supplies (other than zero/nil/exempt)' }, a),
          { n: '(c) Nil rated / exempted', txval: S.gstr3b.t31c, iamt: 0, camt: 0, samt: 0, csamt: 0 },
        ]) + '<h3>Table 3.2 — Inter-state supplies to unregistered persons</h3>' +
          table([{ h: 'Place of supply', k: (r) => r._label || stateName(r.pos) }, { h: 'Taxable value', k: 'txval', n: 1 }, { h: 'IGST', k: 'iamt', n: 1 }], S.gstr3b.t32, S.gstr3b.t32.length ? sumRows(S.gstr3b.t32, ['txval', 'iamt']) : null) +
          '<p class="hint">GSTR-1 file karne ke baad portal GSTR-3B mein ye values khud bhar deta hai. Yahan sirf milaan ke liye hai. ITC (Table 4) aap GSTR-2B se bhariye.</p>';
        break;
      }
      case 'json':
        html = '<pre class="json">' + esc(JSON.stringify(j, null, 2)) + '</pre>';
        break;
    }
    $('tabBody').innerHTML = html;
  }

  // ------------------------------------------------------------ downloads
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function downloadJson() {
    const R = state.result;
    if (!R) return;
    if (R.errorCount && !confirm(R.errorCount + ' error(s) abhi bhi hain. Fir bhi JSON download karein?')) return;
    download('GSTR1_' + R.json.gstin + '_' + R.json.fp + '.json', JSON.stringify(R.json), 'application/json');
  }

  function downloadExcel() {
    const R = state.result; const S = R.summary; const j = R.json;
    const wb = XLSX.utils.book_new();
    const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No data' }]), name);
    const amt = (o) => ({ 'Taxable value': o.txval, IGST: o.iamt || 0, CGST: o.camt || 0, SGST: o.samt || 0, Cess: o.csamt || 0 });
    add('Summary', [
      { Item: 'GSTIN', Value: j.gstin }, { Item: 'Period', Value: MONTHS[+j.fp.slice(0, 2) - 1] + ' ' + j.fp.slice(2) },
      { Item: 'Net taxable value', Value: S.total.txval }, { Item: 'IGST', Value: S.total.iamt }, { Item: 'CGST', Value: S.total.camt },
      { Item: 'SGST', Value: S.total.samt }, { Item: 'Cess', Value: S.total.csamt }, { Item: 'Rows used', Value: R.stats.used }, { Item: 'Rows total', Value: R.stats.totalRows },
      { Item: 'Errors', Value: R.errorCount },
    ]);
    add('Platforms', S.platforms.map((p) => ({ Platform: p.label, Rows: p.rows, 'Sales taxable': p.sales.txval, 'Returns taxable': p.returns.txval, 'Net taxable': p.net.txval, IGST: p.net.iamt, CGST: p.net.camt, SGST: p.net.samt, Cess: p.net.csamt })));
    add('B2CS (Table 7)', (j.b2cs || []).map((b) => Object.assign({ 'Place of supply': stateName(b.pos), Type: b.sply_ty, 'Rate %': b.rt }, amt(b))));
    const b2b = [];
    (j.b2b || []).forEach((c) => c.inv.forEach((i) => i.itms.forEach((it) => b2b.push(Object.assign({ Table: 'B2B', 'Buyer GSTIN': c.ctin, 'Doc no': i.inum, Date: i.idt, POS: stateName(i.pos), 'Doc value': i.val, 'Rate %': it.itm_det.rt }, amt(it.itm_det))))));
    (j.cdnr || []).forEach((c) => c.nt.forEach((i) => i.itms.forEach((it) => b2b.push(Object.assign({ Table: 'CDNR', 'Buyer GSTIN': c.ctin, 'Doc no': i.nt_num, Date: i.nt_dt, POS: stateName(i.pos), 'Doc value': i.val, 'Rate %': it.itm_det.rt }, amt(it.itm_det))))));
    (j.b2cl || []).forEach((c) => c.inv.forEach((i) => i.itms.forEach((it) => b2b.push(Object.assign({ Table: 'B2CL', 'Buyer GSTIN': '', 'Doc no': i.inum, Date: i.idt, POS: stateName(c.pos), 'Doc value': i.val, 'Rate %': it.itm_det.rt }, amt(it.itm_det))))));
    add('B2B-CDNR-B2CL', b2b);
    add('HSN (Table 12)', S.hsn.map((h) => Object.assign({ Type: h.type, HSN: h.hsn_sc, Description: h.desc, UQC: h.uqc, Qty: h.qty, 'Rate %': h.rt }, amt(h))));
    add('ECO (Table 14)', S.eco.map((e) => ({ Platform: e.label, 'ECO GSTIN': e.etin, 'Net value': e.suppval, IGST: e.igst, CGST: e.cgst, SGST: e.sgst, Cess: e.cess })));
    add('Docs (Table 13)', S.docs.map((d) => ({ Platform: C.PLATFORM_LABELS[d.platform] || d.platform, Type: DOC_TYPES[d.doc_num], From: d.from, To: d.to, Total: d.totnum })));
    add('GSTR-3B', [Object.assign({ Table: '3.1(a)' }, amt(S.gstr3b.t31a)), { Table: '3.1(c) Nil/Exempt', 'Taxable value': S.gstr3b.t31c }]
      .concat(S.gstr3b.t32.map((t) => ({ Table: '3.2 Unregistered', POS: stateName(t.pos), 'Taxable value': t.txval, IGST: t.iamt }))));
    add('Verification', R.issues.map((i) => ({ Level: i.level, Message: i.message, Rows: i.count, File: i.file, Examples: i.examples.join(' | ') })));
    add('All rows', state.records.map((r) => ({
      File: r.file, Row: r.row, Platform: r.ecoLabel || C.PLATFORM_LABELS[r.platform], Type: r.kind, 'Invoice/CN no': r.invoiceNo || r.creditNoteNo, Date: C.fmtDate(r.date),
      'Order ID': r.orderId, 'Buyer GSTIN': r.buyerGstin, State: r.posRaw, 'POS code': r.pos, HSN: r.hsn, Qty: r.qty, 'Rate %': r.rate,
      'Taxable value': C.round2(r.txval), Tax: C.round2(r.tax), Cess: C.round2(r.cess),
    })));
    XLSX.writeFile(wb, 'GST_Report_' + j.gstin + '_' + j.fp + '.xlsx');
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([P.GENERIC_TEMPLATE_HEADERS,
      ['JioMart', 'JM/25-26/0001', '08-10-2025', 'sale', 'JM10001', '', 'Kerala', '61091000', 'Cotton T-Shirt', 1, 'NOS', 476.19, 5, 23.81, '', '', 0],
      ['', 'WEB/25-26/0001', '16-10-2025', 'return', 'W1001', '', 'Maharashtra', '73239390', 'Steel Bottle', 1, 'NOS', 423.73, 18, '', 38.14, 38.14, 0]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Column', 'Kya bharna hai'],
      ['platform', 'Platform ka naam (JioMart, Myntra, Shopsy...). Apni website / offline sale ke liye khali chhodiye'],
      ['invoice_no / invoice_date', 'Invoice number aur date (DD-MM-YYYY)'],
      ['type', 'sale ya return'],
      ['buyer_gstin', 'Sirf B2B sale mein buyer ka GSTIN'],
      ['pos_state', 'Customer ka state (naam ya code, jaise Maharashtra / 27)'],
      ['hsn, description, qty, uqc', 'HSN code, product, quantity, unit (NOS, PCS, KGS...)'],
      ['taxable_value', 'Tax se pehle ki value'],
      ['gst_rate', 'GST % (5, 18, 40...)'],
      ['igst / cgst / sgst / cess', 'Tax amounts — khali chhodenge to tool rate se calculate kar lega'],
    ]), 'Instructions');
    XLSX.writeFile(wb, 'other_platforms_template.xlsx');
  }

  // ------------------------------------------------------------ init
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; renderTab(); }));
  $('dlJson').addEventListener('click', downloadJson);
  $('dlExcel').addEventListener('click', downloadExcel);
  initSettings();
  initFiles();
})();

/* UI wiring: file loading, settings, rendering of results and downloads. */
(function () {
  'use strict';
  const C = window.GSTCore;
  const P = window.GSTParsers;
  const $ = (id) => document.getElementById(id);

  const state = { files: [], result: null, tab: 'b2cs' };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const HSN_STATUS = { ok: '✓ Valid', partial: '⚠ Sirf heading valid', invalid: '❌ List mein nahi', unchecked: '—' };
  const TCS_STATUS = { match: '✓ Match', minor: '≈ Thoda farak', mismatch: '✗ Match nahi', pending: '… Portal ke figures daaliye' };
  const DOC_TYPES = { 1: 'Invoices for outward supply', 4: 'Debit Note', 5: 'Credit Note' };

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
    $('aato').value = store.get('aato', 'upto5');
    $('aato').addEventListener('change', () => { store.set('aato', $('aato').value); recompute(); });
    ['month', 'year', 'excludeOut', 'includeDocs'].forEach((id) => $(id).addEventListener('change', recompute));
    initHsnMaster();
  }

  function showGstinInfo() {
    const g = $('gstin').value;
    const el = $('gstinInfo');
    if (!g) { el.textContent = '15 digit GSTIN daaliye'; el.className = 'hint'; return; }
    if (C.isValidGSTIN(g)) { el.textContent = '✓ Valid — State: ' + C.STATES[g.slice(0, 2)]; el.className = 'hint ok-text'; }
    else { el.textContent = g.length < 15 ? 'Abhi ' + g.length + '/15 characters' : '✗ GSTIN galat hai (checksum match nahi hua)'; el.className = 'hint err-text'; }
  }

  // ------------------------------------------------------------ official HSN list
  // Bundled list (js/hsn-master.js); a newer HSN_SAC.xlsx loaded by the user overrides it.
  function initHsnMaster() {
    const custom = store.get('hsnMaster', null);
    state.hsn = custom || window.GST_HSN_MASTER || null;
    showHsnInfo();
    $('hsnFile').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const codes = P.parseHsnMaster(XLSX, XLSX.read(new Uint8Array(reader.result), { type: 'array' }));
          if (Object.keys(codes).length < 1000) throw new Error('isme HSN codes nahi mile');
          state.hsn = { updated: new Date().toISOString().slice(0, 10), codes, custom: true };
          store.set('hsnMaster', state.hsn);
          showHsnInfo();
          recompute();
        } catch (err) { alert('HSN list padh nahi paye: ' + err.message); }
      };
      reader.readAsArrayBuffer(f);
    });
  }

  function showHsnInfo() {
    const h = state.hsn;
    $('hsnInfo').innerHTML = h
      ? '✓ GST ki official HSN/SAC list: <b>' + Object.keys(h.codes).length.toLocaleString('en-IN') + ' codes</b> (' + (h.custom ? 'aapki load ki hui, ' : 'tool ke andar, ') + h.updated + ')'
      : 'HSN list nahi mili — sirf format check hoga';
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
        const entry = { name: f.name, size: f.size, records: [], sheets: [], unrecognized: [], raw: [] };
        try {
          const data = new Uint8Array(reader.result);
          if (/\.(json|zip)$/i.test(f.name)) {
            entry.tcs = readTcsFile(f.name, data);
            if (!entry.tcs.length) entry.error = 'Is file mein TCS credit ka data nahi mila';
          } else {
            const isCsv = /\.csv$/i.test(f.name);
            const wb = XLSX.read(data, { type: 'array', cellDates: true, raw: isCsv });
            Object.assign(entry, P.parseWorkbook(XLSX, wb, f.name, store.get('mappings', {})));
            if (!entry.sheets.length) { // maybe the portal's TCS credit sheet
              const tcs = [];
              entry.raw.forEach((r) => { tcs.push(...P.parseTcsCredit(r.rows, $('gstin').value).entries); });
              if (tcs.length) { entry.tcs = tcs; entry.raw = []; entry.unrecognized = []; }
            }
          }
        } catch (err) {
          entry.error = /password|encrypt/i.test(err.message) ? 'File password-protected hai — Excel mein khol kar bina password ke save kijiye' : 'File padh nahi paye: ' + err.message;
          entry.records = []; entry.sheets = []; entry.unrecognized = []; entry.raw = [];
        }
        state.files.push(entry);
        renderFiles();
        recompute();
      };
      reader.readAsArrayBuffer(f);
    });
  }

  /** TCS credit lines from a portal JSON, or from every JSON inside a ZIP download. */
  function readTcsFile(name, data) {
    const texts = [];
    if (/\.zip$/i.test(name)) {
      const z = XLSX.CFB.read(data, { type: 'array' });
      z.FileIndex.forEach((fi, i) => { if (/\.json$/i.test(z.FullPaths[i]) && fi.content) texts.push(new TextDecoder().decode(fi.content)); });
    } else texts.push(new TextDecoder().decode(data));
    const out = [];
    texts.forEach((t) => {
      let obj;
      try { obj = JSON.parse(t.replace(/^\uFEFF/, '')); } catch (e) { return; }
      const res = P.parseTcsCredit(obj, $('gstin').value, period());
      out.push(...res.entries);
      if (res.periods.length) out.periods = (out.periods || []).concat(res.periods);
    });
    return out;
  }

  // Sheets that look like data (enough columns and rows) — the rest (Help, notes) are just listed.
  const isDataSheet = (r) => r.dataRows > 0 && r.headers.filter(Boolean).length >= 4;

  function renderFiles() {
    $('fileList').innerHTML = state.files.map((f, i) => {
      const parts = [];
      f.sheets.forEach((s) => {
        const label = s.label || (s.mapped ? 'Mapped' : C.PLATFORM_LABELS[s.platform]);
        const where = f.sheets.length > 1 || (s.sheet !== 'Sheet1' && s.sheet) ? ' · ' + esc(s.sheet) : '';
        parts.push('<span class="badge ' + (s.count ? (s.mapped ? 'generic' : s.platform) : 'bad') + '">' + esc(label) + (s.isReturnFile ? ' (returns)' : '') + ' · ' + s.count.toLocaleString('en-IN') + ' rows' + where + '</span>');
        if (s.mapped) parts.push('<span class="hint">aapki column mapping se</span>');
        if (!s.count) parts.push('<span class="hint err-text">Header mila par data rows nahi hain — shayad is mahine is platform par sale nahi hui, ya khali report download hui hai.</span>');
      });
      if (f.tcs && f.tcs.length) parts.push('<span class="badge tcs">GST portal TCS credit · ' + f.tcs.length + ' platform(s)</span><span class="hint">milaan neeche "TCS" box mein</span>');
      if (f.error) parts.push('<span class="badge bad">' + esc(f.error) + '</span>');
      // When a file already has a recognised report sheet, its other sheets (Cash Back, TDS...) are side reports.
      const data = f.sheets.length ? [] : (f.raw || []).filter(isDataSheet);
      const other = (f.raw || []).filter((r) => data.indexOf(r) < 0);
      if (!f.error && !f.sheets.length && !data.length && !(f.tcs && f.tcs.length)) parts.push('<span class="badge bad">Is file mein koi data sheet nahi mili</span>');
      data.forEach((r) => {
        parts.push('<span class="badge bad">Format pehchana nahi gaya' + ((f.raw.length > 1 || f.sheets.length) ? ' · ' + esc(r.sheet) : '') + ' · ' + r.dataRows.toLocaleString('en-IN') + ' rows</span>' +
          '<button class="small primary" data-map="' + i + '|' + esc(r.sheet) + '">Columns khud chuniye</button>');
      });
      if (other.length && (f.sheets.length || data.length)) {
        parts.push('<span class="hint">Chhodi gayi sheets: ' + other.map((r) => isDataSheet(r)
          ? '<a href="#" data-map="' + i + '|' + esc(r.sheet) + '" title="Is sheet ko bhi shamil karna ho to columns chuniye">' + esc(r.sheet) + '</a>'
          : esc(r.sheet)).join(', ') + '</span>');
      }
      return '<div class="file"><span class="name">📄 ' + esc(f.name) + '</span>' + parts.join(' ') + '<button class="x" title="Hatao" data-i="' + i + '">×</button></div>';
    }).join('');
    $('fileList').querySelectorAll('.x').forEach((b) => b.addEventListener('click', () => { state.files.splice(+b.dataset.i, 1); closeMapper(); renderFiles(); recompute(); }));
    $('fileList').querySelectorAll('[data-map]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const [fi, sheet] = b.dataset.map.split(/\|(.*)/s);
      openMapper(+fi, sheet);
    }));
  }

  // ------------------------------------------------------------ column mapper (unknown formats)
  function closeMapper() { $('mapCard').hidden = true; state.map = null; }

  function openMapper(fi, sheet) {
    const f = state.files[fi];
    const raw = f.raw.find((r) => r.sheet === sheet);
    if (!raw) return;
    state.map = { fi, raw, headerRow: raw.headerRow };
    const saved = store.get('mappings', {})[raw.signature];
    state.map.cols = saved ? Object.assign({}, saved.cols) : P.suggestMapping(raw.headers);
    $('mapPlatform').value = saved ? saved.platform || '' : guessPlatform(f.name);
    $('mapReturns').checked = saved ? !!saved.allReturns : /return|refund|rto/i.test(f.name + ' ' + sheet);
    $('mapFraction').checked = saved ? !!saved.ratesAreFractions : false;
    $('mapTitle').textContent = f.name + (f.raw.length > 1 || f.sheets.length ? ' → ' + sheet : '');
    let opts = '';
    for (let r = 0; r < Math.min(raw.rows.length, 15); r++) {
      const cells = (raw.rows[r] || []).filter((c) => String(c).trim() !== '').slice(0, 4).map(String).join(' | ');
      opts += '<option value="' + r + '">Row ' + (r + 1) + ': ' + esc(cells.slice(0, 70)) + '</option>';
    }
    $('mapHeaderRow').innerHTML = opts;
    $('mapHeaderRow').value = String(state.map.headerRow);
    renderMapperFields();
    $('mapCard').hidden = false;
    $('mapCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function guessPlatform(name) {
    const m = String(name).match(/myntra|ajio|jiomart|shopsy|nykaa|snapdeal|glowroad|limeroad|tatacliq|flipkart|amazon|meesho/i);
    return m ? m[0][0].toUpperCase() + m[0].slice(1).toLowerCase() : '';
  }

  function mapperHeaders() {
    const row = state.map.raw.rows[state.map.headerRow] || [];
    return row.map((c, i) => String(c == null || String(c).trim() === '' ? 'Column ' + (i + 1) : c).trim());
  }

  function renderMapperFields() {
    const headers = mapperHeaders();
    const opt = (sel) => '<option value="">— nahi hai —</option>' + headers.map((h, i) => '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(h) + '</option>').join('');
    $('mapFields').innerHTML = P.MAP_FIELDS.map((fd) => '<label>' + esc(fd.label) + (fd.need ? ' <span class="err-text">*</span>' : '') +
      '<select data-f="' + fd.f + '">' + opt(state.map.cols[fd.f]) + '</select></label>').join('');
    $('mapFields').querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
      if (sel.value === '') delete state.map.cols[sel.dataset.f]; else state.map.cols[sel.dataset.f] = +sel.value;
      renderMapperPreview();
    }));
    renderMapperPreview();
  }

  function currentMapping() {
    return { headerRow: state.map.headerRow, cols: state.map.cols, platform: $('mapPlatform').value.trim(), allReturns: $('mapReturns').checked, ratesAreFractions: $('mapFraction').checked };
  }

  function renderMapperPreview() {
    const m = currentMapping();
    const missing = P.MAP_FIELDS.filter((fd) => fd.need && m.cols[fd.f] == null).map((fd) => fd.label);
    const hasTax = ['gst_rate', 'igst', 'cgst', 'sgst', 'total_tax'].some((k) => m.cols[k] != null);
    if (!hasTax) missing.push('GST rate ya tax amount (koi ek)');
    $('mapSave').disabled = missing.length > 0;
    const parsed = P.applyMapping(state.map.raw.rows, m, 'preview', '');
    const sample = parsed.records.slice(0, 5);
    $('mapPreview').innerHTML = (missing.length ? '<div class="issue error">Zaroori: ' + esc(missing.join(', ')) + '</div>' : '') +
      '<p class="hint">' + parsed.records.length.toLocaleString('en-IN') + ' data rows milengi. Pehli ' + sample.length + ' ka preview:</p>' +
      table([{ h: 'Row', k: 'row' }, { h: 'Type', k: 'kind' }, { h: 'Date', k: (r) => C.fmtDate(r.date) }, { h: 'State', k: (r) => (r.pos ? stateName(r.pos) : '❌ ' + (r.posRaw || '')) },
        { h: 'HSN', k: 'hsn' }, { h: 'Qty', k: 'qty' }, { h: 'Rate %', k: (r) => (r.rate == null ? '' : r.rate) }, { h: 'Taxable', k: 'txval', n: 1 }, { h: 'Tax', k: (r) => (r.taxProvided ? r.tax : 'rate se'), n: 1 }], sample);
  }

  function saveMapping() {
    const m = currentMapping();
    const { fi, raw } = state.map;
    const all = store.get('mappings', {});
    all[raw.signature] = m;
    store.set('mappings', all);
    const f = state.files[fi];
    const parsed = P.applyMapping(raw.rows, m, f.name, raw.sheetLabel);
    f.raw = f.raw.filter((r) => r !== raw);
    f.unrecognized = f.unrecognized.filter((n) => n !== raw.sheet);
    f.sheets.push({ sheet: raw.sheet, platform: 'generic', label: parsed.label, mapped: true, isReturnFile: parsed.isReturnFile, count: parsed.records.length });
    f.records = f.records.concat(parsed.records);
    closeMapper();
    renderFiles();
    recompute();
  }

  function initTcsPaste() {
    let timer = null;
    $('tcsPaste').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const text = $('tcsPaste').value;
        state.tcsPaste = text.trim() ? P.parseTcsCredit(text, $('gstin').value, period()).entries : [];
        if (text.trim() && !state.tcsPaste.length) {
          $('tcsStatus').innerHTML = '<div class="issue error">Paste kiye text mein TCS ki line nahi mili. Portal par poori table (GSTIN se SGST tak) select karke copy kijiye.</div>';
          return;
        }
        recompute();
      }, 300);
    });
  }

  function initMapper() {
    $('mapHeaderRow').addEventListener('change', () => {
      state.map.headerRow = +$('mapHeaderRow').value;
      state.map.cols = P.suggestMapping(mapperHeaders());
      renderMapperFields();
    });
    ['mapPlatform', 'mapReturns', 'mapFraction'].forEach((id) => $(id).addEventListener('input', renderMapperPreview));
    $('mapSave').addEventListener('click', saveMapping);
    $('mapCancel').addEventListener('click', closeMapper);
    $('mapCopy').addEventListener('click', () => {
      const text = 'File: ' + $('mapTitle').textContent + '\nColumns: ' + mapperHeaders().join(' | ');
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
        () => { $('mapCopy').textContent = '✓ Copy ho gaya'; setTimeout(() => { $('mapCopy').textContent = 'Column names copy kijiye'; }, 2000); },
        () => prompt('Ye text copy kijiye:', text));
    });
  }

  // ------------------------------------------------------------ processing
  function ecoGstins() { return store.get('eco.' + $('gstin').value, {}); }

  function recompute() {
    const records = state.files.reduce((a, f) => a.concat(f.records), []);
    if (!state.files.length) { $('results').hidden = true; $('ecoCard').hidden = true; $('tcsCard').hidden = true; state.result = null; return; }
    const run = () => C.processRecords(records, {
      gstin: $('gstin').value, period: period(), ecoGstins: ecoGstins(),
      excludeOutOfPeriod: $('excludeOut').checked, includeDocs: $('includeDocs').checked,
      hsnMaster: state.hsn ? state.hsn.codes : null, aatoAbove5Cr: $('aato').value === 'above5',
    });
    state.result = run();
    if (applyTcs()) state.result = run(); // ECO GSTINs taken from the portal data change Table 14
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

  // ------------------------------------------------------------ TCS credit reconciliation
  const TCS_FIELDS = [['gross', 'Gross value of supplies'], ['returns', 'Value of supplies returned'], ['net', 'Net amount liable for TCS'], ['igst', 'IGST (TCS)'], ['cgst', 'CGST (TCS)'], ['sgst', 'SGST/UTGST (TCS)']];
  const tcsKey = () => 'tcs.' + $('gstin').value + '.' + period();
  function tcsPortal() { return store.get(tcsKey(), {}); }

  /** All TCS credit lines from uploaded portal files and the paste box (later sources win). */
  function tcsEntries() {
    const map = new Map();
    state.files.forEach((f) => (f.tcs || []).forEach((e) => map.set(e.etin, e)));
    (state.tcsPaste || []).forEach((e) => map.set(e.etin, e));
    return Array.from(map.values());
  }

  /**
   * Fills portal figures and ECO GSTINs from the portal data, matched to platforms automatically.
   * Returns true when an ECO GSTIN changed (Table 14 must be rebuilt).
   */
  function applyTcs() {
    const entries = tcsEntries();
    state.tcsMatch = [];
    if (!entries.length) return false;
    const eco = state.result.summary.eco;
    const assigned = store.get('tcsAssign', {});
    const pre = []; const rest = [];
    entries.forEach((e) => (assigned[e.etin] && eco.some((x) => x.platform === assigned[e.etin]) ? pre.push({ entry: e, platform: assigned[e.etin], how: 'aapne chuna' }) : rest.push(e)));
    const free = eco.filter((x) => !pre.some((m) => m.platform === x.platform));
    state.tcsMatch = pre.concat(P.matchTcsToPlatforms(rest, free, ecoGstins()));

    const portal = tcsPortal(); const ecoAll = ecoGstins(); let changed = false;
    state.tcsMatch.forEach((m) => {
      if (!m.platform) return;
      portal[m.platform] = {};
      TCS_FIELDS.forEach(([f]) => { if (m.entry[f] != null) portal[m.platform][f] = String(m.entry[f]); });
      if (ecoAll[m.platform] !== m.entry.etin) { ecoAll[m.platform] = m.entry.etin; changed = true; }
    });
    store.set(tcsKey(), portal);
    if (changed) store.set('eco.' + $('gstin').value, ecoAll);
    return changed;
  }

  function renderTcs() {
    const eco = state.result.summary.eco;
    $('tcsCard').hidden = !eco.length;
    if (!eco.length) return;

    const match = state.tcsMatch || [];
    const label = (p) => (eco.find((e) => e.platform === p) || {}).label || p;
    let status = '';
    if (!match.length) status = '<div class="issue info">Portal ka TCS data abhi nahi mila — upar diye kisi bhi tarike se daaliye. Tool khud har platform se milaa dega.</div>';
    else {
      const ok = match.filter((m) => m.platform);
      status = '<div class="issue info">✓ GST portal ke data se <b>' + ok.length + '</b> platform apne aap bhare gaye: ' +
        ok.map((m) => esc(label(m.platform)) + ' <span class="hint">(' + esc(m.entry.etin) + ', ' + esc(m.how === 'naam' ? 'naam se pehchana' : m.how === 'GSTIN' ? 'GSTIN se pehchana' : m.how === 'amount' ? 'amount se andaaza' : 'aapne chuna') + ')</span>').join(', ') +
        '. Inke ECO GSTIN Table 14 mein bhi daal diye gaye.</div>';
      match.filter((m) => !m.platform).forEach((m) => {
        status += '<div class="issue warning">Portal par <b>' + esc(m.entry.name || m.entry.etin) + '</b> (' + esc(m.entry.etin) + ', net ₹' + money(m.entry.net) + ') ka TCS hai, par ye kis platform ka hai pata nahi chala: ' +
          '<select data-assign="' + esc(m.entry.etin) + '"><option value="">— platform chuniye —</option>' + eco.map((e) => '<option value="' + esc(e.platform) + '">' + esc(e.label) + '</option>').join('') + '</select>' +
          ' <span class="hint">(Agar is platform ki sales report upload nahi ki, to woh bhi daaliye — warna ye sale GSTR-1 mein chhoot jayegi.)</span></div>';
      });
      const periods = state.files.reduce((a, f) => a.concat((f.tcs && f.tcs.periods) || []), []);
      if (periods.length && periods.indexOf(period()) < 0) status += '<div class="issue warning">Portal file ' + esc(periods.join(', ')) + ' mahine ki lagti hai, jabki aapne ' + esc(period()) + ' chuna hai.</div>';
    }
    $('tcsStatus').innerHTML = status;
    $('tcsStatus').querySelectorAll('[data-assign]').forEach((sel) => sel.addEventListener('change', () => {
      const all = store.get('tcsAssign', {}); all[sel.dataset.assign] = sel.value; store.set('tcsAssign', all); recompute();
    }));

    const saved = tcsPortal();
    const focused = document.activeElement && document.activeElement.dataset.tcs;
    const cell = (p, f) => '<td><input class="num" inputmode="decimal" data-tcs="' + esc(p + '|' + f) + '" value="' + esc((saved[p] || {})[f] || '') + '" placeholder="0.00"></td>';
    $('tcsInputs').innerHTML = '<table><thead><tr><th>Platform (ECO)</th>' + TCS_FIELDS.map(([, l]) => '<th>' + l + '</th>').join('') + '</tr></thead><tbody>' +
      eco.map((e) => '<tr><td><b>' + esc(e.label) + '</b><div class="hint">' + esc(e.etin || '—') + '</div></td>' + TCS_FIELDS.map(([f]) => cell(e.platform, f)).join('') + '</tr>').join('') + '</tbody></table>';
    $('tcsInputs').querySelectorAll('input').forEach((inp) => {
      if (inp.dataset.tcs === focused) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      inp.addEventListener('change', () => {
        const [p, f] = inp.dataset.tcs.split('|');
        const all = tcsPortal(); all[p] = all[p] || {}; all[p][f] = inp.value.trim();
        store.set(tcsKey(), all);
        renderTcsResult();
      });
    });
    renderTcsResult();
  }

  function renderTcsResult() {
    const R = state.result;
    const rec = C.reconcileTcs(R.summary.eco, tcsPortal(), R.json.fp);
    const v = (x) => (x == null ? '—' : '₹' + money(x));
    const diff = (x) => (x == null ? '—' : '<span class="' + (Math.abs(x) <= 1 ? 'ok-text' : 'err-text') + '">' + (x > 0 ? '+' : '') + money(x) + '</span>');
    const rows = rec.map((t) => '<tr><td><b>' + esc(t.label) + '</b></td><td><span class="pill ' + t.status + '">' + TCS_STATUS[t.status] + '</span></td>' +
      '<td class="n">' + v(t.ours.gross) + '<div class="hint">portal ' + v(t.portal.gross) + '</div></td>' +
      '<td class="n">' + v(t.ours.returns) + '<div class="hint">portal ' + v(t.portal.returns) + '</div></td>' +
      '<td class="n"><b>' + v(t.ours.net) + '</b><div class="hint">portal ' + v(t.portal.net) + '</div></td>' +
      '<td class="n">' + diff(t.diffNet) + '</td>' +
      '<td class="n">IGST ' + v(t.expectedTcs.igst) + '<br>CGST ' + v(t.expectedTcs.cgst) + '<br>SGST ' + v(t.expectedTcs.sgst) + '</td>' +
      '<td class="n">' + (t.diffTcs ? 'IGST ' + diff(t.diffTcs.igst) + '<br>CGST ' + diff(t.diffTcs.cgst) + '<br>SGST ' + diff(t.diffTcs.sgst) : '—') + '</td></tr>' +
      (t.notes.length ? '<tr class="note"><td colspan="8"><ul>' + t.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul></td></tr>' : '')).join('');
    $('tcsResult').innerHTML = '<table><thead><tr><th>Platform</th><th>Status</th><th class="n">Sales</th><th class="n">Returns</th><th class="n">Net taxable</th><th class="n">Farak (reports − portal)</th><th class="n">Expected TCS @' + rec[0].rate + '%</th><th class="n">TCS farak</th></tr></thead><tbody>' + rows + '</tbody></table>';
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
    renderTcs();

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
        html = table([{ h: 'B2B/B2C', k: 'type' }, { h: 'HSN', k: 'hsn_sc' }, { h: 'Official list', k: (r) => (r._label ? '' : HSN_STATUS[r.status]) },
          { h: 'Official description', k: (r) => String(r.official || '').slice(0, 80) }, { h: 'Product', k: (r) => String(r.desc || '').slice(0, 30) },
          { h: 'UQC', k: 'uqc' }, { h: 'Qty', k: 'qty', n: 1 }, { h: 'Rate %', k: 'rt' }].concat(amtCols), S.hsn, S.hsn.length ? sumRows(S.hsn, amtKeys.concat(['qty'])) : null) +
          '<p class="hint">HSN codes GST portal ki official HSN/SAC list se milaye gaye hain. ❌ wale code portal reject karega — platform par product ka HSN theek kijiye.</p>';
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
    add('HSN (Table 12)', S.hsn.map((h) => Object.assign({ Type: h.type, HSN: h.hsn_sc, 'Official list': HSN_STATUS[h.status], 'Official description': h.official, Product: h.desc, UQC: h.uqc, Qty: h.qty, 'Rate %': h.rt }, amt(h))));
    add('TCS milaan', C.reconcileTcs(S.eco, tcsPortal(), j.fp).map((t) => ({
      Platform: t.label, 'ECO GSTIN': t.etin, Status: TCS_STATUS[t.status],
      'Sales (reports)': t.ours.gross, 'Gross (portal)': t.portal.gross, 'Returns (reports)': t.ours.returns, 'Returns (portal)': t.portal.returns,
      'Net (reports)': t.ours.net, 'Net (portal)': t.portal.net, 'Net farak': t.diffNet,
      ['Expected TCS IGST (' + t.rate + '%)']: t.expectedTcs.igst, 'TCS IGST (portal)': t.portal.igst,
      'Expected TCS CGST': t.expectedTcs.cgst, 'TCS CGST (portal)': t.portal.cgst, 'Expected TCS SGST': t.expectedTcs.sgst, 'TCS SGST (portal)': t.portal.sgst,
      Notes: t.notes.join(' | '),
    })));
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
      ['JioMart', 'JM/25-26/0001', '08-10-2025', 'sale', 'JM10001', '', 'Kerala', '61091000', 'TSHIRT-M', 'Cotton T-Shirt', 1, 'NOS', 476.19, 5, 23.81, '', '', 0],
      ['', 'WEB/25-26/0001', '16-10-2025', 'return', 'W1001', '', 'Maharashtra', '73239390', 'BOTTLE-1L', 'Steel Bottle', 1, 'NOS', 423.73, 18, '', 38.14, 38.14, 0]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Column', 'Kya bharna hai'],
      ['platform', 'Platform ka naam (JioMart, Myntra, Shopsy...). Apni website / offline sale ke liye khali chhodiye'],
      ['invoice_no / invoice_date', 'Invoice number aur date (DD-MM-YYYY)'],
      ['type', 'sale ya return'],
      ['buyer_gstin', 'Sirf B2B sale mein buyer ka GSTIN'],
      ['pos_state', 'Customer ka state (naam ya code, jaise Maharashtra / 27)'],
      ['hsn, sku, description, qty, uqc', 'HSN code, product code (SKU), product, quantity, unit (NOS, PCS, KGS...)'],
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
  initMapper();
  initTcsPaste();
})();

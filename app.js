(() => {
  'use strict';

  // ---------- Column mapping (English or Arabic headers) ----------
  const COLUMNS = {
    date:     { label: 'التاريخ', en: 'date',     aliases: ['date', 'order date', 'التاريخ', 'تاريخ'] },
    product:  { label: 'المنتج',  en: 'product',  aliases: ['product', 'product name', 'item', 'المنتج', 'منتج', 'اسم المنتج'] },
    category: { label: 'الفئة',   en: 'category', aliases: ['category', 'الفئة', 'فئة', 'التصنيف'] },
    quantity: { label: 'الكمية',  en: 'quantity', aliases: ['quantity', 'qty', 'الكمية', 'كمية', 'العدد'] },
    price:    { label: 'السعر',   en: 'price',    aliases: ['price', 'unit price', 'السعر', 'سعر', 'سعر الوحدة'] },
  };
  const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const CUR = 'ر.ع.';

  // ---------- State ----------
  const state = {
    rows: [],            // {date:'YYYY-MM-DD', month:'YYYY-MM', product, category, qty, price, revenue}
    categories: [],      // fixed order → fixed colour per category
    minDate: '', maxDate: '',
    numerals: 'latn',
  };
  let monthChart = null, catChart = null;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const dropZone = $('dropZone'), fileInput = $('fileInput'), alertBox = $('alert'), dashboard = $('dashboard');
  const catFilter = $('catFilter'), fromDate = $('fromDate'), toDate = $('toDate'), resetBtn = $('resetBtn');

  // ---------- Helpers ----------
  const toLatinDigits = (s) => String(s ?? '')
    .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x0660)
    .replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x06F0);

  const normHeader = (h) => toLatinDigits(h).replace(/^﻿/, '').trim().toLowerCase()
    .replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').replace(/[إأآ]/g, 'ا').replace(/ة$/, 'ه');

  const parseNumber = (v) => {
    let s = toLatinDigits(v).trim().replace(/٫/g, '.').replace(/[٬,\s]/g, '').replace(/[^\d.\-]/g, '');
    if (s === '' || s === '.' || s === '-') return NaN;
    return Number(s);
  };

  const pad = (n) => String(n).padStart(2, '0');
  const parseDate = (v) => {
    const s = toLatinDigits(v).trim();
    let y, m, d, r;
    if ((r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) [, y, m, d] = r;
    else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) [, d, m, y] = r;
    else return null;
    y = +y; m = +m; d = +d;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  };

  const nf = (opts) => new Intl.NumberFormat(state.numerals === 'arab' ? 'ar-OM' : 'en-US',
    { numberingSystem: state.numerals, ...opts });
  const fmtInt = (n) => nf({ maximumFractionDigits: 0 }).format(n);
  const fmtMoney = (n) => nf({ minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n);
  const fmtCompact = (n) => nf({ notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const fmtPct = (p) => nf({ style: 'percent', maximumFractionDigits: 1 }).format(p);
  const fmtDigits = (s) => state.numerals === 'arab' ? String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]) : String(s);
  const monthLabel = (key) => { const [y, m] = key.split('-'); return `${MONTHS_AR[+m - 1]} ${fmtDigits(y)}`; };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const seriesColor = (i) => i < 8 ? css(`--s${i + 1}`) : css('--muted');

  // ---------- Alerts ----------
  function showAlert(title, body, kind = 'error') {
    alertBox.className = 'alert' + (kind === 'warn' ? ' warn' : '');
    alertBox.innerHTML = `<strong>${escapeHtml(title)}</strong>${body}`;
    alertBox.hidden = false;
  }
  const hideAlert = () => { alertBox.hidden = true; };

  // ---------- File handling ----------
  function handleFile(file) {
    if (!file) return;
    hideAlert();
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      showAlert('نوع الملف غير مدعوم', `<span>الملف «${escapeHtml(file.name)}» ليس ملف CSV. اختر ملفاً بامتداد ‎.csv</span>`);
      return;
    }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      encoding: 'UTF-8',
      complete: (res) => loadParsed(res, file.name),
      error: (err) => showAlert('تعذّرت قراءة الملف', `<span>${escapeHtml(err.message || '')}</span>`),
    });
  }

  function loadParsed(res, fileName) {
    const headers = (res.meta.fields || []);
    if (!headers.length || !res.data.length) {
      showAlert('الملف فارغ', '<span>لم يُعثر على صفوف بيانات في الملف.</span>');
      return;
    }
    // Map each required column to an actual header
    const map = {}, missing = [];
    for (const [key, col] of Object.entries(COLUMNS)) {
      const wanted = col.aliases.map(normHeader);
      const found = headers.find((h) => wanted.includes(normHeader(h)));
      if (found === undefined) missing.push(col); else map[key] = found;
    }
    if (missing.length) {
      const list = missing.map((c) => `<li>${c.label} <span dir="ltr">(${c.en})</span></li>`).join('');
      const got = headers.map((h) => `«${escapeHtml(h.replace(/^﻿/, ''))}»`).join('، ');
      showAlert(missing.length === 1 ? 'عمود ناقص في الملف' : 'أعمدة ناقصة في الملف',
        `<span>لم نجد ${missing.length === 1 ? 'العمود التالي' : 'الأعمدة التالية'}:</span><ul style="margin:6px 0">${list}</ul>
         <span style="color:var(--ink-2);font-size:13px">الأعمدة الموجودة في الملف: ${got}</span>`);
      return;
    }

    const rows = [];
    let skipped = 0;
    for (const r of res.data) {
      const date = parseDate(r[map.date]);
      const qty = parseNumber(r[map.quantity]);
      const price = parseNumber(r[map.price]);
      const product = String(r[map.product] ?? '').trim();
      const category = String(r[map.category] ?? '').trim() || 'غير مصنّف';
      if (!date || !product || !isFinite(qty) || !isFinite(price)) { skipped++; continue; }
      rows.push({ date, month: date.slice(0, 7), product, category, qty, price, revenue: qty * price });
    }
    if (!rows.length) {
      showAlert('لا توجد صفوف صالحة', '<span>تأكد أن التاريخ بصيغة YYYY-MM-DD أو DD/MM/YYYY وأن الكمية والسعر أرقام.</span>');
      return;
    }
    if (skipped) {
      showAlert('تم تحميل الملف مع تجاهل بعض الصفوف',
        `<span>تم تجاهل ${fmtInt(skipped)} صف بسبب قيم ناقصة أو غير صالحة.</span>`, 'warn');
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    // Category order: by total revenue (fixed for this file so colours never move)
    const catTotals = {};
    rows.forEach((r) => { catTotals[r.category] = (catTotals[r.category] || 0) + r.revenue; });
    state.categories = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
    state.rows = rows;
    state.minDate = rows[0].date;
    state.maxDate = rows[rows.length - 1].date;
    state.fileName = fileName;

    catFilter.innerHTML = '<option value="">كل الفئات</option>' +
      state.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    [fromDate, toDate].forEach((el) => { el.min = state.minDate; el.max = state.maxDate; });
    resetFilters(false);

    dashboard.hidden = false;
    dropZone.classList.add('compact');
    dropZone.querySelector('.drop-title').textContent = 'استبدال الملف: اسحب ملفاً جديداً أو';
    render();
  }

  // ---------- Filters ----------
  function resetFilters(doRender = true) {
    catFilter.value = '';
    fromDate.value = state.minDate;
    toDate.value = state.maxDate;
    if (doRender) render();
  }
  function filtered() {
    let from = fromDate.value || state.minDate, to = toDate.value || state.maxDate;
    if (from > to) [from, to] = [to, from];
    const cat = catFilter.value;
    return { from, to, rows: state.rows.filter((r) => r.date >= from && r.date <= to && (!cat || r.category === cat)) };
  }

  // ---------- Render ----------
  function render() {
    if (!state.rows.length) return;
    const { from, to, rows } = filtered();

    $('fileInfo').textContent = `${state.fileName} · ${fmtInt(state.rows.length)} صف`;

    const total = rows.reduce((s, r) => s + r.revenue, 0);
    const orders = rows.length;
    const byProduct = {};
    rows.forEach((r) => { byProduct[r.product] = (byProduct[r.product] || 0) + r.revenue; });
    const top = Object.entries(byProduct).sort((a, b) => b[1] - a[1])[0];

    $('kpiTotal').innerHTML = `${fmtMoney(total)}<span class="cur">${CUR}</span>`;
    $('kpiOrders').textContent = fmtInt(orders);
    $('kpiTop').textContent = top ? top[0] : '—';
    $('kpiTop').title = top ? top[0] : '';
    $('kpiTopNote').textContent = top ? `إيراد ${fmtMoney(top[1])} ${CUR}` : 'حسب الإيراد';
    $('kpiAvg').innerHTML = orders ? `${fmtMoney(total / orders)}<span class="cur">${CUR}</span>` : '—';

    $('emptyMsg').hidden = rows.length > 0;

    renderMonthChart(rows, from, to);
    renderCatChart(rows, total);
  }

  function monthKeys(from, to) {
    const keys = [];
    let [y, m] = from.slice(0, 7).split('-').map(Number);
    const [ey, em] = to.slice(0, 7).split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) { keys.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++; } }
    return keys;
  }

  function baseChartDefaults() {
    Chart.defaults.font.family = '"IBM Plex Sans Arabic", system-ui, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css('--muted');
  }

  function tooltipStyle() {
    return {
      rtl: true, textDirection: 'rtl',
      backgroundColor: css('--ink'), titleColor: css('--surface'), bodyColor: css('--surface'),
      padding: 10, cornerRadius: 8, displayColors: true, boxPadding: 4,
      titleFont: { weight: '600' },
    };
  }

  function renderMonthChart(rows, from, to) {
    const keys = monthKeys(from, to);
    const sums = Object.fromEntries(keys.map((k) => [k, 0]));
    rows.forEach((r) => { if (r.month in sums) sums[r.month] += r.revenue; });
    const data = keys.map((k) => sums[k]);
    const cat = catFilter.value;
    const color = cat ? seriesColor(state.categories.indexOf(cat)) : css('--s1');

    const cfg = {
      type: 'bar',
      data: {
        labels: keys.map(monthLabel),
        datasets: [{
          label: cat || 'المبيعات',
          data,
          backgroundColor: color,
          hoverBackgroundColor: color,
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'bottom',
          maxBarThickness: 36,
          categoryPercentage: 0.8,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipStyle(), callbacks: { label: (c) => ` ${fmtMoney(c.parsed.y)} ${CUR}` } },
        },
        scales: {
          x: {
            reverse: true, // RTL: time flows right → left
            grid: { display: false },
            border: { color: css('--grid') },
            ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 8, color: css('--ink-2') },
          },
          y: {
            position: 'right', beginAtZero: true,
            grid: { color: css('--grid') }, border: { display: false },
            ticks: { callback: (v) => fmtCompact(v), maxTicksLimit: 6, color: css('--muted') },
          },
        },
      },
    };
    if (monthChart) monthChart.destroy();
    monthChart = new Chart($('monthChart'), cfg);
  }

  function renderCatChart(rows, total) {
    const sums = {};
    rows.forEach((r) => { sums[r.category] = (sums[r.category] || 0) + r.revenue; });
    const cats = state.categories.filter((c) => sums[c] > 0);
    const colors = cats.map((c) => seriesColor(state.categories.indexOf(c)));
    const values = cats.map((c) => sums[c]);

    const cfg = {
      type: 'doughnut',
      data: { labels: cats, datasets: [{ data: values, backgroundColor: colors, hoverBackgroundColor: colors,
        borderColor: css('--surface'), borderWidth: 2, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '64%',
        animation: { duration: 250 },
        layout: { padding: 6 },
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipStyle(), callbacks: {
            label: (c) => ` ${c.label}: ${fmtMoney(c.parsed)} ${CUR} (${fmtPct(total ? c.parsed / total : 0)})`,
          } },
        },
      },
      plugins: [{
        id: 'centerText',
        afterDraw(chart) {
          const { ctx, chartArea: a } = chart;
          if (!a) return;
          const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
          ctx.save();
          ctx.textAlign = 'center'; ctx.direction = 'rtl';
          ctx.fillStyle = css('--ink-2'); ctx.font = '500 12px "IBM Plex Sans Arabic", sans-serif';
          ctx.fillText('الإجمالي', x, y - 10);
          ctx.fillStyle = css('--ink'); ctx.font = '700 17px "IBM Plex Sans Arabic", sans-serif';
          ctx.fillText(fmtCompact(total), x, y + 12);
          ctx.restore();
        },
      }],
    };
    if (catChart) catChart.destroy();
    catChart = new Chart($('catChart'), cfg);

    $('catLegend').innerHTML = cats.map((c, i) => `
      <li>
        <span class="sw" style="background:${colors[i]}"></span>
        <span class="name">${escapeHtml(c)}</span>
        <span class="val">${fmtMoney(values[i])} ${CUR}</span>
        <span class="pct">${fmtPct(total ? values[i] / total : 0)}</span>
      </li>`).join('');
  }

  // ---------- Events ----------
  fileInput.addEventListener('change', (e) => { handleFile(e.target.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('over'); }));
  ['dragleave', 'dragend', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('over'); }));
  dropZone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
  dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  // Stop the browser opening a file dropped outside the zone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  [catFilter, fromDate, toDate].forEach((el) => {
    el.addEventListener('change', render);
    el.addEventListener('input', render);
  });
  resetBtn.addEventListener('click', () => resetFilters(true));

  document.querySelectorAll('[data-numerals]').forEach((btn) => btn.addEventListener('click', () => {
    state.numerals = btn.dataset.numerals;
    document.querySelectorAll('[data-numerals]').forEach((b) => {
      const on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    });
    try { localStorage.setItem('numerals', state.numerals); } catch (_) {}
    render();
  }));
  try {
    const saved = localStorage.getItem('numerals');
    if (saved === 'arab') document.querySelector('[data-numerals="arab"]').click();
  } catch (_) {}

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { baseChartDefaults(); render(); });
  baseChartDefaults();
  document.fonts && document.fonts.ready.then(() => render());
})();

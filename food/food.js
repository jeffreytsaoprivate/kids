// food.js — app logic for food.html (Calculator, Food map, Scan tabs).
// Loaded by food.html as a classic deferred script (not type=module) so the page
// still works when opened straight from disk (file://), where browsers block
// external module scripts. Requires d3 to be loaded first.
'use strict';

// =====================================================================
// Firebase — same project/collection layout as ../lib/firebase.js
// (docs live at artifacts/<appId>/public/data/<collection>).
// Paste the firebaseConfig object from lib/firebase.js over this one.
// =====================================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA9k81iD2mzPuLKBl76d6sdcLWvguDBzcs",
  authDomain: "kids-15b5a.firebaseapp.com",
  projectId: "kids-15b5a",
  storageBucket: "kids-15b5a.firebasestorage.app",
  messagingSenderId: "350263998718",
  appId: "1:350263998718:web:8c1d356caa2df0da99cdaf",
};
const COLLECTION_NAME = "foods";
const FB_VERSION = "10.14.1";

const CATEGORIES = ['Beverages', 'Carbs and flours', 'Condiments', 'Dairy food and eggs', 'Fruits', 'Meats', 'Nuts and beans', 'Oils and butters', 'Seafood', 'Vegetables'];
const CATEGORY_COLORS = {
  'Beverages': ['#0080FF', '#fff'], 'Carbs and flours': ['#FFECD1', '#000'], 'Condiments': ['#7F7F7F', '#fff'],
  'Dairy food and eggs': ['#F2F2F2', '#000'], 'Fruits': ['#FF8000', '#fff'], 'Meats': ['#F00000', '#fff'],
  'Nuts and beans': ['#AD5430', '#fff'], 'Oils and butters': ['#FFFF00', '#000'], 'Seafood': ['#FEBEA4', '#000'],
  'Vegetables': ['#00FF50', '#000'],
};
const MACRO = { protein: '#ad4a3a', fat: '#c47a2b', carbs: '#3b6e8f' };

const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Firebase store ----------
const store = { ready: null, db: null, col: null, fs: null };
store.ready = (async () => {
  if (FIREBASE_CONFIG.apiKey.startsWith('PASTE_')) throw new Error('Firebase apiKey not set — paste firebaseConfig from lib/firebase.js into this file.');
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
  const [{ initializeApp }, fs, { getAuth, signInAnonymously }] = await Promise.all([
    import(`${base}/firebase-app.js`), import(`${base}/firebase-firestore.js`), import(`${base}/firebase-auth.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  await signInAnonymously(getAuth(app));
  store.fs = fs;
  store.db = fs.getFirestore(app);
  store.col = fs.collection(store.db, 'artifacts', FIREBASE_CONFIG.appId, 'public', 'data', COLLECTION_NAME);
})();
store.ready.then(
  () => { $('conn').className = 'conn ok'; $('connText').textContent = `Firebase · ${COLLECTION_NAME}`; },
  err => { $('conn').className = 'conn err'; $('connText').textContent = `Firebase unavailable: ${err.message}`; console.error(err); }
);
async function loadFoods() {
  await store.ready;
  const snap = await store.fs.getDocs(store.col);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function saveFood(food) {
  await store.ready;
  const existing = foods.find(f => f.name.toLowerCase() === food.name.toLowerCase());
  if (existing) {
    if (!confirm(`"${existing.name}" is already in the food list. Replace its values?`)) return null;
    await store.fs.updateDoc(store.fs.doc(store.col, existing.id), food);
    Object.assign(existing, food); enrich(existing);
    return existing.id;
  }
  const ref = await store.fs.addDoc(store.col, food);
  const row = { id: ref.id, ...food }; enrich(row); foods.push(row);
  return ref.id;
}
function onFoodsChanged() { if (mapReady) { updateOpacity(); updateGraphics(); renderCategoryButtons(); } }

function toast(el, msg, isErr = false, ms = 5000) {
  el.textContent = msg; el.className = el.className.replace(/\b(hidden|err)\b/g, '').trim() + (isErr ? ' err' : '');
  clearTimeout(el._t); if (ms) el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------- Shared donut ----------
function drawDonut(canvas, data, colors, centerLabel, size = 176) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const isEmpty = data.every(d => d === 0);
  const slices = isEmpty ? [100] : data;
  const x = size / 2, y = size / 2, r = size / 2 - 4, ri = r * 0.58;
  let a0 = -Math.PI / 2;
  slices.forEach((s, i) => {
    const a1 = a0 + Math.PI * 2 * (s / 100);
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a1);
    ctx.arc(x, y, ri, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = isEmpty ? '#ebe6d8' : colors[i];
    ctx.fill();
    if (!isEmpty && s > 0 && s < 100) { ctx.strokeStyle = '#fffdf8'; ctx.lineWidth = 3; ctx.stroke(); }
    a0 = a1;
  });
  if (!isEmpty) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1e2a22'; ctx.font = `600 ${Math.round(size / 8.5)}px Fraunces, Georgia, serif`;
    ctx.fillText(Math.round(data[2]) + '%', x, y - size / 20);
    ctx.fillStyle = '#6b7568'; ctx.font = `600 ${Math.max(9, Math.round(size / 18))}px "IBM Plex Mono", monospace`;
    ctx.fillText(centerLabel, x, y + size / 14);
  }
}
function macroSplit(p, f, c, fbr, net) {
  const fiber = Math.min(fbr, c);
  const ec = net ? c - fiber : c;
  const kcal = f * 9 + ec * 4 + p * 4;
  const pct = v => kcal === 0 ? 0 : v / kcal * 100;
  return { proteinPercent: pct(p * 4), fatPercent: pct(f * 9), carbsPercent: pct(ec * 4), kcal };
}

// =====================================================================
// Tabs
// =====================================================================
const TABS = ['calc', 'map', 'scan'];
function showTab(name) {
  TABS.forEach(t => {
    $('tab-' + t).classList.toggle('hidden', t !== name);
    $('tabbtn-' + t).setAttribute('aria-selected', t === name);
  });
  if (name === 'map') ensureMap();
  if (name !== 'scan') stopCamera();
  hideTooltip();
  history.replaceState(null, '', '#' + name);
}
TABS.forEach(t => $('tabbtn-' + t).addEventListener('click', () => showTab(t)));

// =====================================================================
// Calculator
// =====================================================================
const calc = {
  fat: $('fat'), carbs: $('carbs'), fiber: $('fiber'), protein: $('protein'),
  name: $('foodName'), category: $('foodCategory'), basis: $('foodBasis'), serving: $('servingGrams'),
  save: $('saveButton'),
};
let isNetCarbs = false;
CATEGORIES.forEach(c => calc.category.add(new Option(c, c)));

function updateCalc() {
  const m = macroSplit(num(calc.protein.value), num(calc.fat.value), num(calc.carbs.value), num(calc.fiber.value), isNetCarbs);
  drawDonut($('piechart'), [m.proteinPercent, m.fatPercent, m.carbsPercent], [MACRO.protein, MACRO.fat, MACRO.carbs], isNetCarbs ? 'NET CARBS' : 'CARBS');
  const carbLabel = isNetCarbs ? 'Net carbs' : 'Carbs';
  $('legend').innerHTML = [['protein', 'Protein', m.proteinPercent], ['fat', 'Fat', m.fatPercent], ['carbs', carbLabel, m.carbsPercent]]
    .map(([k, l, v]) => `<div class="legend-item"><span class="swatch ${k}"></span><span class="legend-label">${l}</span><span class="legend-value">${v.toFixed(1)}%</span></div>`).join('');
  $('kcal').textContent = m.kcal ? `${Math.round(m.kcal)} kcal ${calc.basis.value === '100g' ? 'per 100 g' : 'per serving'}` : '';
  renderStatus(m.carbsPercent, m.kcal);
}
function renderStatus(carbsPercent, kcal) {
  const bar = $('statusBar'), text = $('statusText');
  bar.classList.remove('good', 'warn', 'bad');
  if (kcal === 0) { bar.classList.add('good'); text.innerHTML = '<b>—</b>Enter values to check the carb guideline.'; return; }
  let cls, headline, detail;
  if (carbsPercent > 35) {
    cls = 'bad'; headline = 'Outside guideline';
    detail = `Carbs are ${carbsPercent.toFixed(1)}% of calories — more than 10 points over the 25% reference.`;
  } else if (carbsPercent > 25) {
    cls = 'warn'; headline = 'Within 10% of guideline';
    detail = `Carbs are ${carbsPercent.toFixed(1)}% of calories — within 10 points of the 25% reference.`;
  } else {
    cls = 'good'; headline = 'Within guideline';
    detail = `Carbs are ${carbsPercent.toFixed(1)}% of calories — at or below the 25% reference.`;
  }
  bar.classList.add(cls);
  text.innerHTML = `<b>${headline}</b>${detail}`;
}
function updateSaveState() { calc.save.disabled = calc.name.value.trim() === ''; }

[calc.fat, calc.carbs, calc.fiber, calc.protein].forEach(inp => {
  inp.addEventListener('input', updateCalc);
  inp.addEventListener('change', () => { inp.value = num(inp.value); updateCalc(); });
});
calc.basis.addEventListener('change', updateCalc);
calc.name.addEventListener('input', updateSaveState);
calc.name.addEventListener('keydown', e => { if (e.key === 'Enter' && !calc.save.disabled) calc.save.click(); });
$('toggleButton').addEventListener('click', function () {
  isNetCarbs = !isNetCarbs;
  this.textContent = isNetCarbs ? 'Show total carbs' : 'Show net carbs';
  updateCalc();
});

calc.save.addEventListener('click', async () => {
  const name = calc.name.value.trim();
  if (!name) return;
  let p = num(calc.protein.value), f = num(calc.fat.value), c = num(calc.carbs.value), fbr = num(calc.fiber.value);
  if (fbr > c) { toast($('calcToast'), 'Fiber can’t be more than total carbs.', true); return; }
  const sg = num(calc.serving.value);
  const pw = sg > 0 ? sg : null;
  if (calc.basis.value === 'serving' && pw) {        // convert to per-100 g, like the USDA rows
    const k = 100 / pw; p *= k; f *= k; c *= k; fbr *= k;
  }
  const food = {
    name, category: calc.category.value,
    portion: calc.basis.value === 'serving' ? '1 serving' : (pw ? '1 serving' : '100 g'),
    pw, p: +p.toFixed(4), f: +f.toFixed(4), c: +c.toFixed(4), fbr: +fbr.toFixed(4), g: 0,
    // entered per serving with no weight: values are per serving, pw unknown
    servingOnly: calc.basis.value === 'serving' && !pw,
    source: calc.source || 'manual',
    ...(calc.barcode ? { barcode: calc.barcode } : {}),
    createdAt: new Date().toISOString(),
  };
  calc.save.disabled = true;
  try {
    if (!mapReady) await ensureFoodsLoaded();
    const id = await saveFood(food);
    if (id) { toast($('calcToast'), `Saved “${name}” to Firebase.`); onFoodsChanged(); }
  } catch (err) {
    console.error(err); toast($('calcToast'), `Save failed: ${err.message}`, true, 0);
  } finally { updateSaveState(); }
});
// typing in the calculator by hand clears scan provenance
[calc.name].forEach(i => i.addEventListener('input', () => { calc.source = null; calc.barcode = null; }));

updateCalc();
updateSaveState();

// =====================================================================
// Food map  (ported from food.html; data now comes from Firebase)
// =====================================================================
let foods = [];
let foodsLoaded = null;
let mapReady = false;
let showPerServing = true, showNetCarbs = true, showShapeMap = 'square';
let highlightFood = null, showCategory = 'Show all';
let sortState = { col: 0, asc: true };
const carb_hi_threshold = 40, carb_lo_threshold = 30.001;
const lo_opacity = 0.05, mid_opacity = 0.2;
const width = 700, height = 600;
const R = 200 / Math.sqrt(6);
const ax1 = 0, ay1 = 2 / Math.sqrt(6) * 100, ax2 = 1 / Math.sqrt(2) * 100, ay2 = -1 / Math.sqrt(6) * 100;
const colorScale = d3.scaleThreshold()
  .domain([0, carb_lo_threshold, carb_hi_threshold - 0.001, carb_hi_threshold, 100])
  .range(['#2f9e44', '#2f9e44', '#d9a400', '#d63a2a', '#d63a2a']);

function circCoords(cPct, pPct) {
  let ang = cPct === 0 ? 60 : Math.atan2(Math.sqrt(1 - (cPct / 100) ** 2), cPct / 100) * 180 / Math.PI;
  ang = cPct === 100 ? 0 : ang * (2 * (pPct / (100 - cPct)) - 1);
  return [Math.sin(ang * Math.PI / 180) * R, -Math.cos(ang * Math.PI / 180) * R + 2 * cPct / 100 * R];
}
function enrich(d) {
  ['p', 'f', 'c', 'fbr', 'g'].forEach(k => d[k] = num(d[k]));
  d.pwKnown = d.pw != null && num(d.pw) > 0 && !d.servingOnly;
  d.pw = d.pwKnown ? num(d.pw) : 100;        // unknown weight: treat stored values as one serving
  d.nc = Math.max(d.c - d.fbr, 0);
  const s = d.pw / 100;
  d.p_serving = d.p * s; d.f_serving = d.f * s; d.c_serving = d.c * s; d.nc_serving = d.nc * s; d.g_serving = d.g * s;
  const pk = d.p * 4, fk = d.f * 9, ck = d.c * 4, nck = d.nc * 4;
  const tot = pk + fk + ck, totn = pk + fk + nck;
  [d.p_percent, d.f_percent, d.c_percent] = tot === 0 ? [100 / 3, 100 / 3, 100 / 3] : [pk / tot * 100, fk / tot * 100, ck / tot * 100];
  [d.p_netpercent, d.f_netpercent, d.c_netpercent] = totn === 0 ? [100 / 3, 100 / 3, 100 / 3] : [pk / totn * 100, fk / totn * 100, nck / totn * 100];
  d.color = (CATEGORY_COLORS[d.category] || ['#000'])[0];
  d.x = (d.p_percent - d.f_percent) / Math.sqrt(2);
  d.y = (-d.p_percent - d.f_percent + 2 * d.c_percent) / Math.sqrt(6);
  d.x_net = (d.p_netpercent - d.f_netpercent) / Math.sqrt(2);
  d.y_net = (-d.p_netpercent - d.f_netpercent + 2 * d.c_netpercent) / Math.sqrt(6);
  d.sqr_x = d.c_percent >= 99.9999 ? 0 : d.x * 100 / (100 - d.c_percent); d.sqr_y = d.y;
  d.sqr_x_net = d.c_netpercent >= 99.9999 ? 0 : d.x_net * 100 / (100 - d.c_netpercent); d.sqr_y_net = d.y_net;
  [d.circ_x, d.circ_y] = circCoords(d.c_percent, d.p_percent);
  [d.circ_x_net, d.circ_y_net] = circCoords(d.c_netpercent, d.p_netpercent);
  d.size = tot; d.size_net = totn;
  d.size_serving = tot * s; d.size_serving_net = totn * s;
  d.opacity = 1;
  return d;
}
function ensureFoodsLoaded() {
  if (!foodsLoaded) {
    foodsLoaded = loadFoods().then(rows => { foods = rows.map(enrich); return foods; });
    foodsLoaded.catch(() => { foodsLoaded = null; });
  }
  return foodsLoaded;
}
async function ensureMap(force = false) {
  if (force) { foodsLoaded = null; mapReady = false; }
  if (mapReady) return;
  $('table-container').innerHTML = '<div class="empty">Loading foods from Firebase…</div>';
  try {
    await ensureFoodsLoaded();
  } catch (err) {
    $('table-container').innerHTML = `<div class="empty">Couldn’t load foods: ${esc(err.message)}</div>`;
    return;
  }
  mapReady = true;
  renderCategoryButtons();
  updateOpacity();
  updateGraphics();
}
$('reloadFoods').addEventListener('click', () => { highlightFood = null; ensureMap(true); });

const svg = d3.select('#chart').append('svg').attr('viewBox', `0 0 ${width} ${height}`);
function setLabels() {
  $('toggle_shapemap').textContent = { triangle: 'Triangle map', circle: 'Circle map', square: 'Square map' }[showShapeMap];
  $('toggle_perserving').textContent = showPerServing ? 'Amount per serving' : 'Amount per 100g';
  $('toggle_netcarbs').textContent = showNetCarbs ? 'Net carbs' : 'Total carbs';
}
$('toggle_shapemap').addEventListener('click', () => {
  showShapeMap = { triangle: 'circle', circle: 'square', square: 'triangle' }[showShapeMap]; setLabels(); updateGraphics();
});
$('toggle_perserving').addEventListener('click', () => { showPerServing = !showPerServing; setLabels(); updateGraphics(); });
$('toggle_netcarbs').addEventListener('click', () => { showNetCarbs = !showNetCarbs; setLabels(); updateGraphics(); });
setLabels();

function renderCategoryButtons() {
  const box = $('category-container');
  const counts = d3.rollup(foods, v => v.length, d => d.category);
  box.innerHTML = '';
  [['Show all', '#ffffff', '#000'], ...CATEGORIES.map(c => [c, ...CATEGORY_COLORS[c]])].forEach(([cat, bg, fg]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'category-button' + (cat === showCategory ? ' checked' : '');
    b.style.background = bg; b.style.color = fg;
    b.innerHTML = `<span>${esc(cat)}</span><span class="n">${cat === 'Show all' ? foods.length : (counts.get(cat) || 0)}</span>`;
    b.addEventListener('click', () => {
      showCategory = (showCategory === cat) ? 'Show all' : cat;
      highlightFood = null; hideTooltip();
      box.querySelectorAll('.category-button').forEach(x => x.classList.toggle('checked', x.firstChild.textContent === showCategory));
      updateOpacity(); updateGraphics();
    });
    box.appendChild(b);
  });
}
function updateOpacity() {
  foods.forEach(d => {
    const inCat = showCategory === 'Show all' || d.category === showCategory;
    if (highlightFood == null) d.opacity = inCat ? 1 : lo_opacity;
    else d.opacity = d.name === highlightFood ? 1 : (inCat && showCategory !== 'Show all' ? mid_opacity : lo_opacity);
  });
}
function pos(d) {
  const k = showNetCarbs ? '_net' : '';
  if (showShapeMap === 'triangle') return [d['x' + k], d['y' + k]];
  if (showShapeMap === 'circle') return [d['circ_x' + k], d['circ_y' + k]];
  return [d['sqr_x' + k], d['sqr_y' + k]];
}
function sizeOf(d) { return showNetCarbs ? (showPerServing ? d.size_serving_net : d.size_net) : (showPerServing ? d.size_serving : d.size); }

function updateGraphics() { updateBubbleChart(); updateTable(); }

function updateBubbleChart() {
  const xDom = showShapeMap === 'circle' ? [-R * Math.sin(Math.PI / 3), R * Math.sin(Math.PI / 3)] : [-ax2, ax2];
  const yDom = showShapeMap === 'circle' ? [-R, R] : [ay2, ay1];
  const xScale = d3.scaleLinear().domain(xDom).range([100, width - 100]);
  const yScale = d3.scaleLinear().domain(yDom).range([height - 50, 50]);
  const radiusScale = d3.scaleSqrt().domain([0, d3.max(foods, sizeOf) || 1]).range([2, 20]);
  const line = d3.line().x(d => xScale(d.x)).y(d => yScale(d.y));
  svg.selectAll('*').remove();

  let boundary;
  if (showShapeMap === 'triangle') boundary = [{ x: ax1, y: ay1 }, { x: ax2, y: ay2 }, { x: -ax2, y: ay2 }, { x: ax1, y: ay1 }];
  else if (showShapeMap === 'circle') boundary = d3.range(101).map(i => ({ x: R * Math.cos(i / 50 * Math.PI), y: R * Math.sin(i / 50 * Math.PI) }));
  else boundary = [{ x: ax2, y: ay1 }, { x: ax2, y: ay2 }, { x: -ax2, y: ay2 }, { x: -ax2, y: ay1 }, { x: ax2, y: ay1 }];
  svg.append('path').datum(boundary).attr('d', line).attr('stroke', '#9aa197').attr('stroke-width', 2).attr('fill', 'none');

  // carb-share contour lines every 10%
  const n = showShapeMap === 'circle' ? 50 : 1;
  for (let j = 1; j <= 9; j++) {
    const tc = j * 10;
    const pts = d3.range(n + 1).map(i => {
      const tp = (i / n) * (100 - tc), tf = (1 - i / n) * (100 - tc);
      if (showShapeMap === 'triangle') return { x: (tp - tf) / Math.sqrt(2), y: (-tp - tf + 2 * tc) / Math.sqrt(6) };
      if (showShapeMap === 'circle') { const [x, y] = circCoords(tc, tp); return { x, y }; }
      return { x: (tp - tf) / Math.sqrt(2) * 100 / (100 - tc), y: (-tp - tf + 2 * tc) / Math.sqrt(6) };
    });
    svg.append('path').datum(pts).attr('d', line).attr('stroke', colorScale(tc)).attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2').attr('fill', 'none').attr('opacity', .8);
  }

  svg.selectAll('text.vertex').data([
    { x: ax1, y: ay1, t: showNetCarbs ? 'Net carbs' : 'Carbs', a: 'middle', dx: '0', dy: '-0.8em' },
    { x: ax2, y: ay2, t: 'Protein', a: 'start', dx: '0.5em', dy: '1.5em' },
    { x: -ax2, y: ay2, t: 'Fat', a: 'end', dx: '-0.5em', dy: '1.5em' },
  ]).enter().append('text').attr('class', 'vertex')
    .attr('x', d => xScale(d.x)).attr('y', d => yScale(d.y)).attr('dx', d => d.dx).attr('dy', d => d.dy)
    .attr('text-anchor', d => d.a).attr('fill', '#1e2a22')
    .style('font', '600 14px Inter, sans-serif').text(d => d.t);

  // draw faded first so highlighted bubbles sit on top
  const ordered = [...foods].sort((a, b) => a.opacity - b.opacity || sizeOf(b) - sizeOf(a));
  svg.selectAll('circle.food').data(ordered).enter().append('circle').attr('class', 'food')
    .attr('cx', d => xScale(pos(d)[0])).attr('cy', d => yScale(pos(d)[1]))
    .attr('r', d => radiusScale(sizeOf(d)))
    .attr('opacity', d => d.opacity).attr('fill', d => d.color)
    .attr('stroke', d => d.opacity === 1 ? '#6b7568' : 'none').attr('stroke-width', 1)
    .style('cursor', d => d.opacity >= mid_opacity ? 'pointer' : 'default')
    .on('mouseover mousemove', (e, d) => { if (d.opacity === 1) showTooltip(e, d); })
    .on('mouseout', hideTooltip)
    .on('click', (e, d) => { e.stopPropagation(); if (d.opacity >= mid_opacity) pickFood(e, d); });

  svg.on('click', () => { highlightFood = null; hideTooltip(); updateOpacity(); updateGraphics(); });
  const visible = foods.filter(d => d.opacity !== lo_opacity).length;
  $('mapCount').textContent = `${visible} of ${foods.length} foods`;
}

function cellVals(d) {
  return [
    d.name,
    showPerServing ? d.p_serving : d.p,
    showPerServing ? d.f_serving : d.f,
    showPerServing ? (showNetCarbs ? d.nc_serving : d.c_serving) : (showNetCarbs ? d.nc : d.c),
    showNetCarbs ? d.c_netpercent : d.c_percent,
  ];
}
function updateTable() {
  const container = $('table-container');
  if (!foods.length) { container.innerHTML = '<div class="empty">No foods in Firebase yet — run save-foods-to-firebase.js or save one from the Calculator.</div>'; return; }
  const cols = ['Food', 'Protein (g)', 'Fat (g)', 'Carbs (g)', 'Carbs (%)'].map(c => showNetCarbs ? c.replace('Carbs', 'Net carbs') : c);
  const filter = $('filterName').value.trim().toLowerCase();
  let rows = foods.filter(d => d.opacity !== lo_opacity && (!filter || d.name.toLowerCase().includes(filter)));
  rows.sort((a, b) => {
    const va = cellVals(a)[sortState.col], vb = cellVals(b)[sortState.col];
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return sortState.asc ? cmp : -cmp;
  });
  const head = cols.map((c, i) => `<th data-col="${i}">${c}<span class="arrow">${sortState.col === i ? (sortState.asc ? '▲' : '▼') : ''}</span></th>`).join('');
  const body = rows.map(d => {
    const v = cellVals(d);
    const tag = d.source && d.source !== 'USDA FoodData Central' ? `<span class="src-tag">${d.source === 'Open Food Facts' ? 'scanned' : esc(d.source)}</span>` : '';
    const cls = d.opacity === mid_opacity ? 'dim' : (d.name === highlightFood ? 'sel' : '');
    return `<tr class="${cls}" data-name="${esc(d.name)}"><td>${esc(d.name)}${tag}</td><td>${v[1].toFixed(2)}</td><td>${v[2].toFixed(2)}</td><td>${v[3].toFixed(2)}</td><td style="color:${colorScale(v[4])};font-weight:600">${v[4].toFixed(1)}</td></tr>`;
  }).join('');
  container.innerHTML = `<table class="nutrienttable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
    (rows.length ? '' : '<div class="empty">No foods match.</div>');
  container.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const c = +th.dataset.col;
    sortState = { col: c, asc: sortState.col === c ? !sortState.asc : c === 0 };
    updateTable();
  }));
  container.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => {
    const name = tr.dataset.name;
    highlightFood = highlightFood === name ? null : name;
    updateOpacity(); updateGraphics();
  }));
}
$('filterName').addEventListener('input', () => mapReady && updateTable());
$('filterNameCancel').addEventListener('click', () => { $('filterName').value = ''; mapReady && updateTable(); });

const tooltip = d3.select('#tooltip');
function placeTooltip(event) {
  const tt = $('tooltip'), w = tt.offsetWidth, vw = document.documentElement.clientWidth;
  let left = event.pageX + 12; if (left + w > window.scrollX + vw - 8) left = event.pageX - w - 12;
  tooltip.style('left', Math.max(8, left) + 'px').style('top', (event.pageY - 20) + 'px');
}
function showTooltip(event, d) {
  const c1 = colorScale(d.c_percent), c2 = colorScale(d.c_netpercent);
  const servHdr = d.pwKnown ? `Per serving<br><span style="font-weight:400">(${esc(d.portion)}, ${d.pw.toFixed(1)}g)</span>` : 'Per serving<br><span style="font-weight:400">(weight unknown)</span>';
  const per100 = v => d.pwKnown || !d.servingOnly ? v.toFixed(2) + 'g' : '—';
  tooltip.html(`<table>
<tr><td colspan=5><strong>${esc(d.name)}</strong></td></tr>
<tr><td colspan=5 style="color:#808080">${esc(d.category)}${d.source && d.source !== 'USDA FoodData Central' ? ' · ' + esc(d.source) : ''}${d.barcode ? ' · ' + esc(d.barcode) : ''}</td></tr>
<tr><th></th><th>Per 100g</th><th>${servHdr}</th><th>% kcal</th><th>% net kcal</th></tr>
<tr><td><b>Protein</b></td><td>${per100(d.p)}</td><td>${d.p_serving.toFixed(2)}g</td><td>${d.p_percent.toFixed(1)}%</td><td>${d.p_netpercent.toFixed(1)}%</td></tr>
<tr><td><b>Fat</b></td><td>${per100(d.f)}</td><td>${d.f_serving.toFixed(2)}g</td><td>${d.f_percent.toFixed(1)}%</td><td>${d.f_netpercent.toFixed(1)}%</td></tr>
<tr><td><b>Carbs</b></td><td>${per100(d.c)}</td><td>${d.c_serving.toFixed(2)}g</td><td style="color:${c1}"><b>${d.c_percent.toFixed(1)}%</b></td><td>-</td></tr>
<tr><td><b>Net carbs</b></td><td>${per100(d.nc)}</td><td>${d.nc_serving.toFixed(2)}g</td><td>-</td><td style="color:${c2}"><b>${d.c_netpercent.toFixed(1)}%</b></td></tr>
<tr><td><b>Galactose</b></td><td>${per100(d.g)}</td><td>${d.g_serving.toFixed(2)}g</td><td>-</td><td>-</td></tr>
</table>`).style('display', 'block').style('opacity', 1);
  placeTooltip(event);
}
function hideTooltip() { tooltip.style('opacity', 0).style('display', 'none'); }
function pickFood(event, d) {
  showTooltip(event, d);
  if (highlightFood === d.name) highlightFood = null;
  else if (highlightFood == null || d.category === showCategory || showCategory === 'Show all') highlightFood = d.name;
  updateOpacity(); updateGraphics();
}
function showHelpInfo(event) {
  tooltip.html('<ul><li>PFC is an abbreviation for the key macronutrients: <b><u>P</u></b>rotein, <b><u>F</u></b>at, and <b><u>C</u></b>arbohydrates</li>'
    + '<li>Each circle is a food, with its position indicating the PFC proportions, and its size indicating caloric density</li>'
    + '<li>Foods closer to the top have more carbohydrates, so large circles on the top are not favorable</li>'
    + '<li>"Net carbs" are calculated by subtracting dietary fibers from carbs, as fibers are not digested</li>'
    + '<li>USDA foods are from FoodData Central; foods you save from the Calculator or Scan tabs are tagged in the table</li></ul>')
    .style('display', 'block').style('opacity', 1);
  placeTooltip(event);
}
$('mapInfo').addEventListener('mouseenter', showHelpInfo);
$('mapInfo').addEventListener('click', showHelpInfo);
$('mapInfo').addEventListener('mouseleave', hideTooltip);

// =====================================================================
// Scan  (camera barcode → Open Food Facts)
// =====================================================================
const video = $('video');
let camStream = null, scanLoop = null, zxingControls = null, lastProduct = null, lookingUp = false;
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

async function getDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      const fmts = BARCODE_FORMATS.filter(f => supported.includes(f));
      if (fmts.length) return { kind: 'native', det: new BarcodeDetector({ formats: fmts }) };
    } catch (_) { /* fall through to ZXing */ }
  }
  if (!window.ZXing) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
      s.onload = res; s.onerror = () => rej(new Error('Could not load the barcode reader library.'));
      document.head.appendChild(s);
    });
  }
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.CODE_128]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  return { kind: 'zxing', det: new ZXing.BrowserMultiFormatReader(hints) };
}
function showView(which) {
  $('vfPlaceholder').classList.toggle('hidden', which !== 'placeholder');
  video.classList.toggle('hidden', which !== 'video');
  $('reticle').classList.toggle('hidden', which !== 'video');
  $('photoPreview').classList.toggle('hidden', which !== 'photo');
}
async function startCamera() {
  const t = $('scanToast');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    toast(t, 'Camera needs https or localhost. Use “Take / choose photo” or type the barcode instead.', true, 0); return;
  }
  try {
    stopCamera();
    const reader = await getDetector();
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    video.srcObject = camStream; await video.play();
    showView('video');
    $('startCam').classList.add('hidden'); $('stopCam').classList.remove('hidden');
    if (reader.kind === 'native') {
      const tick = async () => {
        if (!camStream) return;
        try {
          const codes = await reader.det.detect(video);
          if (codes.length) { onCode(codes[0].rawValue); return; }
        } catch (_) {}
        scanLoop = setTimeout(tick, 180);
      };
      tick();
    } else {
      reader.det.decodeFromStream(camStream, video, (result) => { if (result) onCode(result.getText()); });
      zxingControls = reader.det;
    }
  } catch (err) {
    console.error(err); stopCamera();
    toast(t, err.name === 'NotAllowedError' ? 'Camera permission was denied.' : `Couldn’t start camera: ${err.message}`, true, 0);
  }
}
function stopCamera() {
  clearTimeout(scanLoop); scanLoop = null;
  if (zxingControls) { try { zxingControls.reset(); } catch (_) {} zxingControls = null; }
  if (camStream) { camStream.getTracks().forEach(tr => tr.stop()); camStream = null; }
  video.srcObject = null;
  if (!video.classList.contains('hidden')) showView('placeholder');
  $('startCam').classList.remove('hidden'); $('stopCam').classList.add('hidden');
}
function onCode(code) {
  stopCamera();
  if (navigator.vibrate) navigator.vibrate(60);
  $('manualCode').value = code;
  lookup(code);
}
$('startCam').addEventListener('click', startCamera);
$('stopCam').addEventListener('click', stopCamera);
$('photoInput').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  stopCamera();
  const url = URL.createObjectURL(file);
  const img = $('photoPreview'); img.src = url; showView('photo');
  await img.decode().catch(() => {});
  try {
    const reader = await getDetector();
    let code = null;
    if (reader.kind === 'native') {
      const codes = await reader.det.detect(await createImageBitmap(file));
      code = codes[0]?.rawValue;
    } else {
      try { code = (await reader.det.decodeFromImageElement(img)).getText(); } catch (_) { code = null; }
    }
    if (code) { $('manualCode').value = code; lookup(code); }
    else toast($('scanToast'), 'No barcode found in that photo — try again closer, in focus, with the bars horizontal.', true, 0);
  } catch (err) { toast($('scanToast'), err.message, true, 0); }
});
$('lookupBtn').addEventListener('click', () => lookup($('manualCode').value));
$('manualCode').addEventListener('keydown', e => { if (e.key === 'Enter') lookup($('manualCode').value); });

function guessCategory(tags = []) {
  const t = tags.join(' ');
  const rules = [
    [/beverage|drink|juice|milk-substitute|plant-based-milk|water|coffee|tea|soda/, 'Beverages'],
    [/seafood|fish|shrimp|tuna|salmon|crustacean/, 'Seafood'],
    [/meat|poultry|chicken|beef|pork|sausage|ham|bacon|turkey/, 'Meats'],
    [/cheese|yogurt|yoghurt|dair|egg|cream|ice-cream|butter-milk/, 'Dairy food and eggs'],
    [/fats|oil|butter|margarine|spread|nut-butter|peanut-butter/, 'Oils and butters'],
    [/nut|seed|legume|bean|pulse|lentil|chickpea|hummus/, 'Nuts and beans'],
    [/fruit|berr|apple|banana/, 'Fruits'],
    [/vegetable|salad|tomato|potato|mushroom/, 'Vegetables'],
    [/condiment|sauce|ketchup|mustard|mayonnaise|dressing|sweetener|sugar|spice|syrup/, 'Condiments'],
    [/cereal|bread|pasta|flour|rice|grain|cracker|biscuit|cookie|snack|bakery|breakfast/, 'Carbs and flours'],
  ];
  for (const [re, cat] of rules) if (re.test(t)) return cat;
  return 'Carbs and flours';
}

async function lookup(raw) {
  const code = String(raw || '').replace(/\D/g, '');
  const t = $('scanToast');
  if (code.length < 6) { toast(t, 'Enter a valid barcode (digits only).', true); return; }
  if (lookingUp) return;
  lookingUp = true;
  $('resultBody').innerHTML = `<div class="empty">Looking up <code>${code}</code>…</div>`;
  try {
    const fields = 'code,product_name,generic_name,brands,quantity,serving_size,serving_quantity,nutriments,image_front_small_url,image_front_url,categories_tags';
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`);
    if (!res.ok && res.status !== 404) throw new Error(`Open Food Facts returned ${res.status}`);
    const json = await res.json();
    if (json.status !== 1 || !json.product) {
      $('resultBody').innerHTML = `<div class="empty">No product found for <code>${code}</code>.<br>You can still enter it by hand on the Calculator tab, or <a href="https://world.openfoodfacts.org/cgi/product.pl?code=${code}" target="_blank" rel="noopener">add it to Open Food Facts</a>.</div>`;
      return;
    }
    renderProduct(code, json.product);
  } catch (err) {
    console.error(err);
    $('resultBody').innerHTML = `<div class="empty">Lookup failed: ${esc(err.message)}</div>`;
  } finally { lookingUp = false; }
}

function renderProduct(code, pr) {
  const n = pr.nutriments || {};
  const g = k => (n[k] === undefined || n[k] === '' ? null : num(n[k]));
  const per100 = { p: g('proteins_100g'), f: g('fat_100g'), c: g('carbohydrates_100g'), fbr: g('fiber_100g') ?? 0, kcal: g('energy-kcal_100g') };
  const sq = num(pr.serving_quantity) || null;
  const serv = sq ? Object.fromEntries(Object.entries(per100).map(([k, v]) => [k, v == null ? null : v * sq / 100])) : null;
  const name = [pr.brands?.split(',')[0]?.trim(), pr.product_name || pr.generic_name].filter(Boolean).join(' – ') || `Product ${code}`;
  const category = guessCategory(pr.categories_tags);
  lastProduct = { code, name, per100, sq, category };
  const missing = per100.p == null || per100.f == null || per100.c == null;
  const fmt = v => v == null ? '—' : v.toFixed(1) + ' g';
  const row = (cls, sw, label, k) => `<tr class="${cls}"><td><span class="swatch ${sw}"></span>${label}</td><td>${fmt(per100[k])}</td>${serv ? `<td>${fmt(serv[k])}</td>` : ''}</tr>`;
  const img = pr.image_front_small_url || pr.image_front_url;
  $('resultBody').innerHTML = `
    <div class="product-head">
      ${img ? `<img src="${esc(img)}" alt="">` : ''}
      <div>
        <div class="product-name">${esc(name)}</div>
        <div class="product-sub"><code>${code}</code>${pr.quantity ? ' · ' + esc(pr.quantity) : ''}${pr.serving_size ? ' · serving ' + esc(pr.serving_size) : ''}</div>
      </div>
    </div>
    <table class="facts">
      <thead><tr><th></th><th>Per 100 g</th>${serv ? `<th>Per serving (${sq} g)</th>` : ''}</tr></thead>
      <tbody>
        <tr><td>Energy</td><td>${per100.kcal == null ? '—' : Math.round(per100.kcal) + ' kcal'}</td>${serv ? `<td>${serv.kcal == null ? '—' : Math.round(serv.kcal) + ' kcal'}</td>` : ''}</tr>
        ${row('', 'fat', 'Fat', 'f')}
        ${row('', 'carbs', 'Carbs', 'c')}
        ${row('sub', 'fiber', 'Fiber', 'fbr')}
        ${row('', 'protein', 'Protein', 'p')}
      </tbody>
    </table>
    ${missing ? '<div class="toast err">Some macros are missing for this product in Open Food Facts — fill them in on the Calculator tab before saving.</div>' : `
    <div class="result-chart">
      <canvas id="scanDonut" class="donut"></canvas>
      <div class="legend" id="scanLegend" style="flex:1"></div>
    </div>`}
    <div class="result-actions">
      <select id="scanCategory" aria-label="Category">${CATEGORIES.map(c => `<option${c === category ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn primary" id="scanSave" type="button"${missing ? ' disabled' : ''}>Save to food list</button>
      <button class="btn" id="scanToCalc" type="button">Open in calculator</button>
    </div>
    <div class="toast hidden" id="scanSaveToast"></div>`;
  if (!missing) {
    const m = macroSplit(per100.p, per100.f, per100.c, per100.fbr, false);
    drawDonut($('scanDonut'), [m.proteinPercent, m.fatPercent, m.carbsPercent], [MACRO.protein, MACRO.fat, MACRO.carbs], 'CARBS', 150);
    $('scanLegend').innerHTML = [['protein', 'Protein', m.proteinPercent], ['fat', 'Fat', m.fatPercent], ['carbs', 'Carbs', m.carbsPercent]]
      .map(([k, l, v]) => `<div class="legend-item"><span class="swatch ${k}"></span><span class="legend-label">${l}</span><span class="legend-value">${v.toFixed(1)}%</span></div>`).join('');
  }
  $('scanCategory').addEventListener('change', e => lastProduct.category = e.target.value);
  $('scanToCalc').addEventListener('click', () => sendToCalculator(lastProduct));
  $('scanSave').addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true;
    const P = lastProduct;
    const food = {
      name: P.name, category: P.category, portion: P.sq ? '1 serving' : '100 g', pw: P.sq,
      p: P.per100.p, f: P.per100.f, c: P.per100.c, fbr: Math.min(P.per100.fbr, P.per100.c), g: 0,
      servingOnly: false, source: 'Open Food Facts', barcode: P.code, createdAt: new Date().toISOString(),
    };
    try {
      await ensureFoodsLoaded();
      const id = await saveFood(food);
      if (id) { toast($('scanSaveToast'), `Saved “${P.name}” to Firebase.`); onFoodsChanged(); }
    } catch (err) { console.error(err); toast($('scanSaveToast'), `Save failed: ${err.message}`, true, 0); }
    finally { btn.disabled = false; }
  });
}
function sendToCalculator(P) {
  calc.name.value = P.name;
  calc.category.value = P.category;
  calc.basis.value = '100g';
  calc.serving.value = P.sq || '';
  calc.fat.value = P.per100.f ?? 0; calc.carbs.value = P.per100.c ?? 0;
  calc.fiber.value = P.per100.fbr ?? 0; calc.protein.value = P.per100.p ?? 0;
  calc.source = 'Open Food Facts'; calc.barcode = P.code;
  updateCalc(); updateSaveState();
  showTab('calc');
}

// ---------- start ----------
const startTab = (location.hash || '').slice(1);
showTab(TABS.includes(startTab) ? startTab : 'calc');
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

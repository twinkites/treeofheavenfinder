import { loadModel, classify } from './model.js';
import { gridPoints, offset } from './geo.js';
import { MAPILLARY_TOKEN } from './config.js';
import { openReport } from './report.js';
import * as google from './sources/google.js';
import * as mapillary from './sources/mapillary.js';

const $ = sel => document.querySelector(sel);
const SOURCES = { google, mapillary };
const MAX_POINTS = 600;   // grid cells per scan; keeps one scan to a few neighbourhoods
const KEEP_FLOOR = 0.3;   // views scoring above this are stored, so the threshold slider can be moved later

// ---------- storage (every access guarded: private windows can throw) ----------
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not persisted */ }
  },
};

let detections = store.get('toh.detections', []);
for (const d of detections) d.source ??= 'google'; // results saved before Mapillary existed
const scanned = new Set(store.get('toh.scanned', []));
const sessionImages = new Map(); // detection id -> object URL, never persisted
const saveDetections = () => store.set('toh.detections', detections);

// ---------- map ----------
const view = store.get('toh.view', { center: [40.3356, -75.9269], zoom: 17 }); // Reading, PA
const map = L.map('map', { zoomControl: false }).setView(view.center, view.zoom);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const scanLayer = L.layerGroup().addTo(map);
const coverageLayer = L.layerGroup().addTo(map); // Mapillary photos a scan would use
const inatLayer = L.layerGroup().addTo(map);
L.control.layers(null, { 'Flagged by scan': scanLayer, 'iNaturalist sightings': inatLayer }, { position: 'topright' }).addTo(map);

map.on('moveend', () => {
  store.set('toh.view', { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() });
  updateEstimate();
  loadInat();
});

// ---------- iNaturalist sightings for context ----------
let inatTimer, inatAbort;
function loadInat() {
  clearTimeout(inatTimer);
  inatTimer = setTimeout(async () => {
    if (!map.hasLayer(inatLayer)) return;
    inatLayer.clearLayers();
    if (map.getZoom() < 11) return;
    inatAbort?.abort();
    inatAbort = new AbortController();
    const b = map.getBounds();
    const q = new URLSearchParams({
      taxon_id: 57278, verifiable: true, per_page: 200, order_by: 'observed_on',
      swlat: b.getSouth(), swlng: b.getWest(), nelat: b.getNorth(), nelng: b.getEast(),
    });
    try {
      const res = await fetch(`https://api.inaturalist.org/v1/observations?${q}`, { signal: inatAbort.signal });
      const { results } = await res.json();
      for (const o of results) {
        if (!o.geojson) continue;
        const [lng, lat] = o.geojson.coordinates;
        const photo = o.photos?.[0]?.url?.replace('/square.', '/small.');
        L.circleMarker([lat, lng], {
          radius: 6, weight: 1.5, color: css('--marker-ring'), fillColor: css('--seed'), fillOpacity: 0.9,
        }).bindPopup(`<div class="pop">${photo ? `<img src="${photo}" alt="">` : ''}
          <p>iNaturalist, ${esc(o.observed_on ?? 'date unknown')}, ${esc(o.quality_grade.replace('_', ' '))}</p>
          <a href="https://www.inaturalist.org/observations/${o.id}" target="_blank" rel="noopener">Open observation</a></div>`)
          .addTo(inatLayer);
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('iNaturalist', err);
    }
  }, 400);
}
map.on('overlayadd', e => { if (e.layer === inatLayer) loadInat(); });

// ---------- detections on the map and in the list ----------
const threshold = () => Number($('#threshold').value) / 100;
const pct = p => `${Math.round(p * 100)}%`;

function markerIcon(d) {
  const size = Math.round(20 + 14 * Math.min(1, (d.score - 0.3) / 0.7));
  return L.divIcon({
    className: `toh-marker${d.verdict === 'no' ? ' no' : ''}`,
    html: '<svg viewBox="0 0 20 20"><use href="#leaf-mark"/></svg>',
    iconSize: [size, size],
  });
}

const markers = new Map();
function render() {
  scanLayer.clearLayers();
  markers.clear();
  const shown = detections.filter(d => d.score >= threshold()).sort((a, b) => b.score - a.score);
  for (const d of shown) {
    const m = L.marker([d.lat, d.lng], { icon: markerIcon(d), title: `Tree of heaven ${pct(d.score)}` })
      .bindPopup(() => popup(d), { maxWidth: 290 })
      .addTo(scanLayer);
    markers.set(d.id, m);
  }
  const list = $('#results');
  list.replaceChildren(...shown.map(d => {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.dataset.verdict = d.verdict ?? '';
    const img = sessionImages.get(d.id);
    li.innerHTML = `${img ? `<img src="${img}" alt="">` : '<span class="noimg"></span>'}
      <div><div class="where">Looking ${compass(d.heading)}</div>
      <div class="sub">${d.verdict === 'yes' ? 'Confirmed' : d.verdict === 'no' ? 'Ruled out' : `Else: ${esc(d.runnerUp)}`}</div></div>
      <span class="score">${pct(d.score)}</span>`;
    const open = () => { map.flyTo([d.lat, d.lng], Math.max(map.getZoom(), 18)); markers.get(d.id).openPopup(); };
    li.querySelector('.where').textContent += d.source === 'mapillary' ? ' (Mapillary)' : ' (Street View)';
    li.onclick = open;
    li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    return li;
  }));
  $('#results-empty').hidden = shown.length > 0;
  $('#export').disabled = shown.length === 0;
}

function popup(d) {
  const div = document.createElement('div');
  div.className = 'pop';
  const img = sessionImages.get(d.id);
  const isMly = d.source === 'mapillary';
  const link = d.link ?? `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(d.panoId)}&heading=${d.heading}`;
  const credit = isMly
    ? `<p class="credit">Photo${d.credit ? ` by ${esc(d.credit)}` : ''} on Mapillary, <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a></p>`
    : '';
  div.innerHTML = `${img ? `<img src="${img}" alt="Street photo looking ${compass(d.heading)}">` : ''}
    <h3>Tree of heaven, ${pct(d.score)}</h3>
    <p>Next most likely: ${esc(d.runnerUp)}. Photo taken ${esc(d.date ?? 'on an unknown date')}.</p>
    ${credit}
    <div class="row">
      <button class="secondary" data-v="yes" aria-pressed="${d.verdict === 'yes'}">It is</button>
      <button class="secondary" data-v="no" aria-pressed="${d.verdict === 'no'}">It isn't</button>
      <a href="${link}" target="_blank" rel="noopener">${isMly ? 'Open in Mapillary' : 'Open Street View'}</a>
    </div>
    <p><button class="secondary report-btn" type="button">Report to my state</button> <a href="#" data-goto="tab-found">What to do</a></p>`;
  div.querySelector('.report-btn').onclick = () => openReport({
    lat: d.lat, lng: d.lng, confidence: d.score, photoLink: link, photoDate: d.date,
  });
  // Mapillary photos can be shown again later; Google images are only kept for the session.
  if (!img && isMly && mlyToken()) {
    mapillary.thumbnailUrl(mlyToken(), d.imageId, false).then(src => {
      const el = Object.assign(document.createElement('img'), { src, alt: '' });
      div.prepend(el);
    }).catch(() => {});
  }
  div.querySelector('[data-goto]').onclick = goto;
  div.querySelectorAll('button[data-v]').forEach(b => b.onclick = () => {
    d.verdict = d.verdict === b.dataset.v ? null : b.dataset.v;
    saveDetections();
    render();
    markers.get(d.id)?.openPopup();
  });
  return div;
}

function compass(h) {
  return ['north', 'east', 'south', 'west'][Math.round(h / 90) % 4];
}

// ---------- scanning ----------
const spacing = () => Number($('#spacing').value);
const leafOnly = () => $('#leaf-only').checked;
let sourceId = store.get('toh.source', 'mapillary');
const source = () => SOURCES[sourceId];

// One credential per source: a billed Google key, or a free Mapillary token
// (built into config.js, or pasted by the visitor).
const creds = {
  google: { box: '#key-box', input: '#api-key', save: '#save-key', state: '#key-state', storeKey: 'toh.key',
    missing: 'Add a Street View API key to scan.' },
  mapillary: { box: '#mly-box', input: '#mly-token', save: '#save-mly', state: '#mly-state', storeKey: 'toh.mlyToken',
    missing: 'Add a Mapillary access token to scan.', builtIn: MAPILLARY_TOKEN },
};
const credential = id => creds[id].builtIn || store.get(creds[id].storeKey, '');
const mlyToken = () => credential('mapillary');

for (const [id, c] of Object.entries(creds)) {
  $(c.save).onclick = () => {
    store.set(c.storeKey, $(c.input).value.trim());
    syncSource();
    if (credential(id)) $(c.box).open = false;
  };
}

function syncSource() {
  document.querySelector(`input[name="source"][value="${sourceId}"]`).checked = true;
  for (const el of document.querySelectorAll('[data-source]')) el.hidden = el.dataset.source !== sourceId;
  for (const [id, c] of Object.entries(creds)) {
    const value = credential(id);
    $(c.state).textContent = value ? 'Saved' : 'Not set';
    $(c.state).classList.toggle('ok', !!value);
    if (!c.builtIn) $(c.input).value = store.get(c.storeKey, '');
    if (c.builtIn) $(c.box).hidden = true; // site owner supplied it; nothing to ask
  }
  if (!credential(sourceId)) $(creds[sourceId].box).open = true;
  updateEstimate();
}
for (const r of document.querySelectorAll('input[name="source"]')) {
  r.onchange = () => { sourceId = r.value; store.set('toh.source', sourceId); syncSource(); };
}

// A saved credential the service refused: say so and reopen its box.
function flagAuth(err) {
  if (!err.auth) return;
  const c = creds[sourceId];
  $(c.state).textContent = 'Rejected';
  $(c.state).classList.remove('ok');
  $(c.box).open = true;
}

let estimateTimer, estimateAbort, tooBig = false;
function updateEstimate() {
  clearTimeout(estimateTimer);
  estimateAbort?.abort();
  coverageLayer.clearLayers();
  const el = $('#estimate');
  const cells = gridPoints(map.getBounds(), spacing()).length;
  tooBig = cells > MAX_POINTS;
  el.classList.toggle('warn', tooBig);
  $('#scan').disabled = tooBig || scanning;
  if (tooBig) {
    el.textContent = `This view is too big to scan at ${spacing()} m spacing. Zoom in or sample less often.`;
    return;
  }
  el.textContent = 'Checking what imagery is here…';
  estimateTimer = setTimeout(async () => {
    estimateAbort = new AbortController();
    try {
      const est = await source().estimate({
        bounds: map.getBounds(), spacing: spacing(), leafOnly: leafOnly(),
        credential: credential(sourceId), signal: estimateAbort.signal,
      });
      el.textContent = est.text;
      for (const c of est.picks ?? []) {
        L.circleMarker(c.at, { radius: 3, weight: 0, fillColor: css('--leaf'), fillOpacity: 0.55, interactive: false })
          .addTo(coverageLayer);
      }
    } catch (err) {
      if (err.name !== 'AbortError') { el.textContent = err.message; el.classList.add('warn'); flagAuth(err); }
    }
  }, 350);
}

let scanning = false, controller;
$('#scan').onclick = async () => {
  if (!credential(sourceId)) {
    const c = creds[sourceId];
    $(c.box).open = true;
    $(c.input).focus();
    return setStatus(c.missing, true);
  }
  const src = source();
  scanning = true;
  controller = new AbortController();
  $('#scan').disabled = true;
  $('#stop').hidden = false;
  const bar = $('#scan-progress');
  try {
    await ensureModel();
    bar.hidden = false;
    const started = performance.now();
    const { captures, images } = await src.scan({
      credential: credential(sourceId),
      bounds: map.getBounds(),
      spacing: spacing(),
      leafOnly: leafOnly(),
      skip: scanned,
      signal: controller.signal,
      onProgress({ done, total, captures, images }) {
        bar.max = Math.max(total, 1);
        bar.value = done;
        const secs = (performance.now() - started) / 1000;
        const eta = done > 3 ? Math.round((secs / done) * (total - done) / 60) : null;
        setStatus(`Checked ${done} of ${total} ${src.unit}, ${images} images downloaded${eta !== null ? `. About ${eta} min left` : ''}`);
      },
      onCapture(c) {
        for (const v of c.views) {
          if (v.toh < KEEP_FLOOR) continue;
          const id = `${c.key}:${v.heading}`;
          const [lat, lng] = offset(c.at, v.heading, 12); // trees sit beside the road, not on it
          detections = detections.filter(d => d.id !== id);
          detections.push({
            id, source: src.id, panoId: src.id === 'google' ? c.key : undefined, imageId: c.imageId,
            heading: v.heading, lat, lng, panoAt: c.at, date: c.date, credit: c.credit ?? null, link: c.link(v.heading),
            score: v.toh, runnerUp: v.ranked.find(r => r.id !== 'toh').name, found: new Date().toISOString(), verdict: null,
          });
          sessionImages.set(id, URL.createObjectURL(v.blob));
        }
        saveDetections();
        store.set('toh.scanned', [...scanned]);
        render();
      },
    });
    const flagged = detections.filter(d => d.score >= threshold()).length;
    setStatus(`${controller.signal.aborted ? 'Stopped' : 'Done'}. ${captures} new ${src.id === 'google' ? 'panoramas' : 'photos'} checked. ${flagged} views flagged in total.`);
  } catch (err) {
    setStatus(err.message, true);
    flagAuth(err);
  } finally {
    store.set('toh.scanned', [...scanned]);
    scanning = false;
    $('#stop').hidden = true;
    bar.hidden = true;
    updateEstimate();
  }
};
$('#stop').onclick = () => controller?.abort();

function setStatus(msg, isError = false) {
  const el = $('#scan-status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

$('#spacing').oninput = () => { $('#spacing-out').value = spacing(); updateEstimate(); };
$('#leaf-only').onchange = updateEstimate;
$('#threshold').oninput = () => { $('#threshold-out').value = $('#threshold').value; render(); };

$('#clear').onclick = () => {
  if (!confirm('Clear all scan results and the list of scanned photos from this browser?')) return;
  detections = [];
  scanned.clear();
  sessionImages.forEach(URL.revokeObjectURL);
  sessionImages.clear();
  saveDetections();
  store.set('toh.scanned', []);
  render();
  setStatus('');
};

$('#export').onclick = () => {
  const features = detections.filter(d => d.score >= threshold()).map(d => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
    properties: {
      confidence: Number(d.score.toFixed(3)), heading: d.heading, source: d.source,
      image: d.source === 'mapillary' ? d.imageId : d.panoId, link: d.link ?? null,
      credit: d.source === 'mapillary' ? `${d.credit ?? 'Mapillary contributor'}, Mapillary, CC BY-SA 4.0` : null,
      camera: [d.panoAt[1], d.panoAt[0]], imagery_date: d.date, next_most_likely: d.runnerUp,
      verdict: d.verdict, found: d.found,
    },
  }));
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/geo+json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'tree-of-heaven.geojson' });
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------- place search ----------
$('#place-form').onsubmit = async e => {
  e.preventDefault();
  const q = $('#place').value.trim();
  if (!q) return;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'json', limit: 1 })}`);
    const [hit] = await res.json();
    if (!hit) return setStatus(`No place called “${q}” found. Try adding a state or country.`, true);
    map.flyTo([Number(hit.lat), Number(hit.lon)], 17);
    setStatus('');
  } catch {
    setStatus('Place search is unavailable right now. Pan the map instead.', true);
  }
};
$('#locate').onclick = () => {
  navigator.geolocation?.getCurrentPosition(
    p => map.flyTo([p.coords.latitude, p.coords.longitude], 17),
    () => setStatus('Location is blocked. Allow it in your browser, or search for a place.', true),
  );
};

// ---------- model loading ----------
const toast = $('#model-toast');
async function ensureModel() {
  toast.hidden = false;
  toast.textContent = 'Loading the tree model…';
  try {
    await loadModel((got, total) => {
      toast.textContent = total
        ? `Downloading the tree model, ${Math.round((got / total) * 100)}% of ${Math.round(total / 1e6)} MB (first time only)`
        : `Downloading the tree model, ${Math.round(got / 1e6)} MB`;
    });
  } finally {
    toast.hidden = true;
  }
}

// ---------- photo check ----------
async function checkFiles(files) {
  const out = $('#photo-results');
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const card = document.createElement('article');
    card.className = 'verdict';
    const url = URL.createObjectURL(file);
    card.innerHTML = `<img src="${url}" alt=""><div><h3>Checking…</h3></div>`;
    out.prepend(card);
    try {
      await ensureModel();
      const bitmap = await createImageBitmap(file);
      const [r] = await classify([bitmap]);
      const top = r.ranked[0];
      let cls, title, note;
      if (top.id === 'not_tree' || top.id === 'street') {
        cls = 'no'; title = 'This doesn’t look like a tree';
        note = 'Try a photo of a single leaf or a branch tip, filling most of the frame.';
      } else if (r.toh >= 0.7) {
        cls = 'yes'; title = 'Likely tree of heaven';
        note = 'Check the leaflet bases for glandular teeth, and crush a leaf to smell it.';
      } else if (r.toh >= 0.4) {
        cls = 'maybe'; title = 'Possibly tree of heaven';
        note = `It could also be ${top.id === 'toh' ? r.ranked[1].name.toLowerCase() : top.name.toLowerCase()}. A closer photo of one leaf will help.`;
      } else {
        cls = 'no'; title = `Probably not. Looks most like ${top.name.toLowerCase()}`;
        note = 'Lookalikes have toothed leaflet edges all the way around.';
      }
      card.classList.add(cls);
      const rows = r.ranked.slice(0, 4);
      if (!rows.some(x => x.id === 'toh')) rows[3] = r.ranked.find(x => x.id === 'toh');
      card.querySelector('div').innerHTML = `<h3>${esc(title)}</h3><p>${esc(note)}</p>
        <div class="bars">${rows.map(x => `<div class="bar${x.id === 'toh' ? ' toh' : ''}">
          <span style="--w:${Math.max(2, x.p * 100).toFixed(1)}%">${esc(x.name)}</span><b>${pct(x.p)}</b></div>`).join('')}</div>
        ${cls !== 'no' ? '<button type="button" class="secondary report-btn">Report to my state</button><p class="report-hint"></p>' : ''}`;
      card.querySelector('.report-btn')?.addEventListener('click', e => reportUpload(e.currentTarget, r.toh));
    } catch (err) {
      card.querySelector('h3').textContent = `Couldn’t check this photo: ${err.message}`;
    }
  }
}
// Uploaded photos carry no reliable location, so ask the device where the person is.
function reportUpload(btn, confidence) {
  const hint = btn.nextElementSibling;
  if (!navigator.geolocation) {
    hint.textContent = 'This browser can’t share your location. Report from the map instead.';
    return;
  }
  hint.textContent = 'Using your current location: stand next to the tree.';
  navigator.geolocation.getCurrentPosition(
    p => { hint.textContent = ''; openReport({ lat: p.coords.latitude, lng: p.coords.longitude, confidence, uploaded: true }); },
    () => { hint.textContent = 'Location is blocked. Allow it in your browser settings, then try again.'; },
    { enableHighAccuracy: true, timeout: 15000 },
  );
}

$('#file').onchange = e => { checkFiles([...e.target.files]); e.target.value = ''; };
const drop = $('#drop');
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); checkFiles([...e.dataTransfer.files]); };

// ---------- tabs ----------
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  tab.focus();
}
function goto(e) {
  e.preventDefault();
  map.closePopup();
  selectTab(document.getElementById(e.currentTarget.dataset.goto));
  $('.panel').scrollTop = 0;
}
for (const a of document.querySelectorAll('[data-goto]')) a.onclick = goto;
tabs.forEach((t, i) => {
  t.onclick = () => selectTab(t);
  t.onkeydown = e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d) selectTab(tabs[(i + d + tabs.length) % tabs.length]);
  };
});

// ---------- helpers ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Point "About and source" at the GitHub repo when served from github.io.
if (location.hostname.endsWith('.github.io')) {
  const user = location.hostname.split('.')[0];
  const repo = location.pathname.split('/').filter(Boolean)[0] ?? `${user}.github.io`;
  $('#source-link').href = `https://github.com/${user}/${repo}`;
}

$('#year').textContent = new Date().getFullYear();
render();
syncSource();
loadInat();

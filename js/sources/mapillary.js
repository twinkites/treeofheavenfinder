// Mapillary: crowd-sourced street photos under CC BY-SA 4.0. Free to use with
// a client token. List every photo in the view, keep the best one per grid
// cell, and classify crops facing the roadside.
import { classify } from '../model.js';
import { cellKey, normHeading, pool } from '../geo.js';

const API = 'https://graph.mapillary.com';
const LIST_FIELDS = 'id,computed_geometry,geometry,computed_compass_angle,compass_angle,captured_at,is_pano,camera_type,creator';
const PAGE = 2000; // the API's per-request maximum
const SIDE_ANGLE = 25; // rough bearing of the left/right crop centers in a normal photo

export const id = 'mapillary';
export const name = 'Mapillary';
export const unit = 'photos';

async function api(path, params, signal) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { signal });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    const auth = res.status === 401 || /token/i.test(msg);
    throw Object.assign(new Error(auth ? `Mapillary rejected the access token (${msg}). Check it and save it again.` : `Mapillary said: ${msg}`), { auth });
  }
  return json;
}

// The API caps one response at PAGE photos, so split busy boxes into quarters.
async function listImages(token, [w, s, e, n], signal, depth = 0) {
  const { data } = await api('images', { access_token: token, fields: LIST_FIELDS, bbox: [w, s, e, n].join(','), limit: PAGE }, signal);
  if (data.length < PAGE || depth >= 3) return data;
  const mx = (w + e) / 2, my = (s + n) / 2;
  const parts = await Promise.all([[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]]
    .map(b => listImages(token, b, signal, depth + 1)));
  return [...new Map(parts.flat().map(img => [img.id, img])).values()];
}

const isPano = img => img.is_pano || img.camera_type === 'equirectangular' || img.camera_type === 'spherical';

// Leaves are out May to October in the north, November to April in the south.
function leafOn(img, lat) {
  const m = new Date(img.captured_at).getUTCMonth() + 1;
  return lat >= 0 ? m >= 5 && m <= 10 : m >= 11 || m <= 4;
}

function toCapture(img) {
  const [lng, lat] = (img.computed_geometry ?? img.geometry).coordinates;
  return {
    id: img.id,
    at: [lat, lng],
    heading: img.computed_compass_angle ?? img.compass_angle ?? 0,
    pano: isPano(img),
    capturedAt: img.captured_at,
    creator: img.creator?.username ?? null,
  };
}

// One photo per grid cell: prefer leaf-on, then 360° panoramas, then the newest.
async function pick({ bounds, spacing, credential, leafOnly, signal }) {
  const raw = await listImages(credential, [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], signal);
  const best = new Map();
  for (const img of raw) {
    const c = toCapture(img);
    c.leaf = leafOn(img, c.at[0]);
    if (leafOnly && !c.leaf) continue;
    if (!bounds.contains(c.at)) continue;
    const k = cellKey(c.at, spacing);
    const cur = best.get(k);
    const rank = x => [x.leaf, x.pano, x.capturedAt];
    if (!cur || compare(rank(c), rank(cur)) > 0) best.set(k, c);
  }
  return { total: raw.length, picks: [...best.values()] };
}

function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export async function estimate(opts) {
  if (!opts.credential) return { count: 0, picks: [], text: 'Add a Mapillary access token to see which photos are available here.' };
  const { total, picks } = await pick(opts);
  const text = total === 0
    ? 'Nobody has uploaded Mapillary photos here yet. Try another area, or switch to Google Street View.'
    : picks.length === 0
      ? `${total.toLocaleString()} photos here, but none taken while trees are in leaf. Untick "Only use photos taken while trees are in leaf" to use them anyway.`
      : `${total.toLocaleString()} photos here. The scan will use ${picks.length.toLocaleString()} of them, about one every ${opts.spacing} m. Mapillary is free, and photos scanned before are skipped.`;
  return { count: picks.length, picks, text };
}

// Square crops to classify, with the compass heading each one faces.
function crops(c, w, h) {
  if (c.pano) {
    // Equirectangular: four 90° slices around the horizon, biased slightly upward
    // where tree crowns are. Centers at 1/8, 3/8, 5/8 and 7/8 of the width never wrap the seam.
    const side = Math.round(w / 4);
    const y = Math.max(0, Math.round(h / 2 - side * 0.6));
    return [1, 3, 5, 7].map(k => ({
      rect: [Math.round((k * w) / 8 - side / 2), y, side, Math.min(side, h - y)],
      heading: normHeading(c.heading + (k / 8 - 0.5) * 360),
    }));
  }
  if (w >= h * 1.25) {
    // A normal forward-facing photo: the roadside is at the left and right edges.
    return [
      { rect: [0, 0, h, h], heading: normHeading(c.heading - SIDE_ANGLE) },
      { rect: [w - h, 0, h, h], heading: normHeading(c.heading + SIDE_ANGLE) },
    ];
  }
  const side = Math.min(w, h);
  return [{ rect: [Math.round((w - side) / 2), 0, side, side], heading: normHeading(c.heading) }];
}

export async function thumbnailUrl(token, imageId, pano, signal) {
  const field = pano ? 'thumb_2048_url' : 'thumb_1024_url';
  return (await api(imageId, { access_token: token, fields: field }, signal))[field];
}

async function scoreCapture(token, c, signal) {
  const res = await fetch(await thumbnailUrl(token, c.id, c.pano, signal), { signal });
  if (!res.ok) throw new Error(`Couldn't download Mapillary photo ${c.id} (${res.status}).`);
  const blob = await res.blob();
  const full = await createImageBitmap(blob);
  const parts = crops(c, full.width, full.height);
  full.close();
  const bitmaps = await Promise.all(parts.map(p => createImageBitmap(blob, ...p.rect)));
  const results = await classify(bitmaps);
  // Each view keeps its own crop as the preview, so the popup shows what was scored.
  return Promise.all(results.map(async (r, i) => ({
    heading: parts[i].heading,
    toh: r.toh,
    ranked: r.ranked,
    blob: await cropBlob(blob, parts[i].rect),
  })));
}

async function cropBlob(blob, [x, y, w, h]) {
  const bmp = await createImageBitmap(blob, x, y, w, h);
  const scale = Math.min(1, 480 / w);
  const canvas = new OffscreenCanvas(Math.round(w * scale), Math.round(h * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

export async function scan({ credential, bounds, spacing, leafOnly, skip, signal, onProgress, onCapture }) {
  const { picks } = await pick({ bounds, spacing, credential, leafOnly, signal });
  const todo = picks.filter(c => !skip.has(`mly:${c.id}`));
  let done = 0, captures = 0, images = 0;
  const report = () => onProgress({ done, total: todo.length, captures, images });
  report();

  await pool(todo, 3, signal, async c => {
    const views = await scoreCapture(credential, c, signal);
    skip.add(`mly:${c.id}`);
    captures++;
    images++;
    done++;
    onCapture({
      key: `mly:${c.id}`,
      imageId: c.id,
      pano: c.pano,
      at: c.at,
      date: new Date(c.capturedAt).toISOString().slice(0, 7),
      credit: c.creator,
      link: () => `https://www.mapillary.com/app/?pKey=${c.id}&focus=photo`,
      views,
    });
    report();
  }).catch(err => { if (err.name !== 'AbortError') throw err; });
  return { captures, images };
}

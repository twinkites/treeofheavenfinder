// Google Street View: sample a grid, find the nearest panorama to each point,
// and classify four views from every panorama. Billed per image.
import { classify } from '../model.js';
import { gridPoints, metersBetween, pool } from '../geo.js';

const API = 'https://maps.googleapis.com/maps/api/streetview';
const HEADINGS = [0, 90, 180, 270];
const IMG_W = 640, IMG_H = 480;

export const id = 'google';
export const name = 'Street View';
export const unit = 'sample points';

export function estimate({ bounds, spacing }) {
  const n = gridPoints(bounds, spacing).length;
  return {
    count: n,
    text: `${n.toLocaleString()} sample points, so at most ${(n * HEADINGS.length).toLocaleString()} Street View images. Each one counts against your Google quota. Places scanned before are skipped.`,
  };
}

async function metadata(key, [lat, lng], radius) {
  const q = new URLSearchParams({ location: `${lat},${lng}`, radius, source: 'outdoor', key });
  const json = await (await fetch(`${API}/metadata?${q}`)).json();
  if (json.status === 'OK') return { panoId: json.pano_id, at: [json.location.lat, json.location.lng], date: json.date };
  if (json.status === 'ZERO_RESULTS' || json.status === 'NOT_FOUND') return null;
  throw new Error(`Street View said ${json.status}${json.error_message ? `: ${json.error_message}` : ''}`);
}

function imageUrl(key, panoId, heading) {
  const q = new URLSearchParams({
    size: `${IMG_W}x${IMG_H}`, pano: panoId, heading, fov: 90, pitch: 10, key, return_error_code: true,
  });
  return `${API}?${q}`;
}

// Score one view. Trees fill only part of a street scene, so classify two
// overlapping squares (left and right) and keep the stronger one.
async function scoreView(key, panoId, heading) {
  const res = await fetch(imageUrl(key, panoId, heading));
  if (!res.ok) throw new Error(`Street View image request failed (${res.status}). Check that the Street View Static API is enabled for your key.`);
  const blob = await res.blob();
  const side = IMG_H;
  const crops = await Promise.all([0, IMG_W - side].map(x => createImageBitmap(blob, x, 0, side, side)));
  const results = await classify(crops);
  const best = results.reduce((a, b) => (b.toh > a.toh ? b : a));
  return { heading, toh: best.toh, ranked: best.ranked, blob };
}

export async function scan({ credential: key, bounds, spacing, skip, signal, onProgress, onCapture }) {
  const points = gridPoints(bounds, spacing);
  const seenAt = [];
  let done = 0, captures = 0, images = 0;
  const report = () => onProgress({ done, total: points.length, captures, images });
  report();

  await pool(points, 3, signal, async pt => {
    const meta = await metadata(key, pt, Math.round(spacing / 2));
    if (meta && !skip.has(meta.panoId) && !seenAt.some(p => metersBetween(p, meta.at) < spacing / 2)) {
      skip.add(meta.panoId);
      seenAt.push(meta.at);
      const views = [];
      for (const h of HEADINGS) {
        if (signal.aborted) break;
        views.push(await scoreView(key, meta.panoId, h));
        images++;
        report();
      }
      captures++;
      if (views.length) {
        onCapture({
          key: meta.panoId, at: meta.at, date: meta.date, views,
          link: h => `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(meta.panoId)}&heading=${h}`,
        });
      }
    }
    done++;
    report();
  });
  return { captures, images };
}

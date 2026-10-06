// Small flat-earth helpers. Scans cover a few km, so the error is negligible.
const M_PER_DEG = 111320;
const RAD = Math.PI / 180;

export function gridPoints(bounds, spacing) {
  const south = bounds.getSouth(), north = bounds.getNorth();
  const west = bounds.getWest(), east = bounds.getEast();
  const dLat = spacing / M_PER_DEG;
  const dLng = spacing / (M_PER_DEG * Math.cos(((south + north) / 2) * RAD));
  const pts = [];
  for (let lat = south + dLat / 2; lat < north; lat += dLat) {
    for (let lng = west + dLng / 2; lng < east; lng += dLng) pts.push([lat, lng]);
  }
  return pts;
}

// Key of the spacing-sized grid cell a point falls in.
export function cellKey([lat, lng], spacing) {
  return `${Math.floor((lat * M_PER_DEG) / spacing)}:${Math.floor((lng * M_PER_DEG * Math.cos(lat * RAD)) / spacing)}`;
}

export function metersBetween([lat1, lng1], [lat2, lng2]) {
  const x = (lng2 - lng1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD);
  return Math.hypot(x, (lat2 - lat1) * RAD) * 6371000;
}

// A point `m` meters from `from` along a compass heading.
export function offset([lat, lng], heading, m) {
  return [
    lat + (m * Math.cos(heading * RAD)) / M_PER_DEG,
    lng + (m * Math.sin(heading * RAD)) / (M_PER_DEG * Math.cos(lat * RAD)),
  ];
}

export const normHeading = h => ((Math.round(h) % 360) + 360) % 360;

// Run `fn` over `items` with a fixed number in flight; stops early on abort.
export async function pool(items, size, signal, fn) {
  const queue = items.slice();
  const run = async () => {
    while (queue.length && !signal.aborted) await fn(queue.shift());
  };
  await Promise.all(Array.from({ length: size }, run));
}

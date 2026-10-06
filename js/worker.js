// Runs the classifier off the main thread so the map stays responsive.
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.wasm.min.mjs';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';

let session, meta;

async function load(base) {
  meta = await (await fetch(`${base}toh.json`)).json();
  const res = await fetch(`${base}toh.onnx`);
  if (!res.ok) throw new Error(`Model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    postMessage({ type: 'progress', got, total });
  }
  const bytes = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  return meta;
}

// Shortest side to SIZE, center crop, CLIP normalization. Mirrors training/train.py.
function toPixels(bitmap, out, offset) {
  const S = meta.size;
  const scale = S / Math.min(bitmap.width, bitmap.height);
  const w = Math.max(S, Math.round(bitmap.width * scale));
  const h = Math.max(S, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, -Math.floor((w - S) / 2), -Math.floor((h - S) / 2), w, h);
  const { data } = ctx.getImageData(0, 0, S, S);
  const plane = S * S;
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      out[offset + c * plane + i] = (data[i * 4 + c] / 255 - meta.mean[c]) / meta.std[c];
    }
  }
}

async function classify(bitmaps) {
  const S = meta.size;
  const n = bitmaps.length;
  const input = new Float32Array(n * 3 * S * S);
  bitmaps.forEach((b, i) => { toPixels(b, input, i * 3 * S * S); b.close(); });
  const out = await session.run({ pixels: new ort.Tensor('float32', input, [n, 3, S, S]) });
  const probs = out.probs.data;
  const k = meta.classes.length;
  return Array.from({ length: n }, (_, i) => Array.from(probs.slice(i * k, (i + 1) * k)));
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') postMessage({ id: data.id, result: await load(data.base) });
    if (data.type === 'classify') postMessage({ id: data.id, result: await classify(data.bitmaps) });
  } catch (err) {
    postMessage({ id: data.id, error: err.message || String(err) });
  }
};

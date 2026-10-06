// Main-thread wrapper around the classifier worker.
export const CLASS_NAMES = {
  toh: 'Tree of heaven',
  sumac: 'Sumac',
  walnut: 'Walnut',
  ash: 'Ash',
  hickory: 'Hickory',
  locust: 'Black or honey locust',
  boxelder: 'Box elder',
  other_compound: 'Another compound-leaf tree',
  other_tree: 'Another kind of tree',
  not_tree: 'Not a tree',
  street: 'Street or buildings',
};

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let nextId = 0;
let onProgress = () => {};
let loading;
let classes;

worker.onmessage = ({ data }) => {
  if (data.type === 'progress') return onProgress(data.got, data.total);
  const p = pending.get(data.id);
  pending.delete(data.id);
  data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
};

function call(msg, transfer = []) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

export function loadModel(progress) {
  if (progress) onProgress = progress;
  loading ??= call({ type: 'load', base: new URL('../model/', import.meta.url).href })
    .then(meta => { classes = meta.classes; return meta; })
    .catch(err => { loading = null; throw err; });
  return loading;
}

// Each result: { toh, ranked: [{ id, name, p }] } sorted by probability.
export async function classify(bitmaps) {
  await loadModel();
  const rows = await call({ type: 'classify', bitmaps }, bitmaps);
  return rows.map(probs => {
    const ranked = classes
      .map((id, i) => ({ id, name: CLASS_NAMES[id] ?? id, p: probs[i] }))
      .sort((a, b) => b.p - a.p);
    return { toh: probs[classes.indexOf('toh')], ranked };
  });
}

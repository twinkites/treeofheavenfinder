"""Download street-scene crops from Mapillary to teach the model what an ordinary
street without tree of heaven looks like. Without them, every row house and
utility pole scores as tree of heaven, because iNaturalist photos of Ailanthus
are so often taken in alleys and beside buildings.

Crops are cut the same way the app cuts them (js/sources/mapillary.js).

Usage: MAPILLARY_TOKEN='MLY|...' python fetch_streets.py data/
Appends rows with class "street" to data/manifest.csv; run after fetch_data.py.
"""
import csv, io, json, os, random, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from PIL import Image

TOKEN = os.environ['MAPILLARY_TOKEN']
API = 'https://graph.mapillary.com'

# Mostly cities north of tree of heaven's range, so labels are clean. A few US
# cities add familiar architecture; a handful of their crops may contain the
# tree, which the classifier tolerates. Reading, PA is left out: it's the test area.
CITIES = {
    'oslo': (59.9139, 10.7522), 'helsinki': (60.1699, 24.9384), 'stockholm': (59.3293, 18.0686),
    'tampere': (61.4978, 23.7610), 'trondheim': (63.4305, 10.3951), 'reykjavik': (64.1466, -21.9426),
    'anchorage': (61.2181, -149.9003), 'edmonton': (53.5461, -113.4938), 'calgary': (51.0447, -114.0719),
    'winnipeg': (49.8951, -97.1384), 'saskatoon': (52.1332, -106.6700), 'quebec': (46.8139, -71.2080),
    'duluth': (46.7867, -92.1005), 'fargo': (46.8772, -96.7898),
    'philadelphia': (39.9500, -75.1600), 'baltimore': (39.2900, -76.6100), 'pittsburgh': (40.4400, -79.9900),
    'allentown': (40.6000, -75.4700), 'harrisburg': (40.2700, -76.8800), 'cleveland': (41.5000, -81.6900),
    'columbus': (39.9600, -83.0000), 'newark': (40.7300, -74.1700),
}
BOXES_PER_CITY = 3
IMAGES_PER_BOX = 15
UA = {'User-Agent': 'tree-of-heaven-finder-training/1.0'}


def get(url, as_json=True, tries=4):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
            return json.loads(data) if as_json else data
        except Exception as e:
            print('retry', e, file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    return None


def leaf_on(ms, lat):
    m = datetime.fromtimestamp(ms / 1000, timezone.utc).month
    return 5 <= m <= 10 if lat >= 0 else (m >= 11 or m <= 4)


def crops(img, pano):
    w, h = img.size
    if pano:
        side = w // 4
        y = max(0, round(h / 2 - side * 0.6))
        return [img.crop((round(k * w / 8 - side / 2), y, round(k * w / 8 + side / 2), y + min(side, h - y))) for k in (1, 3, 5, 7)]
    if w >= h * 1.25:
        return [img.crop((0, 0, h, h)), img.crop((w - h, 0, w, h))]
    s = min(w, h)
    return [img.crop(((w - s) // 2, 0, (w - s) // 2 + s, s))]


def list_box(cx, cy, half_w, half_h):
    """Dense areas make the API time out (HTTP 500), so shrink the box and retry."""
    for shrink in (1, 0.5, 0.25):
        bbox = f'{cx - half_w * shrink:.5f},{cy - half_h * shrink:.5f},{cx + half_w * shrink:.5f},{cy + half_h * shrink:.5f}'
        q = urllib.parse.urlencode({'access_token': TOKEN, 'bbox': bbox, 'limit': 500,
                                    'fields': 'id,captured_at,is_pano,camera_type'})
        res = get(f'{API}/images?{q}', tries=2)
        if res is not None:
            return res.get('data', [])
    return []


def fetch_one(args):
    city, i, out_dir = args
    pano = i.get('is_pano') or i.get('camera_type') in ('equirectangular', 'spherical')
    field = 'thumb_2048_url' if pano else 'thumb_1024_url'
    meta = get(f'{API}/{i["id"]}?{urllib.parse.urlencode({"access_token": TOKEN, "fields": field})}', tries=2)
    data = meta and meta.get(field) and get(meta[field], as_json=False, tries=2)
    if not data:
        return []
    img = Image.open(io.BytesIO(data)).convert('RGB')
    rows = []
    for k, c in enumerate(crops(img, pano)):
        path = os.path.join(out_dir, f'{city}_{i["id"]}_{k}.jpg')
        c.save(path, quality=90)
        rows.append((path, 'street', city, i['id'], f'city:{city}'))
    return rows


def main(root):
    out_dir = os.path.join(root, 'street')
    os.makedirs(out_dir, exist_ok=True)
    rng = random.Random(0)
    rows = []
    with ThreadPoolExecutor(8) as ex:
        for city, (lat, lng) in CITIES.items():
            jobs = []
            for _ in range(BOXES_PER_CITY):
                cy, cx = lat + rng.uniform(-0.03, 0.03), lng + rng.uniform(-0.05, 0.05)
                imgs = [i for i in list_box(cx, cy, 0.006, 0.004) if leaf_on(i['captured_at'], lat)]
                rng.shuffle(imgs)
                jobs += [(city, i, out_dir) for i in imgs[:IMAGES_PER_BOX]]
            got = [r for r in ex.map(fetch_one, jobs) if r]
            rows += [row for r in got for row in r]
            print(f'{city:14} {len(got)} photos', flush=True)

    manifest = os.path.join(root, 'manifest.csv')
    with open(manifest, newline='') as f:
        keep = [r for r in csv.reader(f) if r and r[1] != 'street']
    with open(manifest, 'w', newline='') as f:
        csv.writer(f).writerows(keep + rows)
    print(f'{len(rows)} street crops')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'data')

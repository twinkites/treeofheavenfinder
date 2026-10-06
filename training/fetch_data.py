"""Download a labeled photo set from iNaturalist research-grade observations.

Usage: python fetch_data.py data/   (writes data/<class>/<obs_id>.jpg and data/manifest.csv)
"""
import csv, json, os, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

# class -> list of (taxon name, number of photos)
CLASSES = {
    'toh': [('Ailanthus altissima', 900)],
    'sumac': [('Rhus typhina', 150), ('Rhus glabra', 120), ('Rhus copallinum', 80)],
    'walnut': [('Juglans nigra', 200), ('Juglans cinerea', 50)],
    'ash': [('Fraxinus americana', 120), ('Fraxinus pennsylvanica', 120)],
    'hickory': [('Carya ovata', 80), ('Carya glabra', 60), ('Carya cordiformis', 60)],
    'locust': [('Robinia pseudoacacia', 130), ('Gleditsia triacanthos', 100)],
    'boxelder': [('Acer negundo', 180)],
    'other_compound': [('Toona sinensis', 80), ('Phellodendron amurense', 50), ('Sorbus americana', 60),
                       ('Toxicodendron vernix', 60), ('Sambucus canadensis', 60), ('Koelreuteria paniculata', 50)],
    'other_tree': [(t, 35) for t in ('Acer rubrum', 'Acer platanoides', 'Acer saccharinum', 'Quercus rubra',
                                     'Platanus occidentalis', 'Liriodendron tulipifera', 'Ulmus americana',
                                     'Prunus serotina', 'Morus alba', 'Paulownia tomentosa', 'Catalpa speciosa',
                                     'Pyrus calleryana', 'Celtis occidentalis', 'Populus deltoides')],
    # Uploads aren't always trees; give the model somewhere else to put them.
    'not_tree': [('Insecta', 60), ('Aves', 50), ('Mammalia', 40), ('Fungi', 50), ('Poaceae', 60), ('Asteraceae', 60)],
}
LICENSES = 'cc0,cc-by,cc-by-nc,cc-by-sa,cc-by-nc-sa'
UA = {'User-Agent': 'tree-of-heaven-finder-training/1.0'}


def get_json(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except Exception as e:
            print('retry', e, file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(url)


def observations(taxon, n):
    """Spread requests across years so one season or year doesn't dominate."""
    years = list(range(2018, 2026))
    per_year = -(-n // len(years))
    out = []
    for y in years:
        q = urllib.parse.urlencode({
            'taxon_name': taxon, 'quality_grade': 'research', 'photos': 'true', 'year': y,
            'photo_license': LICENSES, 'per_page': min(per_year, 200), 'order_by': 'votes',
        })
        res = get_json(f'https://api.inaturalist.org/v1/observations?{q}')['results']
        for o in res:
            if ' ' not in taxon or o['taxon']['name'].startswith(taxon.split()[0]):
                out.append((o['id'], o['photos'][0]['url'].replace('/square.', '/medium.'), o['user']['login']))
        time.sleep(1)
    return out[:n]


def download(args):
    path, url = args
    if os.path.exists(path):
        return
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            data = r.read()
        with open(path, 'wb') as f:
            f.write(data)
    except Exception as e:
        print('skip', url, e, file=sys.stderr)


def main(root):
    rows, jobs = [], []
    for cls, taxa in CLASSES.items():
        os.makedirs(os.path.join(root, cls), exist_ok=True)
        for taxon, n in taxa:
            obs = observations(taxon, n)
            print(f'{cls:15} {taxon:28} {len(obs)}')
            for oid, url, user in obs:
                path = os.path.join(root, cls, f'{oid}.jpg')
                rows.append((path, cls, taxon, oid, user))
                jobs.append((path, url))
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(download, jobs))
    with open(os.path.join(root, 'manifest.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['path', 'class', 'taxon', 'observation_id', 'user'])
        w.writerows(r for r in rows if os.path.exists(r[0]))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'data')

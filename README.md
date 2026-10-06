# Tree of Heaven Finder

A static web app for GitHub Pages that maps likely **tree of heaven** (*Ailanthus altissima*), the invasive tree that spotted lanternflies depend on.

- **Scan streets.** Pan the map to a neighbourhood and press *Scan this map view*. The app finds street-level photos on a grid, looks toward the roadside, and flags views that the model thinks contain tree of heaven. You can mark each result *It is* / *It isn't* and download the results as GeoJSON. There are two photo sources:
  - **Mapillary** (the default): free, crowd-sourced, CC BY-SA 4.0. Coverage varies a lot from place to place.
  - **Google Street View**: covers most roads, but each visitor needs their own billed API key.
- **Check a photo.** Drop in your own photos to see how likely each one is tree of heaven and which lookalike it most resembles. Photos are never uploaded anywhere.
- **Found one?** What to do next: confirm the ID, check for spotted lanternflies, report the tree, and remove it without making things worse. Drawn from USDA, state forestry and Mass Audubon guidance, with links.
- **Report to my state.** Any scan result or likely photo can be turned into a draft email with the address, coordinates, map link and photo link. It is addressed to the state agency when that state collects these reports (see `js/report-contacts.js`), and otherwise points to EDDMapS. Uploaded photos use the device's location.
- **iNaturalist layer.** Known *Ailanthus* sightings from iNaturalist appear as amber dots for reference.

Everything runs in the browser. The model (~88 MB, downloaded once and then cached) runs in a Web Worker with [ONNX Runtime Web](https://onnxruntime.ai/).

## Deploy to GitHub Pages

1. Create a repository and push this folder to it.
2. In the repo, open **Settings → Pages**, choose **Deploy from a branch**, then select `main` and `/ (root)`.
3. Your site will be at `https://<user>.github.io/<repo>/`.

`model/toh.onnx` is under GitHub's 100 MB file limit, so it does not need Git LFS. Don't use LFS for it: GitHub Pages serves LFS pointer files, not the real content.

To run it locally, serve the folder with any static server (`python3 -m http.server`) and open `http://localhost:8000`. Opening `index.html` as a file won't work, because module workers need http.

## Mapillary access token

1. Sign in at [mapillary.com/dashboard/developers](https://www.mapillary.com/dashboard/developers) and register an app. Read access is all it needs.
2. Copy the **client token** (it starts with `MLY|`) into `js/config.js`.

Client tokens are designed to be public, so putting one in the site is fine, and visitors can then scan without signing up. If you leave `config.js` empty, each visitor is asked for their own token.

How a Mapillary scan works: the app lists every photo in the map view and keeps one per grid cell. It prefers photos taken while trees are in leaf (May to October, or November to April in the southern hemisphere), then 360° panoramas, then the newest. Panoramas are cut into four 90° views. Ordinary forward-facing photos are cropped at the left and right edges, where the roadside is. Light green dots on the map show which photos a scan will use. Results credit the photographer, as the CC BY-SA licence requires, and the GeoJSON export carries that credit too.

## Google Street View API key

Only needed for the Google source. Each viewer pastes a key into the app, and it is stored only in their browser's `localStorage`.

1. In [Google Cloud console](https://console.cloud.google.com/google/maps-apis), enable the **Street View Static API** and create an API key.
2. **Restrict the key.** Under *Application restrictions*, choose *Websites* and add `https://<user>.github.io/*`. Under *API restrictions*, allow only the Street View Static API.
3. Set a daily quota cap so a large scan can't run up a bill.

Cost: metadata lookups are free. Each panorama costs 4 image requests, one per compass direction. The app shows the maximum number of images before you scan, caps a single scan at 600 sample points, and remembers which panoramas it already scanned so they aren't billed twice.

**Terms of service.** The [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms) restrict scraping, caching and building derived datasets from Street View content. This app keeps images only in memory for the current session and stores just the coordinates of flagged views. Even so, read the terms yourself before you scan large areas or publish results. If that's a concern, use the Mapillary source.

## The model

`model/toh.onnx` takes a 224×224 image and returns probabilities for 10 classes: tree of heaven, sumac, walnut, ash, hickory, black/honey locust, box elder, other compound-leaved trees (toon, Amur cork tree, mountain ash, poison sumac, elderberry, goldenrain tree), other trees, and "not a tree".

It is a linear classifier trained on frozen image embeddings from [BioCLIP](https://huggingface.co/imageomics/bioclip), a CLIP model trained on the tree of life (MIT licence). Training photos are research-grade iNaturalist observations with Creative Commons licences. Each photo was also used in a blurred, low-resolution copy to make the model more tolerant of trees seen from the road.

**How good is it?** Measured on held-out photos from iNaturalist users, and street scenes from cities, that were never used in training:

| Photos | Flag threshold | Precision (flagged that really are ToH) | Recall (ToH that gets flagged) |
|---|---|---|---|
| Clear close-ups (photo check) | 70% | 96% | 66% |
| Clear close-ups (photo check) | 50% | 93% | 77% |
| Close-ups blurred to look like street imagery | 50% | 86% | 60% |

Ordinary street scenes: 3 of 686 held-out street crops were mistaken for tree of heaven. A live scan of 56 Mapillary photos in Reading, PA, which was not used in training, flagged none.

**Street scanning is experimental.** In a check of Mapillary photos taken within ~30 m of 17 confirmed iNaturalist tree-of-heaven sightings, the model flagged none of them. Looking at the crops by eye, the tree is usually too small, too far away, or hidden to identify at street-photo resolution. An earlier version of the model "found" these trees, but it also flagged nearly every street scene, because iNaturalist photos of *Ailanthus* are so often taken beside buildings. Adding the street-scene class fixed the false alarms.

The way to make street scanning useful is a set of street-level crops that people have confirmed contain the tree. The *It is* / *It isn't* buttons and the GeoJSON export are there to collect them. The quantized model agrees with the full-precision model on 98% of photos.

### Retrain it

```sh
cd training
python -m venv .venv && . .venv/bin/activate
pip install torch open_clip_torch onnx onnxruntime onnxscript pillow scikit-learn
python fetch_data.py data        # ~3,500 iNaturalist photos
MAPILLARY_TOKEN='MLY|...' python fetch_streets.py data   # street scenes without the tree
python train.py data ../model    # prints held-out accuracy, writes toh.onnx + toh.json
```

The *It is* / *It isn't* buttons and the GeoJSON export give you labelled Street View examples. Adding those to the training set is the best way to improve street scanning.

## Files

```
index.html          page
css/style.css       styles
js/app.js           map, scanning UI, photo check, "Found one?" tab
js/config.js        Mapillary client token (optional)
js/geo.js           grid and distance helpers
js/sources/         one module per photo source (mapillary.js, google.js)
js/model.js         talks to the worker
js/worker.js        ONNX Runtime inference and preprocessing
model/              classifier (toh.onnx) and its class list (toh.json)
training/           scripts that build the model
```

## State reporting contacts

`js/report-contacts.js` lists, for each state, the agency, its email or phone number, and whether it asks for reports of the tree itself (Minnesota, Wisconsin) or only of spotted lanternfly. A tree-only report is addressed to a lanternfly inbox only when the person ticks "I saw spotted lanternflies". Only contacts traced to an official or extension source are included. Every other state falls back to EDDMapS and the federal list of state contacts. Inboxes change, so re-check the file each season.

## Credits

Base map © OpenStreetMap contributors. Place search by Nominatim. Sightings and training photos from iNaturalist contributors. Street photos from Mapillary contributors (CC BY-SA 4.0) or Google. BioCLIP by the Imageomics Institute.

© Twin Kites LLC, [twinkites.com](https://twinkites.com)

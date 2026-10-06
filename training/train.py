"""Train a tree-of-heaven classifier head on frozen BioCLIP image embeddings and
export image -> class probabilities as one int8 ONNX model for the browser.

Usage: python train.py data/ ../model/
"""
import csv, json, os, sys
import numpy as np
import torch, open_clip
from PIL import Image, ImageFilter
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import classification_report, confusion_matrix

MEAN = (0.48145466, 0.4578275, 0.40821073)
STD = (0.26862954, 0.26130258, 0.27577711)
SIZE = 224


def to_tensor(img):
    """Same steps the browser runs: shortest side -> 224, center crop, normalize."""
    w, h = img.size
    s = SIZE / min(w, h)
    img = img.resize((max(SIZE, round(w * s)), max(SIZE, round(h * s))), Image.BILINEAR)
    w, h = img.size
    l, t = (w - SIZE) // 2, (h - SIZE) // 2
    x = np.asarray(img.crop((l, t, l + SIZE, t + SIZE)), dtype=np.float32) / 255
    x = (x - MEAN) / STD
    return torch.from_numpy(x.transpose(2, 0, 1).astype(np.float32))


def street_like(img):
    """Fake the look of a tree seen from the road: low resolution and soft."""
    w, h = img.size
    small = img.resize((max(1, w // 4), max(1, h // 4)), Image.BILINEAR)
    return small.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.6))


class Classifier(torch.nn.Module):
    def __init__(self, visual, head):
        super().__init__()
        self.visual, self.head = visual, head

    def forward(self, pixels):
        e = self.visual(pixels)
        e = e / e.norm(dim=-1, keepdim=True)
        return torch.softmax(self.head(e), dim=-1)


def main(data, out):
    model, _, _ = open_clip.create_model_and_transforms('hf-hub:imageomics/bioclip')
    model.eval()
    rows = list(csv.DictReader(open(os.path.join(data, 'manifest.csv'))))
    classes = sorted({r['class'] for r in rows}, key=lambda c: (c != 'toh', c))
    y = np.array([classes.index(r['class']) for r in rows])
    groups = np.array([r['user'] for r in rows])

    cache = os.path.join(data, 'embeddings.npz')
    if os.path.exists(cache):
        z = np.load(cache)
        X, Xs = z['X'], z['Xs']
    else:
        X, Xs = [], []
        with torch.no_grad():
            for i in range(0, len(rows), 32):
                imgs = [Image.open(r['path']).convert('RGB') for r in rows[i:i + 32]]
                for target, variant in ((X, lambda im: im), (Xs, street_like)):
                    e = model.encode_image(torch.stack([to_tensor(variant(im)) for im in imgs]))
                    target.append((e / e.norm(dim=-1, keepdim=True)).numpy())
                print(f'embedded {i + len(imgs)}/{len(rows)}', flush=True)
        X, Xs = np.concatenate(X), np.concatenate(Xs)
        np.savez(cache, X=X, Xs=Xs)

    # Hold out whole observers so the test set measures new photographers.
    tr, te = next(GroupShuffleSplit(1, test_size=0.2, random_state=0).split(X, y, groups))
    fit = lambda idx: LogisticRegression(C=10, max_iter=5000, class_weight='balanced').fit(
        np.concatenate([X[idx], Xs[idx]]), np.concatenate([y[idx], y[idx]]))
    clf = fit(tr)
    for name, XX in (('clear photos', X), ('degraded "street" photos', Xs)):
        pred = clf.predict(XX[te])
        print(f'\n== held-out {name} ==')
        print(classification_report(y[te], pred, target_names=classes, digits=3))
        p_toh = clf.predict_proba(XX[te])[:, 0]
        for th in (0.5, 0.7, 0.9):
            hit = p_toh >= th
            prec = (y[te][hit] == 0).mean() if hit.any() else float('nan')
            rec = hit[y[te] == 0].mean()
            print(f'ToH threshold {th}: precision {prec:.3f} recall {rec:.3f}')
    print(confusion_matrix(y[te], clf.predict(X[te])))

    # Refit on everything for the shipped model.
    clf = fit(np.arange(len(y)))
    head = torch.nn.Linear(X.shape[1], len(classes))
    head.weight.data = torch.tensor(clf.coef_, dtype=torch.float32)
    head.bias.data = torch.tensor(clf.intercept_, dtype=torch.float32)
    net = Classifier(model.visual, head).eval()

    os.makedirs(out, exist_ok=True)
    fp32 = os.path.join(out, 'toh-fp32.onnx')
    torch.onnx.export(net, torch.zeros(1, 3, SIZE, SIZE), fp32, input_names=['pixels'],
                      output_names=['probs'], dynamic_axes={'pixels': {0: 'n'}, 'probs': {0: 'n'}},
                      opset_version=17, dynamo=False)
    from onnxruntime.quantization import quantize_dynamic, QuantType
    # Signed per-channel weights: ~98% top-1 agreement with fp32, versus ~85% for the uint8 default.
    quantize_dynamic(fp32, os.path.join(out, 'toh.onnx'), weight_type=QuantType.QInt8, per_channel=True)
    os.remove(fp32)
    json.dump({'classes': classes, 'size': SIZE, 'mean': MEAN, 'std': STD,
               'backbone': 'imageomics/bioclip (MIT)', 'train_images': int(len(y))},
              open(os.path.join(out, 'toh.json'), 'w'), indent=2)
    print('wrote', out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

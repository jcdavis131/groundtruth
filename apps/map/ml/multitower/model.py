"""Multi-tower multitask network, pure NumPy (no torch install needed).

Architecture:
    per-domain tower:  x_domain -> ReLU MLP -> z_domain      (domain encoder)
    shared trunk:      concat(z) -> ReLU MLP -> h             (shared representation)
    task heads:        h -> Linear -> task output             (one head per task)

Tasks: regression (standardized MSE), binary classification (BCE w/ logits),
count (MSE on log1p-standardized target). Multitask loss = sum of
per-task losses weighted by tasks.json weights.
"""
import numpy as np


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -30, 30)))


class MLP:
    def __init__(self, dims, rng, final_relu=True):
        self.dims = dims
        self.final_relu = final_relu
        self.W, self.b = [], []
        for d_in, d_out in zip(dims[:-1], dims[1:]):
            self.W.append(rng.normal(0.0, np.sqrt(2.0 / d_in),
                                     (d_in, d_out)).astype(np.float64))
            self.b.append(np.zeros(d_out))

    def params(self):
        out = []
        for i, (W, b) in enumerate(zip(self.W, self.b)):
            out += [(f"W{i}", W), (f"b{i}", b)]
        return out

    def forward(self, x):
        self._xs, self._zs = [x], []
        a = x
        for i, (W, b) in enumerate(zip(self.W, self.b)):
            z = a @ W + b
            self._zs.append(z)
            last = i == len(self.W) - 1
            a = np.maximum(z, 0) if (not last or self.final_relu) else z
            self._xs.append(a)
        return a

    def backward(self, dout):
        grads = {}
        n_layers = len(self.W)
        for i in reversed(range(n_layers)):
            z = self._zs[i]
            last = i == n_layers - 1
            if not last or self.final_relu:
                dout = dout * (z > 0)
            x = self._xs[i]
            grads[f"W{i}"] = x.T @ dout
            grads[f"b{i}"] = dout.sum(axis=0)
            dout = dout @ self.W[i].T
        return dout, grads


class Linear:
    def __init__(self, d_in, d_out, rng):
        self.W = rng.normal(0.0, np.sqrt(1.0 / d_in),
                            (d_in, d_out)).astype(np.float64)
        self.b = np.zeros(d_out)

    def params(self):
        return [("W", self.W), ("b", self.b)]

    def forward(self, x):
        self._x = x
        return x @ self.W + self.b

    def backward(self, dout):
        grads = {"W": self._x.T @ dout, "b": dout.sum(axis=0)}
        return dout @ self.W.T, grads


class Adam:
    def __init__(self, params, lr=1e-3, wd=1e-4, b1=0.9, b2=0.999, eps=1e-8):
        self.lr, self.wd = lr, wd
        self.b1, self.b2, self.eps = b1, b2, eps
        self.state = {id(p): {"m": np.zeros_like(p), "v": np.zeros_like(p),
                              "t": 0} for _, p in params}
        self.params = params

    def step(self, grads):
        for name, p in self.params:
            g = grads[name] + self.wd * p
            s = self.state[id(p)]
            s["t"] += 1
            s["m"] = self.b1 * s["m"] + (1 - self.b1) * g
            s["v"] = self.b2 * s["v"] + (1 - self.b2) * g * g
            mhat = s["m"] / (1 - self.b1 ** s["t"])
            vhat = s["v"] / (1 - self.b2 ** s["t"])
            p -= self.lr * mhat / (np.sqrt(vhat) + self.eps)


class MultiTower:
    def __init__(self, tower_dims: dict, tower_h=32, trunk_h=64,
                 tasks=("gas_fwd7",), seed=7):
        self.tower_names = list(tower_dims)
        rng = np.random.default_rng(seed)
        self.towers = {n: MLP([d, tower_h, tower_h], rng)
                       for n, d in tower_dims.items()}
        self.trunk = MLP([tower_h * len(tower_dims), trunk_h, trunk_h], rng)
        self.heads = {t: Linear(trunk_h, 1, rng) for t in tasks}

    def _all_params(self, prefix=""):
        out = []
        mods = [("tw", self.towers), ("tr", {"trunk": self.trunk}),
                ("hd", self.heads)]
        for tag, d in mods:
            for name, mod in d.items():
                for pn, p in mod.params():
                    out.append((f"{tag}.{name}.{pn}", p))
        return out

    def forward(self, xs: dict):
        zs = [self.towers[n].forward(xs[n]) for n in self.tower_names]
        h = self.trunk.forward(np.concatenate(zs, axis=1))
        return {t: head.forward(h).ravel() for t, head in self.heads.items()}

    def backward(self, douts: dict):
        dh = None
        grads = {}
        for t, head in self.heads.items():
            d, g = head.backward(douts[t][:, None])
            dh = d if dh is None else dh + d
            grads.update({f"hd.{t}.{k}": v for k, v in g.items()})
        dz, g = self.trunk.backward(dh)
        grads.update({f"tr.trunk.{k}": v for k, v in g.items()})
        parts = np.split(dz, len(self.tower_names), axis=1)
        for n, part in zip(self.tower_names, parts):
            _, g = self.towers[n].backward(part)
            grads.update({f"tw.{n}.{k}": v for k, v in g.items()})
        return grads

    def save(self, path):
        np.savez(path, **{n: p for n, p in self._all_params()})

    def load(self, path):
        z = np.load(path)
        for n, p in self._all_params():
            p[...] = z[n]

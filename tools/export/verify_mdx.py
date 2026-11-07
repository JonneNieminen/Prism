"""Dev-only: reference MDX-Net demix (UVR algorithm, torch STFT + ONNX Runtime)
to check Prism's Rust `mdx-net` adapter for parity.

uv run python verify_mdx.py MODEL.onnx MIX.wav OUT.wav --n-fft 6144 --overlap 0.5 --compensate 1.022
"""
import argparse

import numpy as np
import onnxruntime as ort
import soundfile as sf
import torch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("mix")
    ap.add_argument("out")
    ap.add_argument("--n-fft", type=int, required=True)
    ap.add_argument("--hop", type=int, default=1024)
    ap.add_argument("--dim-f", type=int, default=3072)
    ap.add_argument("--dim-t", type=int, default=256)
    ap.add_argument("--overlap", type=float, default=0.5)
    ap.add_argument("--compensate", type=float, default=1.0)
    a = ap.parse_args()

    sess = ort.InferenceSession(a.model, providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name
    window = torch.hann_window(a.n_fft, periodic=True)
    n_bins = a.n_fft // 2 + 1
    chunk = a.hop * (a.dim_t - 1)
    trim = a.n_fft // 2
    gen = chunk - 2 * trim

    def stft(x):  # [2, chunk] -> [1, 4, dim_f, dim_t]
        z = torch.stft(x, a.n_fft, a.hop, window=window, center=True, return_complex=True)
        z = torch.view_as_real(z).permute(0, 3, 1, 2).reshape(1, 4, n_bins, -1)
        return z[:, :, : a.dim_f]

    def istft(z):  # [1, 4, dim_f, dim_t] -> [2, chunk]
        pad = torch.zeros(1, 4, n_bins - a.dim_f, z.shape[-1])
        z = torch.cat([z, pad], 2).reshape(2, 2, n_bins, -1).permute(0, 2, 3, 1)
        z = torch.complex(z[..., 0].contiguous(), z[..., 1].contiguous())
        return torch.istft(z, a.n_fft, a.hop, window=window, center=True)

    mix, sr = sf.read(a.mix, dtype="float32", always_2d=True)
    mix = mix.T
    n = mix.shape[1]
    pad = gen + trim - (n % gen)
    mixture = np.concatenate([np.zeros((2, trim), np.float32), mix, np.zeros((2, pad), np.float32)], 1)
    total = mixture.shape[1]
    step = int((1 - a.overlap) * chunk)
    result = np.zeros((2, total), np.float32)
    divider = np.zeros((2, total), np.float32)
    for i in range(0, total, step):
        end = min(i + chunk, total)
        actual = end - i
        win = np.tile(np.hanning(actual)[None], (2, 1)).astype(np.float32)
        part = mixture[:, i:end]
        if actual < chunk:
            part = np.concatenate([part, np.zeros((2, chunk - actual), np.float32)], 1)
        spek = stft(torch.from_numpy(part))
        spek[:, :, :3, :] *= 0
        pred = sess.run(None, {name: spek.numpy()})[0]
        wave = istft(torch.from_numpy(pred)).numpy()
        result[:, i:end] += wave[:, :actual] * win
        divider[:, i:end] += win
    out = (result / np.maximum(divider, 1e-8))[:, trim : trim + n] * a.compensate
    sf.write(a.out, out.T, sr, subtype="FLOAT")
    print("wrote", a.out, out.shape)


if __name__ == "__main__":
    main()

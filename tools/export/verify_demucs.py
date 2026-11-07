"""Dev-only: check the exported ONNX against stock PyTorch Demucs on real audio.

Writes reference stems (PyTorch, shifts=0) so the Rust pipeline can be checked
for parity:  uv run python verify_demucs.py SONG.mp3 --seconds 30 --refdir DIR
"""
import argparse
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

from export_demucs import cac_spec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("song")
    ap.add_argument("--name", default="htdemucs")
    ap.add_argument("--seconds", type=float, default=30)
    ap.add_argument("--refdir", default="out/ref")
    args = ap.parse_args()

    torch.backends.mha.set_fastpath_enabled(False)
    bag = get_model(args.name)
    m = bag.models[0].eval()
    wav, sr = sf.read(args.song, dtype="float32", always_2d=True)
    assert sr == 44100, sr
    wav = torch.from_numpy(wav[: int(args.seconds * sr)].T.copy())
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    refdir = Path(args.refdir)
    refdir.mkdir(parents=True, exist_ok=True)
    sf.write(refdir / "mix.wav", wav.T.numpy(), sr, subtype="FLOAT")

    # one chunk: torch vs onnx
    L = int(m.segment * m.samplerate)
    chunk = torch.zeros(1, 2, L)
    n = min(L, wav.shape[-1])
    chunk[..., :n] = wav[:, :n]
    sess = ort.InferenceSession(f"out/{args.name}/{args.name}.onnx",
                                providers=["CPUExecutionProvider"])
    with torch.no_grad():
        ref = m(chunk)
        mag = cac_spec(m, chunk)
    freq, time = sess.run(None, {"mix": chunk.numpy(), "spec": mag.numpy()})
    z = m._mask(None, torch.from_numpy(freq))
    out = torch.from_numpy(time) + m._ispec(z, L)
    err = (out - ref).abs().max().item()
    rel = ((out - ref).pow(2).mean() / ref.pow(2).mean()).sqrt().item()
    print(f"chunk  max abs err {err:.2e}  rel rms err {rel:.2e}")

    # full reference (whole-track normalisation as in demucs.separate)
    ref_ch = wav.mean(0)
    w = (wav - ref_ch.mean()) / ref_ch.std()
    with torch.no_grad():
        stems = apply_model(bag, w[None], shifts=0, split=True, overlap=0.25)[0]
    stems = stems * ref_ch.std() + ref_ch.mean()
    for name, s in zip(bag.sources, stems):
        sf.write(refdir / f"{name}.wav", s.T.numpy(), sr, subtype="FLOAT")
    print("reference stems written to", refdir)


if __name__ == "__main__":
    main()

"""Dev-only: export pinned HTDemucs checkpoints to ONNX for Prism.

The STFT / iSTFT and the final "time + freq" sum are NOT in the graph (they
don't export cleanly); Prism does them in Rust (crates/prism-core/src/dsp).

Graph contract (fixed segment length L = int(segment * 44100)):
  inputs : mix  f32[1, 2, L]           time-domain chunk (already zero padded)
           spec f32[1, 4, 2048, T]     complex-as-channels STFT of `mix`
                                       (ch0.re, ch0.im, ch1.re, ch1.im)
  outputs: freq f32[1, S, 4, 2048, T]  freq-branch spectrogram (same layout)
           time f32[1, S, 2, L]        time-branch waveform
  stem = time + istft(freq)

Usage:  uv run python export_demucs.py htdemucs [--out DIR]
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import torch
from demucs.htdemucs import HTDemucs
from demucs.pretrained import get_model
from einops import rearrange


class Core(torch.nn.Module):
    """HTDemucs.forward from the magnitude onwards, minus _mask/_ispec."""

    def __init__(self, m: HTDemucs):
        super().__init__()
        self.m = m

    def forward(self, mix, mag):
        m = self.m
        x = mag
        B, C, Fq, T = x.shape
        mean = x.mean(dim=(1, 2, 3), keepdim=True)
        std = x.std(dim=(1, 2, 3), keepdim=True)
        x = (x - mean) / (1e-5 + std)
        xt = mix
        meant = xt.mean(dim=(1, 2), keepdim=True)
        stdt = xt.std(dim=(1, 2), keepdim=True)
        xt = (xt - meant) / (1e-5 + stdt)

        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1])
                tenc = m.tencoder[idx]
                xt = tenc(xt)
                if not tenc.empty:
                    saved_t.append(xt)
                else:
                    inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                emb = m.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                x = x + m.freq_emb_scale * emb
            saved.append(x)

        if m.crosstransformer:
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = rearrange(x, "b c f t-> b c (f t)")
                x = m.channel_upsampler(x)
                x = rearrange(x, "b c (f t)-> b c f t", f=f)
                xt = m.channel_upsampler_t(xt)
            x, xt = m.crosstransformer(x, xt)
            if m.bottom_channels:
                x = rearrange(x, "b c f t-> b c (f t)")
                x = m.channel_downsampler(x)
                x = rearrange(x, "b c (f t)-> b c f t", f=f)
                xt = m.channel_downsampler_t(xt)

        for idx, decode in enumerate(m.decoder):
            skip = saved.pop(-1)
            x, pre = decode(x, skip, lengths.pop(-1))
            offset = m.depth - len(m.tdecoder)
            if idx >= offset:
                tdec = m.tdecoder[idx - offset]
                length_t = lengths_t.pop(-1)
                if tdec.empty:
                    pre = pre[:, :, 0]
                    xt, _ = tdec(pre, None, length_t)
                else:
                    skip = saved_t.pop(-1)
                    xt, _ = tdec(xt, skip, length_t)

        S = len(m.sources)
        x = x.view(B, S, -1, Fq, T)
        x = x * std[:, None] + mean[:, None]
        xt = xt.view(B, S, -1, mix.shape[-1])
        xt = xt * stdt[:, None] + meant[:, None]
        return x, xt


def cac_spec(m: HTDemucs, mix):
    z = m._spec(mix)
    return m._magnitude(z)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    # MHA "fast path" emits aten::_native_multi_head_attention, which has no ONNX symbolic.
    torch.backends.mha.set_fastpath_enabled(False)
    ap = argparse.ArgumentParser()
    ap.add_argument("name", help="htdemucs | htdemucs_6s | htdemucs_ft")
    ap.add_argument("--out", default="out")
    args = ap.parse_args()
    out = Path(args.out) / args.name
    out.mkdir(parents=True, exist_ok=True)

    bag = get_model(args.name)
    models = list(bag.models)
    files = []
    for i, sub in enumerate(models):
        assert isinstance(sub, HTDemucs), type(sub)
        sub.eval()
        L = int(sub.segment * sub.samplerate)
        mix = torch.randn(1, 2, L) * 0.1
        mag = cac_spec(sub, mix)
        core = Core(sub).eval()
        fname = f"{args.name}.onnx" if len(models) == 1 else f"{args.name}_{i}.onnx"
        path = out / fname
        with torch.no_grad():
            ref_full = sub(mix)
            x, xt = core(mix, mag)
            # sanity: reassembling in torch must equal the stock forward
            zout = sub._mask(None, x)
            re = xt + sub._ispec(zout, L)
            err = (re - ref_full).abs().max().item()
            print(f"[{fname}] torch reassembly max err {err:.2e}")
            assert err < 1e-4
            torch.onnx.export(
                core, (mix, mag), str(path),
                input_names=["mix", "spec"], output_names=["freq", "time"],
                opset_version=17, do_constant_folding=True,
            )
        files.append({"file": fname, "sha256": sha256(path),
                      "bytes": path.stat().st_size,
                      "stemWeights": [list(map(float, w)) for w in bag.weights][i]
                      if len(models) > 1 else None})
        print(f"[{fname}] {path.stat().st_size / 1e6:.1f} MB")

    info = {"name": args.name, "sources": list(bag.sources),
            "sampleRate": models[0].samplerate, "segmentSamples": L,
            "segmentSeconds": float(models[0].segment),
            "nfft": models[0].nfft, "hop": models[0].hop_length, "files": files}
    (out / "export.json").write_text(json.dumps(info, indent=2))
    print(json.dumps(info, indent=2))


if __name__ == "__main__":
    main()

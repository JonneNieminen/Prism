"""Regenerate catalog/index.json (the default model catalog).
python3 scripts/make-catalog.py  — hashes/sizes come from tools/export/out and the
pinned values below. Demucs variants are re-hosted on this repo's `models-v1`
release (MIT); UVR MDX-Net models link to the official UVR model repository; BS-RoFormer-SW
links to its ONNX export on Hugging Face (no licence published, flagged non-commercial)."""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
REL = "https://github.com/JonneNieminen/Prism/releases/download/models-v1/"
UVR = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/"
DEMUCS_Q = {"fast": {"shifts": 0, "overlap": 0.1}, "balanced": {"shifts": 1, "overlap": 0.25}, "best": {"shifts": 3, "overlap": 0.25}}
MDX_Q = {"fast": {"shifts": 0, "overlap": 0.25}, "balanced": {"shifts": 0, "overlap": 0.5}, "best": {"shifts": 0, "overlap": 0.75}}
STEM = {
    "drums": ("Drums", "#FFB020"), "bass": ("Bass", "#7C5CFF"), "other": ("Other", "#A3E635"),
    "vocals": ("Vocals", "#FF5D8F"), "guitar": ("Guitar", "#2DD4BF"), "piano": ("Piano", "#5AB0FF"),
}

def stems(ids):
    return [{"id": i, "label": STEM[i][0], "color": STEM[i][1]} for i in ids]

def demucs(name, title, desc, hints):
    exp = json.loads((ROOT / f"tools/export/out/{name}/export.json").read_text())
    files = exp["files"]
    base = {
        "schemaVersion": 1, "id": name, "name": title, "version": "4.0.1", "architecture": "demucs",
        "sampleRate": 44100, "channels": 2, "stems": stems(exp["sources"]), "chunkSeconds": 7.8, "overlap": 0.25,
        "license": "MIT", "licenseUrl": "https://github.com/facebookresearch/demucs/blob/main/LICENSE",
        "author": "Meta AI", "description": desc, "homepage": "https://github.com/facebookresearch/demucs",
        "hints": hints, "quality": DEMUCS_Q,
        "params": {"segmentSamples": exp["segmentSamples"], "nfft": 4096, "hop": 1024},
    }
    if len(files) == 1:
        base["weights"], base["sha256"] = files[0]["file"], files[0]["sha256"]
    else:
        base["weights"] = [{"file": f["file"], "sha256": f["sha256"], "stemWeights": f["stemWeights"]} for f in files]
    return {"manifest": base, "files": [{"file": f["file"], "url": REL + f["file"], "bytes": f["bytes"]} for f in files]}

def mdx(id_, title, file, sha, size, n_fft, comp, primary, desc):
    other = "instrumental" if primary == "vocals" else "vocals"
    lab = {"vocals": ("Vocals", "#FF5D8F"), "instrumental": ("Instrumental", "#5AB0FF")}
    st = [{"id": primary, "label": lab[primary][0], "color": lab[primary][1]},
          {"id": other, "label": lab[other][0], "color": lab[other][1], "source": "residual"}]
    return {"manifest": {
        "schemaVersion": 1, "id": id_, "name": title, "architecture": "mdx-net", "weights": file, "sha256": sha,
        "sampleRate": 44100, "channels": 2, "stems": st, "chunkSeconds": 5.92, "overlap": 0.5,
        "license": "MIT (Ultimate Vocal Remover)",
        "licenseUrl": "https://github.com/Anjok07/ultimatevocalremovergui/blob/master/LICENSE",
        "author": "UVR team (Anjok07, aufr33)", "description": desc,
        "homepage": "https://github.com/Anjok07/ultimatevocalremovergui",
        "hints": {"speed": 4, "quality": 4}, "quality": MDX_Q,
        "params": {"nFft": n_fft, "hop": 1024, "dimF": 3072, "dimT": 256, "compensate": comp},
    }, "files": [{"file": file, "url": UVR + file, "bytes": size}]}

RF_Q = {"fast": {"shifts": 0, "overlap": 0.15}, "balanced": {"shifts": 0, "overlap": 0.25}, "best": {"shifts": 0, "overlap": 0.5}}

def bs_roformer_sw():
    """BS-RoFormer-SW (6 stems), the ONNX export by elicwhite. Linked, never re-hosted: the weights
    carry no published licence (community checkpoint), so the entry is flagged non-commercial."""
    return {"manifest": {
        "schemaVersion": 1, "id": "bs-roformer-sw", "name": "BS-RoFormer · 6 stems (SW)", "version": "1.0",
        "architecture": "bs-roformer", "weights": "bs_roformer_sw_6stem_fp16.onnx",
        "sha256": "d3d2bac77a7023282cb5f35a5807179e34076b60589867b572275f1a8ec36444",
        "sampleRate": 44100, "channels": 2, "stems": stems(["bass", "drums", "other", "vocals", "guitar", "piano"]),
        "chunkSeconds": 4.0, "overlap": 0.25,
        "license": "No licence published (community checkpoint)",
        "licenseUrl": "https://github.com/ZFTurbo/Music-Source-Separation-Training/issues/248",
        "nonCommercial": True, "cpuOnly": True, "author": "Unknown (community checkpoint)",
        "description": "The cleanest guitar available, plus piano, vocals, drums and bass. Large: runs on the CPU only, at about half real-time speed. The weights have no published licence, so treat the output as non-commercial.",
        "homepage": "https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx",
        "hints": {"speed": 1, "quality": 5}, "quality": RF_Q,
        "params": {"nFft": 2048, "hop": 512, "chunkSamples": 176400},
    }, "files": [{"file": "bs_roformer_sw_6stem_fp16.onnx",
                  "url": "https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/main/bs_roformer_sw_6stem_fp16.onnx",
                  "bytes": 352778874}]}

catalog = {"schemaVersion": 1, "models": [
    demucs("htdemucs_6s", "Demucs v4 · 6 stems", "Adds guitar and piano. Piano separation is still experimental.", {"speed": 3, "quality": 3}),
    demucs("htdemucs_ft", "Demucs v4 · fine-tuned", "Four specialised models, one per stem. Cleanest Demucs results, about 4× slower.", {"speed": 1, "quality": 5}),
    bs_roformer_sw(),
    mdx("uvr-mdx-voc-ft", "MDX-Net · Vocals FT", "UVR-MDX-NET-Voc_FT.onnx",
        "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111", 66762490, 7680, 1.021, "vocals",
        "Two stems: very clean vocals, and everything else as the instrumental."),
    mdx("uvr-mdx-inst-hq3", "MDX-Net · Instrumental HQ 3", "UVR-MDX-NET-Inst_HQ_3.onnx",
        "317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc", 66759214, 6144, 1.022, "instrumental",
        "Two stems tuned for a clean instrumental (karaoke) track."),
]}
(ROOT / "catalog/index.json").write_text(json.dumps(catalog, indent=2) + "\n")
print("wrote catalog/index.json with", len(catalog["models"]), "models")

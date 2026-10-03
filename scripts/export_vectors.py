"""Rebuild data/provider_vectors.json from the SQLite providers table.
Uses the same model and e5 'passage:' prefix as the original build_index.py.
Run: pip install sentence-transformers numpy && python scripts/export_vectors.py
"""
import json
import sqlite3
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).resolve().parent.parent
MODEL = "intfloat/multilingual-e5-base"

conn = sqlite3.connect(ROOT / "data" / "healtrip.db")
conn.row_factory = sqlite3.Row
rows = [dict(r) for r in conn.execute("SELECT * FROM providers ORDER BY id")]
if not rows:
    raise SystemExit("No providers found in data/healtrip.db")

model = SentenceTransformer(MODEL)
texts = [f"passage: Type: {r['type']}\nDescription: {r['description']}" for r in rows]
vecs = np.asarray(model.encode(texts, normalize_embeddings=True, convert_to_numpy=True), dtype="float32")

out = {
    "model": MODEL,
    "dim": int(vecs.shape[1]),
    "items": [{"id": r["id"], "vector": [round(float(x), 6) for x in v]} for r, v in zip(rows, vecs)],
}
(ROOT / "data" / "provider_vectors.json").write_text(json.dumps(out), encoding="utf-8")
print(f"Exported {len(rows)} providers, {vecs.shape[1]} dims")

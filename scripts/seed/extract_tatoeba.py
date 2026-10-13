# Tatoeba 독일어-한국어 문장 쌍을 뽑아 data/tatoeba_de_ko.json 으로 저장한다 (일회성).
# 입력: <폴더>/tatoeba_deu_sentences.tsv.bz2, tatoeba_kor_sentences.tsv.bz2, tatoeba_deu_kor_links.tsv.bz2
# 사용: python -I -X utf8 scripts/seed/extract_tatoeba.py <폴더>
import sys, bz2, json, pathlib

src = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parent / "data" / "tatoeba_de_ko.json"
MAX_DE = 70

def rows(name):
    with bz2.open(src / name, "rt", encoding="utf-8") as f:
        for line in f:
            yield line.rstrip("\n").split("\t")

links = {}  # de_id -> ko_id (첫 연결만)
for de_id, ko_id in rows("tatoeba_deu_kor_links.tsv.bz2"):
    links.setdefault(de_id, ko_id)
ko = {r[0]: r[2] for r in rows("tatoeba_kor_sentences.tsv.bz2") if len(r) == 3}

pairs = []
for r in rows("tatoeba_deu_sentences.tsv.bz2"):
    if len(r) != 3 or r[0] not in links:
        continue
    de = r[2].strip()
    k = ko.get(links[r[0]])
    if k and len(de) <= MAX_DE:
        pairs.append({"de_id": int(r[0]), "de": de, "ko": k.strip()})

pairs.sort(key=lambda p: (len(p["de"]), p["de_id"]))  # 짧은 문장 먼저 → 학습용으로 쉬운 것부터
out.write_text(json.dumps(pairs, ensure_ascii=False), encoding="utf-8")
print("links", len(links), "ko", len(ko), "pairs", len(pairs), "->", out)

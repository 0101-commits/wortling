# WordHoard zip 에서 독일어 CSV 한 장만 꺼낸다 (일회성).
# 사용: python -I -X utf8 scripts/seed/extract_wordhoard.py <wordhoard_csv.zip 경로>
import sys, zipfile, pathlib

zip_path = sys.argv[1]
out_dir = pathlib.Path(__file__).resolve().parent / "data"
with zipfile.ZipFile(zip_path) as z:
    data = z.read("wordhoard-de.csv")
(out_dir / "wordhoard-de.csv").write_bytes(data)
print("wrote", out_dir / "wordhoard-de.csv", len(data), "bytes")

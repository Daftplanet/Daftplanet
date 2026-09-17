#!/usr/bin/env python3
"""Copy the design-bible data files into the prototype so the browser can fetch them.

game/data/ is canonical. docs/riftborn/data/ is a build output: GitHub Pages serves
docs/ as the site root, so the prototype cannot reach outside it.

    python3 game/tools/sync_prototype_data.py           # sync
    python3 game/tools/sync_prototype_data.py --check   # fail if out of date (CI-friendly)
"""
import filecmp
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "game" / "data"
DST = ROOT / "docs" / "riftborn" / "data"
FILES = ["elements.json", "sizes.json", "weapons.json", "ammo.json", "monsters.json"]


def main() -> int:
    check = "--check" in sys.argv
    DST.mkdir(parents=True, exist_ok=True)
    stale = []

    for name in FILES:
        src, dst = SRC / name, DST / name
        if not src.exists():
            print(f"missing source: {src}", file=sys.stderr)
            return 2
        if not dst.exists() or not filecmp.cmp(src, dst, shallow=False):
            stale.append(name)
            if not check:
                shutil.copy2(src, dst)

    if check:
        if stale:
            print("prototype data is stale: " + ", ".join(stale), file=sys.stderr)
            print("run: python3 game/tools/sync_prototype_data.py", file=sys.stderr)
            return 1
        print(f"prototype data up to date ({len(FILES)} files)")
        return 0

    print(f"synced {len(stale) or 'no'} file(s) to docs/riftborn/data/"
          + (": " + ", ".join(stale) if stale else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

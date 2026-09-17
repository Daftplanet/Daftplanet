#!/usr/bin/env python3
"""Stamp the service worker's cache version from a hash of the files it caches.

A hand-maintained version is the classic PWA failure: someone forgets to bump it,
every returning player is pinned to a stale build, and there is no way to tell from
the outside. Deriving it from the content makes that impossible.

    python3 game/tools/stamp_sw.py           # stamp
    python3 game/tools/stamp_sw.py --check   # fail if the stamp is stale (CI-friendly)
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SW = ROOT / "docs" / "riftborn" / "sw.js"
APP = SW.parent


def shell_paths(source: str) -> list[str]:
    block = re.search(r"const SHELL = \[(.*?)\];", source, re.S)
    if not block:
        raise SystemExit("could not find the SHELL list in sw.js")
    return re.findall(r"'([^']+)'", block.group(1))


def compute(source: str) -> str:
    digest = hashlib.sha256()
    for rel in sorted(shell_paths(source)):
        if rel in ("./",):          # the directory alias resolves to index.html
            continue
        path = APP / rel
        if not path.exists():
            raise SystemExit(f"sw.js precaches a file that does not exist: {rel}")
        digest.update(rel.encode())
        digest.update(path.read_bytes())
    # The worker's own logic is part of what needs invalidating.
    digest.update(re.sub(r"const VERSION = '[^']*';", "", source).encode())
    return digest.hexdigest()[:12]


def main() -> int:
    source = SW.read_text()
    version = compute(source)
    current = re.search(r"const VERSION = '([^']*)';", source).group(1)

    if "--check" in sys.argv:
        if current != version:
            print(f"service worker stamp is stale: {current} != {version}", file=sys.stderr)
            print("run: python3 game/tools/stamp_sw.py", file=sys.stderr)
            return 1
        print(f"service worker stamp up to date ({version})")
        return 0

    if current == version:
        print(f"service worker already stamped ({version})")
        return 0

    SW.write_text(re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", source, count=1))
    print(f"stamped service worker {current} -> {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/bin/bash
# Assemble the single-file site: dist/index.html (+ vercel.json for hosting)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
( cd src; cat 00-head.html 10-body.html; for f in $(ls [2-8]*.js | sort); do echo "/* ---- $f ---- */"; cat "$f"; done; cat 99-tail.html ) > dist/index.html
cp site/vercel.json dist/vercel.json
echo "built dist/index.html ($(wc -c < dist/index.html) bytes)"

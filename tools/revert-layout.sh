#!/bin/sh
# Restore the classic layout. See docs/layout-classic/README.md.
set -e
cd "$(dirname "$0")/.."
cp docs/layout-classic/index.html      src/index.html
cp docs/layout-classic/app.css         src/styles/app.css
cp docs/layout-classic/cardbrowser.js  src/editor/cardbrowser.js
echo "Classic layout restored. The dev server will hot-reload."

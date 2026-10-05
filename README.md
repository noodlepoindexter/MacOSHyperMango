# HyperMango

A HyperCard-style drawing and scripting studio for macOS.

## Download

**[⬇ Download HyperMango for Mac (.dmg)](https://github.com/noodlepoindexter/MacOSHyperMango/releases/latest/download/HyperMango.dmg)**

Universal build — runs on Apple Silicon and Intel Macs (macOS 10.15 or later).

### Installing

1. Open `HyperMango.dmg`.
2. Drag **HyperMango** onto the **Applications** folder.
3. Launch HyperMango from Applications.

The app isn't notarized by Apple yet, so the first launch of a downloaded copy
is blocked. To allow it, go to **System Settings → Privacy & Security** and click
**Open Anyway**, or run this once in Terminal:

```sh
xattr -cr /Applications/HyperMango.app
```

## Building from source

Requires Node.js and Rust.

```sh
npm install
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

The DMG is written to
`src-tauri/target/universal-apple-darwin/release/bundle/dmg/`.

For development, run `npm run tauri dev`.

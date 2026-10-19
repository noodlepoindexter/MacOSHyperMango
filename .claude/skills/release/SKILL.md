---
name: release
description: Build, sign, notarize and publish a HyperMango macOS release, and how Google Drive OAuth credentials get into the build. Use when asked to make a release/DMG, sign or notarize the app, fix notarization or Gatekeeper errors, or set up or debug Google Drive sign-in credentials.
---

# HyperMango release: signing, notarization, Google Drive credentials

## One command

```
tools/release.sh                # build universal app, sign, notarize, staple, verify
tools/release.sh --no-notarize  # signed only (local testing)
```

Output: `src-tauri/target/universal-apple-darwin/release/bundle/dmg/HyperMango_<version>_universal.dmg`.
The README download link expects the GitHub release asset to be named **`HyperMango.dmg`** — rename on upload.

The script checks the notary credentials *before* the long build, then after building
it verifies the Google client ID is in the binary, `codesign --verify --deep --strict`,
notarizes the DMG, staples it, and runs `spctl`.

## Google Drive OAuth credentials

- `src-tauri/src/drive.rs` reads `HYPERMANGO_GOOGLE_CLIENT_ID` and
  `HYPERMANGO_GOOGLE_CLIENT_SECRET` with `option_env!` — **at compile time**.
  A build without them still runs, but Drive save errors with
  "Google Drive isn't configured in this build". Cargo rebuilds when they change.
- They live in **`.env.release`** at the repo root: gitignored, mode 600,
  plain `KEY=value` lines. `tools/release.sh` loads it. Never commit it, never
  print its values, and don't ask the user to paste secrets into chat — have
  them edit the file.
- Dev mode with Drive working: `set -a; . ./.env.release; set +a; npm run tauri dev`.
  Plain `npm run tauri dev` builds without Drive.
- Google Cloud setup the client must have:
  - OAuth client type **Desktop app** (sign-in uses the system browser and a
    loopback redirect `http://127.0.0.1:<random port>` with PKCE).
  - **Google Drive API** enabled in the project.
  - Scope `drive.file` only (app-created files; non-sensitive scope).
  - If the OAuth consent screen is in **Testing**, every Google account that
    signs in must be listed as a test user.
- The refresh token is stored in the macOS keychain; access tokens are memory-only.
- The client ID ends up in the binary as plain text; the script greps for it.
  A Desktop-app "secret" isn't truly secret per Google, but it still stays out of git.

## Code signing

- Identity: `Developer ID Application: Matthew Poindexter (G69LKPSSKQ)`
  (team **G69LKPSSKQ**). The script sets `APPLE_SIGNING_IDENTITY`; Tauri signs
  the app (Hardened Runtime on) and the DMG.
- The Mac also has an "Apple Development" cert for a *different* team
  (67MFZQGA9W). It isn't for distribution — don't use it for releases.
- Check: `security find-identity -v -p codesigning`.

## Notarization

- Uses a **notarytool keychain profile named `hypermango`** (Apple ID +
  app-specific password, team G69LKPSSKQ). Tauri's built-in notarization is
  deliberately disabled (the script unsets `APPLE_ID`/`APPLE_PASSWORD`/…);
  the script notarizes the finished DMG itself:
  ```
  xcrun notarytool submit <dmg> --keychain-profile hypermango --wait
  xcrun stapler staple <dmg>
  spctl -a -t open --context context:primary-signature -v <dmg>
  ```
- Quick credential check: `xcrun notarytool history --keychain-profile hypermango`.
- **HTTP 401 "Invalid credentials"** = the app-specific password was revoked
  (happens when the Apple ID password changes, or it was deleted). Fix: the user
  creates a new one at account.apple.com → Sign-In and Security → App-Specific
  Passwords, then runs **in their own Terminal** (it prompts for the password,
  so it can't run from Claude's shell):
  ```
  xcrun notarytool store-credentials hypermango --apple-id <their Apple ID> --team-id G69LKPSSKQ
  ```
  The Apple ID must be the one that belongs to team G69LKPSSKQ, and the
  password must be generated under that same Apple ID.
- Fallback if Apple ID auth keeps failing: an App Store Connect API key
  (Developer role) stored under the same profile name:
  `xcrun notarytool store-credentials hypermango --key AuthKey_X.p8 --key-id … --issuer …`.
- If the DMG is already built and signed, just notarize it — no rebuild needed.
- Verify the app inside: `hdiutil attach -nobrowse -readonly <dmg>`, then
  `spctl -a -t exec -vv /Volumes/HyperMango/HyperMango.app`, then detach.

## Handling credentials (for Claude)

- Don't dump the keychain or print secret values; check whether env vars are
  *set*, not what they contain.
- The repo is **public**: no secrets, Apple ID emails, or passwords in committed files.

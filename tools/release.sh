#!/bin/sh
# Build a signed, notarized universal release with Google Drive credentials
# baked in. Secrets come from .env.release (gitignored); notarization uses a
# notarytool keychain profile (default "hypermango"), created once with:
#   xcrun notarytool store-credentials hypermango \
#     --apple-id <apple id> --team-id G69LKPSSKQ
# Pass --no-notarize to build signed only.
set -e
cd "$(dirname "$0")/.."

NOTARIZE=1
[ "$1" = "--no-notarize" ] && NOTARIZE=0

if [ ! -f .env.release ]; then
  echo "Missing .env.release — create it with HYPERMANGO_GOOGLE_CLIENT_ID and _SECRET." >&2
  exit 1
fi
set -a
. ./.env.release
set +a

if [ -z "$HYPERMANGO_GOOGLE_CLIENT_ID" ] || [ -z "$HYPERMANGO_GOOGLE_CLIENT_SECRET" ]; then
  echo "Fill in HYPERMANGO_GOOGLE_CLIENT_ID and HYPERMANGO_GOOGLE_CLIENT_SECRET in .env.release." >&2
  exit 1
fi
case "$HYPERMANGO_GOOGLE_CLIENT_ID" in
  *.apps.googleusercontent.com) ;;
  *) echo "HYPERMANGO_GOOGLE_CLIENT_ID doesn't look like an OAuth client ID (…apps.googleusercontent.com)." >&2
     exit 1 ;;
esac

NOTARY_PROFILE="${NOTARY_PROFILE:-hypermango}"
# Check the notary credentials before the long build, not after it.
if [ "$NOTARIZE" = 1 ] && ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null; then
  echo "Notary profile \"$NOTARY_PROFILE\" doesn't work — re-run store-credentials (see top of this script)." >&2
  exit 1
fi

# Keep Tauri's own notarization off; we notarize the finished DMG below.
unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: Matthew Poindexter (G69LKPSSKQ)}"
echo "Signing as: $APPLE_SIGNING_IDENTITY"

npm run tauri build -- --target universal-apple-darwin

BUNDLE=src-tauri/target/universal-apple-darwin/release/bundle
APP="$BUNDLE/macos/HyperMango.app"
DMG=$(ls -t "$BUNDLE"/dmg/*.dmg | head -1)

# The client ID is compiled in by option_env!; make sure it actually landed.
if ! grep -q "$HYPERMANGO_GOOGLE_CLIENT_ID" "$APP/Contents/MacOS/"*; then
  echo "Google client ID not found in the built binary — Drive save won't work." >&2
  exit 1
fi
codesign --verify --deep --strict "$APP"

if [ "$NOTARIZE" = 1 ]; then
  echo "Notarizing $DMG (usually a few minutes)…"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  spctl -a -t open --context context:primary-signature -v "$DMG"
fi

echo
echo "Built and verified: $DMG"

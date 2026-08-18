#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
app="$root/apps/geolibre-desktop"
out=${1:-geolibre-field-survey-arm64-small.apk}
[[ $out = /* ]] || out="$root/$out"
bt=$(printf '%s\n' "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
unsigned="$app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
aligned=$(mktemp --suffix=.apk)
trap 'rm -f "$aligned"' EXIT

cd "$app"
env -u CC -u CFLAGS -u CXXFLAGS -u CPPFLAGS -u LDFLAGS \
  GEOLIBRE_FIELD_SURVEY_ONLY=1 \
  RUSTFLAGS='-C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,-z,common-page-size=16384' \
  npx tauri android build --apk --target aarch64

"$bt/zipalign" -P 16 -f 4 "$unsigned" "$aligned"
"$bt/apksigner" sign --ks "$HOME/.android/debug.keystore" \
  --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android \
  --out "$out" "$aligned"
"$bt/zipalign" -c -P 16 4 "$out"
"$bt/apksigner" verify "$out"
[[ $(unzip -Z1 "$out" 'lib/*/*.so' | cut -d/ -f2 | sort -u) = arm64-v8a ]]

ls -lh "$out"
sha256sum "$out"

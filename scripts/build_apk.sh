#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "用法：bash scripts/build_apk.sh [输出 APK 路径]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN="$ROOT/project/app/src/main"
BUILD="${BUILD_DIR:-$ROOT/build}"
SIGNED="${1:-$BUILD/shike-android-2.0.0.apk}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
BUILD_TOOLS_VERSION="${ANDROID_BUILD_TOOLS_VERSION:-35.0.0}"
BT="${ANDROID_BUILD_TOOLS_DIR:-${ANDROID_SDK_ROOT}/build-tools/${BUILD_TOOLS_VERSION}}"
PLATFORM_NAME="${ANDROID_PLATFORM:-android-35}"
PLATFORM="${ANDROID_PLATFORM_JAR:-${ANDROID_SDK_ROOT}/platforms/${PLATFORM_NAME}/android.jar}"
KEYSTORE="${SHIKE_KEYSTORE:-$ROOT/keystore/shike-fixed.jks}"
PASS_FILE="${SHIKE_KEYSTORE_PASS_FILE:-$ROOT/keystore/keystore.pass}"

if [[ -z "$ANDROID_SDK_ROOT" ]]; then
  echo "请先设置 ANDROID_SDK_ROOT（或 ANDROID_HOME）。" >&2
  exit 1
fi
for tool in aapt aapt2 d8 zipalign apksigner; do
  if [[ ! -x "$BT/$tool" ]]; then
    echo "缺少 Android 构建工具：$BT/$tool" >&2
    exit 1
  fi
done
if [[ ! -f "$PLATFORM" ]]; then
  echo "缺少 Android 平台文件：$PLATFORM" >&2
  exit 1
fi
for tool in javac keytool zip unzip node python3; do
  command -v "$tool" >/dev/null || { echo "缺少命令：$tool" >&2; exit 1; }
done
case "$BUILD" in
  ""|"/"|"$ROOT")
    echo "拒绝清空不安全的构建目录：$BUILD" >&2
    exit 1
    ;;
esac

mkdir -p "$(dirname "$SIGNED")"

# A newly generated key cannot cover-upgrade an APK signed by another key.
if [[ ! -f "$KEYSTORE" && "${SHIKE_GENERATE_KEYSTORE:-0}" == "1" && -z "${SHIKE_KS_PASS:-}" && ! -f "$PASS_FILE" ]]; then
  mkdir -p "$(dirname "$PASS_FILE")"
  SHIKE_KS_PASS="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  printf '%s' "$SHIKE_KS_PASS" > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
fi
if [[ -z "${SHIKE_KS_PASS:-}" ]]; then
  if [[ -f "$PASS_FILE" ]]; then
    SHIKE_KS_PASS="$(tr -d '[:space:]' < "$PASS_FILE")"
  else
    echo "请设置 SHIKE_KS_PASS，或用 SHIKE_KEYSTORE_PASS_FILE 指定密码文件。" >&2
    exit 1
  fi
fi
if [[ -z "${SHIKE_KS_PASS:-}" ]]; then
  echo "签名密码不能为空。" >&2
  exit 1
fi
export SHIKE_KS_PASS
if [[ ! -f "$KEYSTORE" ]]; then
  if [[ "${SHIKE_GENERATE_KEYSTORE:-0}" != "1" ]]; then
    echo "签名文件不存在：$KEYSTORE" >&2
    echo "请用 SHIKE_KEYSTORE 指定现有签名；全新本地构建可设置 SHIKE_GENERATE_KEYSTORE=1。" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -noprompt \
    -keystore "$KEYSTORE" \
    -storepass:env SHIKE_KS_PASS -keypass:env SHIKE_KS_PASS \
    -alias shikefixed -keyalg RSA -keysize 3072 -validity 10000 \
    -dname "CN=Shike Local Source Build, OU=Personal Build, O=Shike, C=CN"
  echo "已生成新的本地签名：$KEYSTORE"
  echo "注意：新签名不能覆盖升级此前用其他证书签名的 APK。"
fi

rm -rf "$BUILD"
mkdir -p "$BUILD"/{compiled,gen,classes,dex,jscheck}
HTML="$MAIN/assets/index.html" JSCHECK="$BUILD/jscheck" python3 - <<'PY'
from pathlib import Path
import os
import re
html = Path(os.environ['HTML']).read_text(encoding='utf-8')
for token in [
    'window.SHIKE_NATIVE_ANDROID = Boolean(window.ShikeAndroid)', 'window.__shikeBootOK = true',
    'app.shike.diet.fixed', '食刻 Android 2.0.0', 'ShikeAndroid.saveTextFile'
]:
    assert token in html, token
scripts = re.findall(r'<script[^>]*>(.*?)</script>', html, re.S | re.I)
assert len(scripts) == 4, len(scripts)
out = Path(os.environ['JSCHECK'])
for index, script in enumerate(scripts):
    (out / f'script-{index}.js').write_text(script, encoding='utf-8')
print('HTML and four inline scripts verified; HTML bytes:', len(html.encode('utf-8')))
PY
for script in "$BUILD"/jscheck/*.js; do node --check "$script"; done

"$BT/aapt2" compile --dir "$MAIN/res" -o "$BUILD/compiled/resources.zip"
"$BT/aapt2" link \
  -o "$BUILD/unsigned.apk" \
  -I "$PLATFORM" \
  --manifest "$MAIN/AndroidManifest.xml" \
  --java "$BUILD/gen" \
  --min-sdk-version 29 \
  --target-sdk-version 35 \
  --version-code 6 \
  --version-name 2.0.0 \
  "$BUILD/compiled/resources.zip"

mapfile -t SOURCES < <(find "$MAIN/java" "$BUILD/gen" -name '*.java' -type f | sort)
javac --release 17 -encoding UTF-8 -classpath "$PLATFORM" -d "$BUILD/classes" "${SOURCES[@]}"
mapfile -t CLASSES < <(find "$BUILD/classes" -name '*.class' -type f | sort)
"$BT/d8" --release --min-api 29 --lib "$PLATFORM" --output "$BUILD/dex" "${CLASSES[@]}"
test -s "$BUILD/dex/classes.dex"

zip -q -j "$BUILD/unsigned.apk" "$BUILD/dex/classes.dex"
(cd "$MAIN" && zip -q -r "$BUILD/unsigned.apk" assets)
"$BT/zipalign" -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
"$BT/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-pass env:SHIKE_KS_PASS --key-pass env:SHIKE_KS_PASS \
  --ks-key-alias shikefixed \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$SIGNED" "$BUILD/aligned.apk"

"$BT/apksigner" verify --verbose --print-certs --min-sdk-version 29 "$SIGNED" | tee "$BUILD/signature.txt"
"$BT/zipalign" -c -p 4 "$SIGNED"
"$BT/aapt" dump badging "$SIGNED" > "$BUILD/badging.txt"
"$BT/aapt" dump permissions "$SIGNED" > "$BUILD/permissions.txt"
unzip -t "$SIGNED" > "$BUILD/ziptest.txt"
cat "$BUILD/badging.txt"
cat "$BUILD/permissions.txt"
tail -2 "$BUILD/ziptest.txt"
printf '\n构建完成：%s\n' "$SIGNED"

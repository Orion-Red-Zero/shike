#!/usr/bin/env python3
"""Compare every web asset in an APK with this source tree (stdlib only)."""
from pathlib import Path
from zipfile import ZipFile
import argparse
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / 'project/app/src/main/assets'


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def main():
    parser = argparse.ArgumentParser(description='核对 APK 内的 assets 是否与食刻源码逐字节一致')
    parser.add_argument('apk', help='要检查的 APK 路径')
    parser.add_argument('--output', help='可选：将 JSON 报告写入此路径')
    args = parser.parse_args()
    apk = Path(args.apk).resolve()
    if not apk.is_file():
        raise SystemExit(f'APK 不存在：{apk}')
    source_files = sorted(path for path in ASSET_ROOT.rglob('*') if path.is_file())
    expected = {
        'assets/' + path.relative_to(ASSET_ROOT).as_posix(): path
        for path in source_files
    }
    mismatches = []
    files = []
    with ZipFile(apk) as archive:
        corrupt = archive.testzip()
        names = set(archive.namelist())
        for entry, source in expected.items():
            source_bytes = source.read_bytes()
            packaged_bytes = archive.read(entry) if entry in names else None
            match = packaged_bytes == source_bytes
            if not match:
                mismatches.append(entry)
            files.append({
                'asset': entry,
                'source_sha256': sha256_bytes(source_bytes),
                'apk_sha256': sha256_bytes(packaged_bytes) if packaged_bytes is not None else None,
                'match': match,
            })
        packaged_assets = {
            name for name in names
            if name.startswith('assets/') and not name.endswith('/')
        }
        extra = sorted(packaged_assets - set(expected))
        has_dex = 'classes.dex' in names
    report = {
        'status': 'PASS' if not corrupt and not mismatches and not extra and has_dex else 'FAIL',
        'apk': str(apk),
        'apk_sha256': sha256_bytes(apk.read_bytes()),
        'zip_crc': 'PASS' if corrupt is None else f'FAIL: {corrupt}',
        'classes_dex_present': has_dex,
        'source_asset_count': len(expected),
        'missing_or_mismatched_assets': mismatches,
        'unexpected_extra_assets': extra,
        'files': files,
    }
    encoded = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(encoded, encoding='utf-8')
    print(encoded, end='')
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())

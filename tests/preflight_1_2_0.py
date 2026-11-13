from pathlib import Path
from html.parser import HTMLParser
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
HTML_PATH = ROOT / 'project/app/src/main/assets/index.html'
OLD_PATH = ROOT / 'tests/baselines/index-1.1.0.html'
html = HTML_PATH.read_text(encoding='utf-8')
old = OLD_PATH.read_text(encoding='utf-8')


class Audit(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.icons = []
        self.opens = []
        self.closes = []
        self.screens = []
        self.meals = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        for key, destination in [
            ('id', self.ids), ('data-icon', self.icons),
            ('data-open', self.opens), ('data-close', self.closes),
            ('data-screen', self.screens), ('data-meal', self.meals)
        ]:
            if values.get(key):
                destination.append(values[key])


page = Audit()
page.feed(html)
duplicates = sorted({value for value in page.ids if page.ids.count(value) > 1})
assert not duplicates, duplicates
assert not set(page.opens) - set(page.ids), set(page.opens) - set(page.ids)
assert not set(page.closes) - set(page.ids), set(page.closes) - set(page.ids)
assert set(page.screens) == {'today', 'add', 'trend', 'me'}, page.screens
assert set(page.meals) == {'早餐', '午餐', '晚餐', '加餐'}, page.meals
for target in [
    'dlg-library', 'dlg-custom', 'dlg-usda', 'open-food-library',
    'quick-new-food', 'me-food-library', 'photo-results', 'library-list',
    'c-aliases', 'c-portion-unit', 'c-portion-grams'
]:
    assert target in page.ids, target
# These controls are rendered by JavaScript only after recognition results exist.
for token in [
    'id="photo-add-all"', 'data-photo-add="${i}"', 'data-photo-usda="${i}"',
    'else if (e.target.closest("#photo-add-all"))'
]:
    assert token in html, token


def scripts(source):
    return [value for value in re.findall(r'<script[^>]*>([\s\S]*?)</script>', source) if value.strip()]


new_scripts = scripts(html)
old_scripts = scripts(old)
assert len(new_scripts) == len(old_scripts) == 4
assert new_scripts[0] == old_scripts[0], 'early bootstrap changed'
assert new_scripts[1] == old_scripts[1], 'USDA/local food data changed'
icon_pattern = r'const ICONS = (\{[\s\S]*?\});'
node_eval = "const fs=require('fs'),vm=require('vm');process.stdout.write(JSON.stringify(vm.runInNewContext('('+fs.readFileSync(0,'utf8')+')')));"
new_icons = json.loads(subprocess.check_output(
    ['node', '-e', node_eval], input=re.search(icon_pattern, html).group(1), text=True))
old_icons = json.loads(subprocess.check_output(
    ['node', '-e', node_eval], input=re.search(icon_pattern, old).group(1), text=True))
assert new_icons == old_icons, 'icon map changed'
references = set(page.icons)
references.update(re.findall(r'icon\("([a-z0-9-]+)"\)', html))
references.update(re.findall(r'icon:\s*"([a-z0-9-]+)"', html))
missing_icons = sorted(references - set(new_icons))
assert not missing_icons, missing_icons
for token in [
    '食刻 Android 1.2.0', '食刻 1.2.0 · 每日饮食能量账本',
    'shike-food-energy-ledger-v1', 'bowl: isSavedFood(food) ? ["bowl"] : []',
    'function openLibrary()', 'async function preparePhoto(file)',
    'function normalizeRecognitionItem', 'function renderPhotoResults',
    'function photoAudit'
]:
    assert token in html, token
manifest = (ROOT / 'project/app/src/main/AndroidManifest.xml').read_text(encoding='utf-8')
assert 'android:versionCode="4"' in manifest
assert 'android:versionName="1.2.0"' in manifest
assert 'shike-v1.2.0' in (ROOT / 'project/app/src/main/assets/sw.js').read_text(encoding='utf-8')
subprocess.run(['bash', '-n', str(ROOT / 'scripts/build_apk.sh')], check=True)
report = {
    'status': 'PASS',
    'dom_ids': len(page.ids),
    'duplicate_ids': duplicates,
    'navigation': page.screens,
    'meals': page.meals,
    'dialog_open_targets': len(page.opens),
    'dialog_close_targets': len(page.closes),
    'dynamic_photo_controls': ['photo-add-all', 'data-photo-add', 'data-photo-usda'],
    'icons': len(new_icons),
    'missing_icons': missing_icons,
    'food_data_unchanged_from_1_1_0': True,
    'early_bootstrap_unchanged': True,
    'build_script_bash_syntax': 'PASS'
}
out = ROOT / 'tests/output/preflight-1.2.0.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))

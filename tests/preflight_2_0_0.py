#!/usr/bin/env python3
"""食刻 2.0.0 单文件、兼容性、隐私与打包前静态检查。"""
from pathlib import Path
from html.parser import HTMLParser
from collections import Counter
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "project/app/src/main"
INDEX = MAIN / "assets/index.html"
BASELINE = ROOT / "tests/fixtures/shike-1.2.0/index.html"
checks = []
def check(name, condition, detail=""):
    checks.append({"name": name, "pass": bool(condition), "detail": str(detail)})
    if not condition:
        print(f"FAIL {name}: {detail}", file=sys.stderr)

class Audit(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=[]; self.opens=[]; self.closes=[]; self.screens=[]; self.scripts=[]; self.external=[]; self._script=False; self._buf=[]
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if "id" in attrs: self.ids.append(attrs["id"])
        if "data-open" in attrs: self.opens.append(attrs["data-open"])
        if "data-close" in attrs: self.closes.append(attrs["data-close"])
        if tag=="section" and "screen" in attrs.get("class","").split(): self.screens.append(attrs.get("id"))
        if tag=="script":
            self._script=True; self._buf=[]
            if attrs.get("src"): self.external.append(attrs["src"])
    def handle_endtag(self, tag):
        if tag=="script" and self._script:
            self.scripts.append("".join(self._buf)); self._script=False
    def handle_data(self, data):
        if self._script: self._buf.append(data)

html=INDEX.read_text(encoding="utf-8")
a=Audit(); a.feed(html)
duplicates=[k for k,v in Counter(a.ids).items() if v>1]
check("DOM IDs unique", not duplicates, duplicates)
check("four original screens retained", a.screens==["screen-today","screen-add","screen-trend","screen-me"], a.screens)
check("all dialog open targets exist", set(a.opens)<=set(a.ids), sorted(set(a.opens)-set(a.ids)))
check("all dialog close targets exist", set(a.closes)<=set(a.ids), sorted(set(a.closes)-set(a.ids)))
required=["record-diet-panel","record-workout-panel","record-body-panel","goal-rings","today-workouts","today-week-summary","trend-diet-panel","trend-workout-panel","trend-body-panel","dlg-fitness","dlg-nutrition","dlg-weekly","workout-form","body-form","fitness-form","nutrition-form","import-file","export-workouts","export-body"]
check("2.0.0 mount points complete", all(x in a.ids for x in required), [x for x in required if x not in a.ids])
check("four inline scripts and no script dependency", len(a.scripts)==4 and not a.external, {"scripts":len(a.scripts),"external":a.external})
check("original storage key retained", 'const STORAGE_KEY = "shike-food-energy-ledger-v1"' in html)
check("schema 2 migration before final startup render", html.index("state.data = migrateData130(state.data)") < html.index("initFitness130();") < html.rindex('goScreen("today");'))
check("new fields survive loadData", "return {\n      ...p,\n      entries,\n      customFoods," in html)
for token in ["FITNESS_SCHEMA_VERSION = 2", "function estimateEnergy130", "function workoutVolume130", "function movingAverageDetail130", "function weeklySummary130", "function parseImport130", "function buildWorkoutCSV130", "function buildBodyCSV130", "不抵扣饮食热量", "Mifflin–St Jeor"]:
    check(f"feature token: {token}", token in html)
check("no server/login dependency added", "initFitness130" in html and "No account" not in html, "offline core; existing optional USDA/recognition code retained")
check("no secrets in HTML", not re.search(r"SHIKE_KS_PASS\s*=\s*['\"][^'\"]+|BEGIN (?:RSA )?PRIVATE KEY|AIza[0-9A-Za-z_-]{20,}", html))
manifest=(MAIN/"AndroidManifest.xml").read_text(encoding="utf-8")
check("package unchanged", 'package="app.shike.diet.fixed"' in manifest)
check("Android version 6 / 2.0.0", 'android:versionCode="6"' in manifest and 'android:versionName="2.0.0"' in manifest)
check("no contacts/SMS/location permissions", not re.search(r"android.permission.(?:READ_CONTACTS|SEND_SMS|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION)",manifest))
pwa=json.loads((MAIN/"assets/manifest.json").read_text(encoding="utf-8"))
check("PWA identity 2.0.0", pwa.get("version")=="2.0.0" and pwa.get("name")=="食刻 · 饮食与健身目标", pwa)
sw=(MAIN/"assets/sw.js").read_text(encoding="utf-8")
check("PWA cache version 2.0.0", "shike-v2.0.0" in sw)
build=(ROOT/"scripts/build_apk.sh").read_text(encoding="utf-8")
check("build output/version updated", "shike-android-2.0.0.apk" in build and "--version-code 6" in build and "--version-name 2.0.0" in build)
check("keystore excluded from source", not list(ROOT.glob("keystore/*")))

if BASELINE.exists():
    old=BASELINE.read_text(encoding="utf-8")
    olda=Audit(); olda.feed(old)
    check("bundled USDA food dataset byte-identical", olda.scripts[1]==a.scripts[1], f"{len(a.scripts[1])} chars")
    check("bundled Lucide icon script byte-identical", olda.scripts[2]==a.scripts[2], f"{len(a.scripts[2])} chars")
    old_java=BASELINE.with_name("MainActivity.java")
    new_java=MAIN/"java/app/shike/diet/fixed/MainActivity.java"
    expected_java=old_java.read_text(encoding="utf-8").replace('return "食刻 1.2.0\\n"','return "食刻 2.0.0\\n"',1)
    check("native Android bridge preserved except 2.0.0 label", expected_java==new_java.read_text(encoding="utf-8"))
    check("legacy FAO conversion factors retained", "4.184" in html and re.search(r"protein:\s*4",html) and re.search(r"fat:\s*9",html) and re.search(r"(?:carb|carbohydrate):\s*4",html))
    old_head=re.search(r'const head = \[(.*?)\];',old,re.S)
    new_head=re.search(r'const head = \[(.*?)\];',html,re.S)
    check("legacy diet CSV header byte-identical", old_head and new_head and old_head.group(1)==new_head.group(1))
    check("old food parser retained", "function parseDescription" in html and old.count("function parseDescription")==html.count("function parseDescription"))
else:
    check("1.2.0 baseline available",False,str(BASELINE))

report={"app":"食刻 Android","version":"2.0.0","scope":"static source/package preflight; not runtime or device evidence","passed":sum(c['pass'] for c in checks),"failed":sum(not c['pass'] for c in checks),"checks":checks}
out=ROOT/"reference/Shike_2.0.0_preflight.json"; out.parent.mkdir(exist_ok=True); out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
for c in checks: print(("PASS " if c["pass"] else "FAIL ")+c["name"]+(f": {c['detail']}" if c["detail"] else ""))
print(f"RESULT {report['passed']} passed / {report['failed']} failed")
sys.exit(1 if report["failed"] else 0)

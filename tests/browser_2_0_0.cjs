const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..");
const ASSETS = path.join(ROOT, "project/app/src/main/assets");
const OUT = path.join(ROOT, "reference");
const SHOTS = path.join(OUT, "browser");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "shike-200-browser-"));
const DOWNLOADS = path.join(TMP, "downloads");
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });
const checks = [], screenshots = [], consoleErrors = [], pageErrors = [], requestFailures = [], requests = [], dialogs = [], downloadFiles = [];
let browser, server, page, baseURL, today, exportedJSON;
let fatal = null;

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
function staticServer() {
  return http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      let file = path.resolve(ASSETS, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!file.startsWith(ASSETS + path.sep)) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
}
async function shot(name) {
  const file = path.join(SHOTS, name);
  await page.waitForFunction(() => {
    const toast = document.querySelector("#toast");
    if (!toast) return true;
    const style = getComputedStyle(toast);
    return style.visibility === "hidden" || Number(style.opacity) === 0;
  }, { timeout: 6000 }).catch(() => {});
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
    if (document.fonts) await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(path.relative(ROOT, file));
}
async function step(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, pass: true, detail: detail || "ok" });
    console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    checks.push({ name, pass: false, error: error.stack || String(error) });
    console.error(`FAIL ${name}:`, error);
    try { await shot("failure.png"); } catch (_) {}
    throw error;
  }
}
async function click(selector) {
  await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  await page.click(selector);
}
async function type(selector, value) {
  await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, String(value));
}
async function waitBoot() {
  await page.waitForFunction(() => window.__shikeBootOK === true && typeof state !== "undefined" && state.data && state.data.schemaVersion === 2, { timeout: 15000 });
}
async function nav(name) { await click(`.tabbar [data-screen="${name}"]`); }
async function snapshotData() {
  return page.evaluate(() => JSON.parse(JSON.stringify({
    entries: state.data.entries, customFoods: state.data.customFoods, settings: state.data.settings,
    goals: state.data.goals, nutritionTargets: state.data.nutritionTargets,
    workouts: state.data.workouts, workoutTemplates: state.data.workoutTemplates, bodyMetrics: state.data.bodyMetrics,
    selectedDate: state.selectedDate, storageKey: STORAGE_KEY, schemaVersion: state.data.schemaVersion,
    raw: JSON.parse(localStorage.getItem(STORAGE_KEY))
  })));
}
async function waitToast(text) {
  await page.waitForFunction(expected => document.querySelector("#toast").textContent.includes(expected), { timeout: 10000 }, text);
}
async function downloadFrom(selector, extension) {
  const cdp = await page.createCDPSession();
  const events = [];
  cdp.on("Browser.downloadWillBegin", event => {
    events.push({ guid: event.guid, suggestedFilename: event.suggestedFilename, state: "inProgress" });
  });
  cdp.on("Browser.downloadProgress", event => {
    const item = events.find(x => x.guid === event.guid);
    if (item) item.state = event.state;
  });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: DOWNLOADS, eventsEnabled: true });
  await click(selector);
  let file, completedEvent = null;
  for (let i = 0; i < 150; i++) {
    const completed = events.find(x => x.state === "completed" && fs.existsSync(path.join(DOWNLOADS, x.guid)));
    if (completed) { completedEvent = completed; file = path.join(DOWNLOADS, completed.guid); break; }
    const canceled = events.find(x => x.state === "canceled");
    if (canceled) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!file) {
    const diagnostic = await page.evaluate(() => ({
      native: window.SHIKE_NATIVE_ANDROID,
      bridge: Boolean(window.ShikeAndroid && typeof window.ShikeAndroid.saveTextFile === "function"),
      toast: document.querySelector("#toast")?.textContent || "",
      screen: document.querySelector(".screen.active")?.id || ""
    }));
    await cdp.detach();
    assert(file, `download ${extension} did not finish: ${JSON.stringify({ events, diagnostic, files: fs.readdirSync(DOWNLOADS) })}`);
  }
  downloadFiles.push({ selector, expectedExtension: extension, suggestedFilename: completedEvent.suggestedFilename, savedName: path.basename(file), bytes: fs.statSync(file).size });
  assert(fs.statSync(file).size > 0, `download ${extension} is empty`);
  await cdp.detach();
  return file;
}
async function uploadWithConfirm(file) {
  const input = await page.$("#import-file");
  page.once("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  await input.uploadFile(file);
}
function storedCount(data) { return `${data.entries.length}/${data.workouts.length}/${data.bodyMetrics.length}/${data.workoutTemplates.length}`; }

(async () => {
  server = staticServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}/index.html`;
  const executablePath = process.env.CHROME_PATH || (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await puppeteer.launch({ executablePath, headless: true, protocolTimeout: 60000, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", error => pageErrors.push(error.stack || String(error)));
  page.on("request", request => requests.push(request.url()));
  page.on("requestfailed", request => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || "failed" }));
  const now = new Date();
  const fixtureDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const legacy = {
    entries: [{ id: "browser-legacy-entry", date: fixtureDate, meal: "早餐", name: "旧燕麦", quantity: 1, unit: "克", grams: 100, kcal: 380, kj: 1589.92, protein: 13, fat: 7, carb: 68, createdAt: `${fixtureDate}T08:00:00.000Z` }],
    customFoods: [{ id: "browser-legacy-food", name: "旧食物", kcal: 100, protein: 1, fat: 2, carb: 3, aliases: [], portions: {} }],
    settings: { dailyTarget: 1800, recognitionEndpoint: "" }
  };
  await page.evaluateOnNewDocument(raw => {
    try { if (!localStorage.getItem("shike-food-energy-ledger-v1")) localStorage.setItem("shike-food-energy-ledger-v1", raw); } catch (_) {}
  }, JSON.stringify(legacy));

  await step("Chromium starts and migrates a real 1.2.0 localStorage value", async () => {
    await page.goto(baseURL, { waitUntil: "networkidle0" });
    await waitBoot();
    const data = await snapshotData(); today = data.selectedDate;
    assert.equal(today, fixtureDate);
    assert.equal(data.storageKey, "shike-food-energy-ledger-v1");
    assert.equal(data.entries[0].id, "browser-legacy-entry");
    assert.equal(data.customFoods[0].id, "browser-legacy-food");
    assert.equal(data.goals.calorieMode, "manual");
    assert.equal(data.schemaVersion, 2);
    assert.equal(data.raw.schemaVersion, undefined);
    assert.equal(data.raw.entries[0].id, "browser-legacy-entry");
    assert.equal(await page.$eval("#goal-rings", el => el.children.length), 3);
    await shot("01-migrated-today.png");
    return `旧饮食与食物库保留，${data.entries.length} 条饮食；内存迁移为 schemaVersion=2，首次保存前不重写原 JSON`;
  });

  await step("fitness goal dialog calculates and saves an explicit estimate", async () => {
    await click("#hero-target-btn");
    await page.waitForFunction(() => document.querySelector("#dlg-fitness").open);
    await page.select("#fitness-goal", "maintain");
    await page.select("#fitness-activity", "sedentary");
    await page.select("#profile-sex", "male");
    await type("#profile-age", 30); await type("#profile-height", 175); await type("#profile-weight", 70);
    await page.select("#fitness-calorie-mode", "auto");
    const estimate = await page.$eval("#fitness-estimate", el => el.textContent);
    assert(estimate.includes("1649") && estimate.includes("1979") && estimate.includes("1980"));
    await shot("02-fitness-goal-dialog.png");
    await click('#fitness-form button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector("#dlg-fitness").open);
    const data = await snapshotData();
    assert.equal(data.goals.bmr, 1649); assert.equal(data.goals.tdee, 1979); assert.equal(data.goals.calorieTarget, 1980);
    assert.equal(data.settings.dailyTarget, 1980); assert.equal(data.raw.goals.calorieTarget, 1980);
    return "男性/30 岁/175 cm/70 kg，BMR 1649、TDEE 1979、维持目标 1980 kcal（公式估算）";
  });

  await step("training/rest nutrition targets save through the real dialog", async () => {
    await nav("me"); await click("#me-nutrition-goals");
    await page.waitForFunction(() => document.querySelector("#dlg-nutrition").open);
    for (const [id, value] of [["nt-training-protein",150],["nt-training-carb",250],["nt-training-fat",60],["nt-rest-protein",120],["nt-rest-carb",200],["nt-rest-fat",50]]) await type(`#${id}`, value);
    await click('#nutrition-form button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector("#dlg-nutrition").open);
    const data = await snapshotData();
    assert.equal(data.nutritionTargets.training.protein, 150); assert.equal(data.nutritionTargets.rest.protein, 120);
    return "训练日 150/250/60 g，休息日 120/200/50 g";
  });

  await step("strength workout and reusable template save by touch-style UI actions", async () => {
    await nav("add"); await click('[data-record-type="workout"]');
    await type("#workout-name", "腿部训练"); await type("#workout-duration", 45);
    await type('[data-ex-field="name"][data-index="0"]', "深蹲");
    await type('[data-ex-field="weightKg"][data-index="0"]', 60);
    await type('[data-ex-field="reps"][data-index="0"]', 10);
    await type('[data-ex-field="sets"][data-index="0"]', 3);
    await type('[data-ex-field="rpe"][data-index="0"]', 8);
    assert((await page.$eval("#draft-volume", el => el.textContent)).includes("1,800"));
    await click("#template-save");
    await page.waitForFunction(() => state.data.workoutTemplates.length === 1);
    await click("#workout-submit");
    await page.waitForFunction(() => state.data.workouts.length === 1);
    const data = await snapshotData();
    assert.equal(data.workouts[0].volumeKg, 1800); assert.equal(data.workouts[0].estimatedKcal, 276);
    assert.equal(data.workoutTemplates[0].exercises[0].name, "深蹲");
    return "深蹲 60×10×3，容量 1800 kg，45 分钟估算 276 kcal，模板 1 个";
  });

  await step("cardio workout saves separately and never deducts food calories", async () => {
    await page.select("#workout-type", "cardio");
    await type("#workout-name", "轻松跑"); await type("#workout-duration", 30); await type("#cardio-distance", 5);
    await click("#workout-submit");
    await page.waitForFunction(() => state.data.workouts.length === 2);
    const data = await snapshotData();
    const cardio = data.workouts.find(w => w.type === "cardio");
    assert.equal(cardio.distanceKm, 5); assert.equal(cardio.estimatedKcal, 294);
    assert.equal(data.entries.length, 1); assert.equal(data.entries[0].kcal, 380);
    return "跑步 30 分钟/5 km，估算 294 kcal；饮食仍为 380 kcal，无抵扣";
  });

  await step("body metrics save and same-day update without duplicate rows", async () => {
    await click('[data-record-type="body"]');
    await type("#body-weight", 70.2); await type("#body-waist", 80);
    await click('#body-form button[type="submit"]');
    await page.waitForFunction(() => state.data.bodyMetrics.length === 1);
    const id = await page.evaluate(() => state.data.bodyMetrics[0].id);
    await type("#body-weight", 70.6); await type("#body-waist", 79.5); await type("#body-fat", 20);
    await click('#body-form button[type="submit"]');
    await page.waitForFunction(() => state.data.bodyMetrics[0].weightKg === 70.6);
    const data = await snapshotData();
    assert.equal(data.bodyMetrics.length, 1); assert.equal(data.bodyMetrics[0].id, id); assert.equal(data.bodyMetrics[0].bodyFatPct, 20);
    return "同日原 ID 更新为 70.6 kg / 79.5 cm / 20%，记录数仍为 1";
  });

  await step("today, workout/body trends and weekly summary render recorded data", async () => {
    await nav("today");
    assert((await page.$eval("#today-goal-summary", el => el.textContent)).includes("训练日"));
    assert.equal(await page.$$eval("#today-workouts .fitness-record", els => els.length), 2);
    assert((await page.$eval("#goal-rings", el => el.textContent)).includes("150"));
    await shot("03-today-with-fitness-data.png");
    await nav("trend"); await click('[data-trend-kind="workout"]');
    const history = await page.$eval("#workout-history", el => el.textContent);
    assert(history.includes("腿部训练") && history.includes("轻松跑"));
    await shot("04-workout-trend.png");
    await click('[data-trend-kind="body"]');
    assert((await page.$eval("#body-stat-average", el => el.textContent)).includes("70.6"));
    await shot("05-body-trend.png");
    await click("#trend-weekly"); await page.waitForFunction(() => document.querySelector("#dlg-weekly").open);
    const weekly = await page.$eval("#weekly-content", el => el.textContent);
    assert(weekly.includes("训练次数") && weekly.includes("75") && weekly.includes("1,800"));
    await shot("06-weekly-summary.png");
    await click('[data-close="dlg-weekly"]');
    return "首页训练日/双训练/150 g 目标、训练与身体趋势、周总结 2 次 75 分钟均可见";
  });

  await step("full JSON and all three CSV exports are real downloaded files", async () => {
    await nav("me");
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });
    exportedJSON = await downloadFrom("#export-json", ".json");
    const payload = JSON.parse(fs.readFileSync(exportedJSON, "utf8"));
    assert.equal(payload.version, "2.0.0"); assert.equal(payload.schemaVersion, 2);
    assert.equal(payload.entries.length, 1); assert.equal(payload.workouts.length, 2);
    assert.equal(payload.workoutTemplates.length, 1); assert.equal(payload.bodyMetrics.length, 1);
    const workoutCSV = fs.readFileSync(await downloadFrom("#export-workouts", ".csv"), "utf8");
    const bodyCSV = fs.readFileSync(await downloadFrom("#export-body", ".csv"), "utf8");
    const dietCSV = fs.readFileSync(await downloadFrom("#export-csv", ".csv"), "utf8");
    assert(workoutCSV.includes("深蹲") && workoutCSV.includes("1800"));
    assert(bodyCSV.includes("70.6") && bodyCSV.includes("79.5"));
    assert(dietCSV.includes("旧燕麦") && dietCSV.split(/\r?\n/)[0].includes("可食部克数"));
    return `JSON/训练 CSV/身体 CSV/旧饮食 CSV 均实际下载；完整备份含 ${storedCount(payload)}（饮食/训练/身体/模板）`;
  });

  await step("invalid import preserves data; legacy and current backups import after confirmation", async () => {
    const before = await snapshotData();
    const bad = path.join(TMP, "bad.json"); fs.writeFileSync(bad, "{");
    let input = await page.$("#import-file"); await input.uploadFile(bad); await waitToast("导入失败");
    assert.equal(storedCount(await snapshotData()), storedCount(before));
    const legacyFile = path.join(TMP, "legacy.json");
    fs.writeFileSync(legacyFile, JSON.stringify({ entries: legacy.entries, customFoods: legacy.customFoods, dailyReferenceTargetKcal: 1900 }));
    await uploadWithConfirm(legacyFile);
    await page.waitForFunction(() => state.data.goals.calorieTarget === 1900 && state.data.workouts.length === 0);
    await uploadWithConfirm(exportedJSON);
    await page.waitForFunction(() => state.data.workouts.length === 2 && state.data.bodyMetrics.length === 1 && state.data.workoutTemplates.length === 1);
    const restored = await snapshotData();
    assert.equal(restored.goals.calorieTarget, 1980); assert.equal(restored.nutritionTargets.training.protein, 150);
    assert(dialogs.length >= 2);
    return "坏 JSON 未覆盖；1.2 JSON 的 1900 kcal 可导入；2.0 完整备份恢复 1/2/1/1 条数据";
  });

  await step("reload persists all data in the original key", async () => {
    await page.reload({ waitUntil: "networkidle0" }); await waitBoot();
    const data = await snapshotData();
    assert.equal(storedCount(data), "1/2/1/1"); assert.equal(data.raw.schemaVersion, 2);
    assert.equal(data.raw.goals.calorieTarget, 1980); assert.equal(data.storageKey, "shike-food-energy-ledger-v1");
    return "重载后饮食/训练/身体/模板 = 1/2/1/1，目标与营养设置仍在原键";
  });

  await step("service-worker offline reload starts the complete app without a server connection", async () => {
    const ready = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then(registration => ({ ready: true, scope: registration.scope })),
      new Promise(resolve => setTimeout(() => resolve({ ready: false }), 15000))
    ]));
    assert(ready.ready, "service worker did not become active within 15 seconds");
    if (!await page.evaluate(() => !!navigator.serviceWorker.controller)) { await page.reload({ waitUntil: "networkidle0" }); await waitBoot(); }
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cacheState = await page.evaluate(async () => {
      const keys = await caches.keys();
      let indexCached = false;
      for (const key of keys) { const cache = await caches.open(key); if (await cache.match("./index.html")) indexCached = true; }
      return { keys, indexCached };
    });
    assert(cacheState.indexCached, `index.html missing from Cache Storage: ${JSON.stringify(cacheState)}`);
    await page.setOfflineMode(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded" }); await waitBoot();
      const data = await snapshotData(); assert.equal(storedCount(data), "1/2/1/1");
      await shot("07-offline-reload.png");
      return `Chromium 离线重载成功，缓存 ${cacheState.keys.join("/")}，数据完整；仅证明 PWA 离线，不替代 Android WebView 验证`;
    } finally { await page.setOfflineMode(false); }
  });

  await step("Android environment detection and native export branch work with a simulated bridge", async () => {
    const nativePage = await browser.newPage();
    nativePage.on("pageerror", error => pageErrors.push(`simulated native page: ${error.stack || error}`));
    try {
      await nativePage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await nativePage.evaluateOnNewDocument(() => {
        window.__nativeExports = [];
        window.ShikeAndroid = { saveTextFile(fileName, mime, content) { window.__nativeExports.push({ fileName, mime, content }); return true; } };
      });
      await nativePage.goto(baseURL, { waitUntil: "networkidle0" });
      await nativePage.waitForFunction(() => window.__shikeBootOK === true);
      const mode = await nativePage.evaluate(() => ({ native: window.SHIKE_NATIVE_ANDROID, installTitle: document.querySelector('[data-open="dlg-install"] .li-text b')?.textContent || "", offline: document.querySelector("#sw-state")?.textContent || "" }));
      assert.equal(mode.native, true); assert.equal(mode.installTitle, "Android 应用信息"); assert.equal(mode.offline, "应用资源已内置，可离线使用");
      await nativePage.click('.tabbar [data-screen="me"]'); await nativePage.click("#export-json");
      await nativePage.waitForFunction(() => window.__nativeExports.length === 1);
      const saved = await nativePage.evaluate(() => window.__nativeExports[0]);
      assert(saved.fileName.endsWith(".json")); assert(saved.mime.startsWith("application/json"));
      const backup = JSON.parse(saved.content);
      assert.equal(backup.entries.length, 1); assert.equal(backup.workouts.length, 2); assert.equal(backup.bodyMetrics.length, 1); assert.equal(backup.workoutTemplates.length, 1);
      return "模拟 ShikeAndroid 注入时识别为 Android，信息页与原生导出分支正确；未宣称真机桥接已验证";
    } finally { await nativePage.close(); }
  });

  await step("320/390 px layouts have no horizontal overflow and new primary taps are at least 44 px", async () => {
    const layout = [];
    for (const width of [320, 390]) {
      await page.setViewport({ width, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      for (const screen of ["today", "add", "trend", "me"]) {
        await nav(screen);
        const size = await page.evaluate(() => {
          const install = document.querySelector("#install-btn");
          const subtitle = document.querySelector("#appbar-sub");
          const installStyle = getComputedStyle(install);
          const subtitleStyle = getComputedStyle(subtitle);
          return {
            viewport: innerWidth,
            content: document.documentElement.scrollWidth,
            installDisplay: installStyle.display,
            installWhiteSpace: installStyle.whiteSpace,
            subtitleHeight: subtitle.getBoundingClientRect().height,
            subtitleLineHeight: parseFloat(subtitleStyle.lineHeight) || 13
          };
        });
        assert(size.content <= size.viewport + 1, `${width}/${screen}: ${JSON.stringify(size)}`);
        if (size.installDisplay !== "none") assert.equal(size.installWhiteSpace, "nowrap", `${width}/${screen}: install label wraps`);
        assert(size.subtitleHeight <= size.subtitleLineHeight * 1.5, `${width}/${screen}: subtitle wraps: ${JSON.stringify(size)}`);
        layout.push({ width, screen, ...size });
      }
    }
    await page.setViewport({ width: 320, height: 740, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await nav("add");
    const targets = await page.$$eval("[data-record-type]", els => els.filter(e => e.getClientRects().length).map(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })));
    assert(targets.every(t => t.width >= 44 && t.height >= 44), JSON.stringify(targets));
    await nav("today"); await shot("07-mobile-320.png");
    return `${layout.length} 个页面/宽度组合无横向溢出；记录类型按钮 ${targets.map(t => Math.round(t.width)+"×"+Math.round(t.height)).join(", ")} px`;
  });

  await step("no runtime exceptions, console errors or external network requests", async () => {
    const external = [...new Set(requests.filter(url => /^https?:/.test(url) && !url.startsWith(new URL(baseURL).origin)))];
    assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(external, []);
    return "0 page exception、0 console error、0 外部请求";
  });
})().catch(error => { fatal = error.stack || String(error); process.exitCode = 1; }).finally(async () => {
  const report = {
    app: "食刻 Android", version: "2.0.0",
    generatedAt: new Date().toISOString(),
    engine: browser ? await browser.version() : "unavailable",
    viewport: "390×844 and 320×740/844, touch-enabled mobile emulation",
    scope: "Real headless Chromium with HTTP localhost, actual DOM clicks/forms/downloads/reload/service worker; not an Android emulator or physical-device test",
    status: !fatal && checks.every(c => c.pass) && !pageErrors.length && !consoleErrors.length ? "PASS" : "FAIL",
    passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length,
    checks, screenshots, consoleErrors, pageErrors, requestFailures,
    externalRequests: [...new Set(requests.filter(url => /^https?:/.test(url) && baseURL && !url.startsWith(new URL(baseURL).origin)))],
    confirmationDialogs: dialogs, downloadFiles,
    downloadEnvironmentNote: "本容器 Chromium 154 对中文 Blob 下载名可能报告为 download；测试按唯一下载标识读取实际完成文件并校验内容，不将此环境行为记为 Android 文件名验证。",
    notRun: ["Android 真机或模拟器启动", "Android WebView 原生桥导出", "相机拍摄与相册权限", "USDA/自定义识别端点真实网络", "旧签名 APK 覆盖升级", "Android 离线首次安装启动"],
    fatal
  };
  fs.writeFileSync(path.join(OUT, "Shike_2.0.0_browser-tests.json"), JSON.stringify(report, null, 2));
  console.log(`BROWSER_RESULT ${report.passed} passed / ${report.failed} failed; ${report.status}`);
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (!fatal) console.log(`BROWSER_REPORT ${path.join(OUT, "Shike_2.0.0_browser-tests.json")}`);
});

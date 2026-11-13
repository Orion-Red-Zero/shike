const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = process.env.SHIKE_HTML_PATH || path.join(root, 'project/app/src/main/assets/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
assert.strictEqual(scripts.length, 4);

const results = [];
function pass(name, details) {
  results.push({ name, status: 'PASS', details });
  console.log('PASS', name, details === undefined ? '' : JSON.stringify(details));
}
function approx(actual, expected, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...xs) { xs.forEach(x => this.values.add(x)); }
  remove(...xs) { xs.forEach(x => this.values.delete(x)); }
  contains(x) { return this.values.has(x); }
  toggle(x, force) {
    if (force === undefined) force = !this.values.has(x);
    if (force) this.values.add(x); else this.values.delete(x);
    return force;
  }
}
const context2d = new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return () => ({ width: 20 });
    if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; }
});
class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.open = false;
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.classList = new FakeClassList();
    this.listeners = {};
    this.nextElementSibling = null;
    this.src = '';
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(k, v) { this[k] = String(v); }
  getAttribute(k) { return this[k]; }
  removeAttribute(k) { delete this[k]; }
  focus() {}
  click() { (this.listeners.click || []).forEach(fn => fn({ target: this, preventDefault() {} })); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  reset() {}
  getContext() { return context2d; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 800 }; }
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  closest() { return null; }
}
class FakeCanvas extends FakeElement {
  constructor() { super(); this.width = 0; this.height = 0; }
  toBlob(cb, type) { cb(new Blob([new Uint8Array(20000)], { type: type || 'image/jpeg' })); }
}
class FakeImage {
  constructor() { this.naturalWidth = 3200; this.naturalHeight = 2400; }
  set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()); }
  get src() { return this._src; }
}
function makeStorage(shared) {
  const map = shared || new Map();
  return {
    map,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); }
  };
}
function createContext(sharedMap) {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) {
      const el = new FakeElement(id);
      el.nextElementSibling = new FakeElement(`${id}-next`);
      elements.set(id, el);
    }
    return elements.get(id);
  };
  const document = {
    getElementById: getElement,
    querySelector(selector) { return selector.startsWith('#') ? getElement(selector.slice(1)) : new FakeElement(); },
    querySelectorAll() { return []; },
    createElement(tag) { return tag === 'canvas' ? new FakeCanvas() : new FakeElement(); },
    documentElement: new FakeElement('html'),
    body: new FakeElement('body')
  };
  const localStorage = makeStorage(sharedMap);
  const context = {
    console,
    document,
    localStorage,
    navigator: { onLine: true, serviceWorker: { controller: null, register: async () => ({}) } },
    location: { protocol: 'file:' },
    URL,
    Blob,
    FormData,
    AbortController,
    Image: FakeImage,
    crypto: require('crypto').webcrypto,
    setTimeout: () => 1,
    clearTimeout: () => {},
    requestAnimationFrame: fn => { fn(); return 1; },
    scrollTo() {},
    addEventListener() {},
    removeEventListener() {},
    confirm: () => Boolean(context.__confirmResult),
    __confirmResult: true,
    __fetchCalls: [],
    __fetchImpl: async () => { throw new Error('fetch fixture not configured'); },
    fetch: (...args) => {
      context.__fetchCalls.push(args);
      return context.__fetchImpl(...args);
    },
    ShikeAndroid: { saveTextFile() { return true; } }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  scripts.forEach((s, i) => vm.runInContext(s, context, { filename: `inline-${i}.js` }));
  return { context, elements, localStorage, run: code => vm.runInContext(code, context) };
}

(async () => {
  const legacyData = {
    entries: [{
      id: 'legacy-entry', date: '2026-11-10', meal: '早餐', foodId: 'legacy-custom', name: '旧燕麦奶',
      grams: 200, kcal: 120, kj: 502.08, protein: 2, fat: 4, carb: 16, fiber: null,
      source: '用户自定义', fdcId: null, portion: '200 g', assumption: '旧记录', originalText: '旧燕麦奶200g',
      confidence: null, inputMode: 'text', createdAt: '2026-11-10T08:00:00.000Z'
    }],
    customFoods: [{
      id: 'legacy-custom', name: '旧燕麦奶', kcal: 60, kj: null, protein: 1, fat: 2, carb: 8,
      fiber: null, aliases: ['燕麦饮品'], portions: { cup: { label: '1 杯', grams: 240 } }, source: '用户自定义'
    }],
    settings: { dailyTarget: 2000, recognitionEndpoint: '', usdaKey: '' }
  };
  const shared = new Map([['shike-food-energy-ledger-v1', JSON.stringify(legacyData)]]);
  const app = createContext(shared);
  const { context, run, elements } = app;

  assert.strictEqual(run('window.__shikeBootOK'), true);
  assert.strictEqual(run('state.data.entries.length'), 1);
  assert.strictEqual(run('state.data.customFoods.length'), 1);
  assert.strictEqual(run('state.data.entries[0].name'), '旧燕麦奶');
  assert.strictEqual(elements.get('quick-custom-count').textContent, '1');
  assert.strictEqual(elements.get('library-count-badge').textContent, '1 个');
  assert.strictEqual(run('matchFood("燕麦饮品").food.id'), 'legacy-custom');
  pass('旧版记录与自定义食物原键加载、别名匹配和计数', { storageKey: 'shike-food-energy-ledger-v1', legacyEntries: 1 });

  const meals = ['早餐', '午餐', '晚餐', '加餐'];
  const dates = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
  for (let i = 0; i < meals.length; i++) {
    run(`state.defaultMeal=${JSON.stringify(meals[i])};state.selectedDate=${JSON.stringify(dates[i])};useLibraryFood('legacy-custom');state.review[0].quantity=240;state.review[0].unit='grams';confirmReview();`);
    assert.strictEqual(run(`state.data.entries[${i + 1}].meal`), meals[i]);
    assert.strictEqual(run(`state.data.entries[${i + 1}].date`), dates[i]);
    approx(run(`state.data.entries[${i + 1}].kcal`), 144);
  }
  assert.strictEqual(run('state.data.entries.length'), 5);
  assert.strictEqual(run('state.review.length'), 0);
  const persistedAfterReuse = JSON.parse(shared.get('shike-food-energy-ledger-v1'));
  assert.strictEqual(persistedAfterReuse.entries.length, 5);
  assert.strictEqual(persistedAfterReuse.entries[0].kcal, 120);
  pass('同一旧自定义食物跨四餐、跨日期直接复用并持久化', { entries: 5, eachNewEntryKcal: 144 });

  run(`openCustom(null,null,true);
    $('#c-name').value='高纤燕麦碗';$('#c-aliases').value='高纤, 早餐碗';$('#c-kcal').value='250';
    $('#c-p').value='';$('#c-f').value='';$('#c-carb').value='';
    $('#c-portion-unit').value='bowl';$('#c-portion-grams').value='180';
    saveCustom({preventDefault(){}});`);
  const newFoodId = run('state.data.customFoods.find(f=>f.name==="高纤燕麦碗").id');
  assert.strictEqual(run('state.review.length'), 0);
  assert.strictEqual(run(`getFood(${JSON.stringify(newFoodId)}).defaultUnit`), 'bowl');
  approx(run(`energyPer100(getFood(${JSON.stringify(newFoodId)})).kcal`), 250);
  approx(run(`energyPer100(getFood(${JSON.stringify(newFoodId)})).kj`), 1046);
  run(`state.libraryQuery='高纤';renderLibrary();`);
  assert.ok(elements.get('library-list').innerHTML.includes('高纤燕麦碗'));
  run(`state.defaultMeal='晚餐';state.selectedDate='2026-11-14';useLibraryFood(${JSON.stringify(newFoodId)});`);
  assert.strictEqual(run('state.review[0].unit'), 'bowl');
  assert.strictEqual(run('state.review[0].quantity'), 1);
  approx(run('reviewCalc(state.review[0]).grams'), 180);
  approx(run('reviewCalc(state.review[0]).kcal'), 450);
  assert.strictEqual(run('reviewCalc(state.review[0]).portionSource'), '我的常用份量');
  run('confirmReview();');
  const customEntryIndex = run('state.data.entries.length-1');
  approx(run(`state.data.entries[${customEntryIndex}].kcal`), 450);
  pass('新建全局食物、别名搜索、常用碗份量与能量/kJ 计算', { grams: 180, kcal: 450, kjPer100g: 1046 });

  run(`openCustom(null,${JSON.stringify(newFoodId)},true);
    $('#c-name').value='高纤燕麦碗·改版';$('#c-aliases').value='高纤, 改版';$('#c-kcal').value='300';
    $('#c-p').value='';$('#c-f').value='';$('#c-carb').value='';
    $('#c-portion-unit').value='bowl';$('#c-portion-grams').value='200';
    saveCustom({preventDefault(){}});`);
  assert.strictEqual(run(`state.data.entries[${customEntryIndex}].name`), '高纤燕麦碗');
  approx(run(`state.data.entries[${customEntryIndex}].kcal`), 450);
  approx(run(`state.data.entries[${customEntryIndex}].grams`), 180);
  run(`state.defaultMeal='早餐';state.selectedDate='2026-11-15';useLibraryFood(${JSON.stringify(newFoodId)});`);
  approx(run('reviewCalc(state.review[0]).grams'), 200);
  approx(run('reviewCalc(state.review[0]).kcal'), 600);
  context.__confirmResult = false;
  run(`deleteLibraryFood(${JSON.stringify(newFoodId)});`);
  assert.strictEqual(run(`Boolean(getFood(${JSON.stringify(newFoodId)}))`), true);
  context.__confirmResult = true;
  const entriesBeforeDelete = run('state.data.entries.length');
  run(`deleteLibraryFood(${JSON.stringify(newFoodId)});`);
  assert.strictEqual(run(`state.data.customFoods.some(f=>f.id===${JSON.stringify(newFoodId)})`), false);
  assert.strictEqual(run('state.data.entries.length'), entriesBeforeDelete);
  assert.strictEqual(run('state.review[0].foodId'), '');
  run('confirmReview();');
  assert.strictEqual(run('state.data.entries.length'), entriesBeforeDelete);
  assert.strictEqual(run(`state.data.entries[${customEntryIndex}].name`), '高纤燕麦碗');
  approx(run(`state.data.entries[${customEntryIndex}].kcal`), 450);
  pass('编辑仅影响后续记录；删除需确认且不改写历史快照', { historicalName: '高纤燕麦碗', historicalKcal: 450 });

  approx(run('resolvePortion(getFood("legacy-custom"),null,"grams").grams'), 100);
  approx(run('resolvePortion(getFood("legacy-custom"),"","grams").grams'), 0);
  approx(run('resolvePortion(getFood("legacy-custom"),-2,"grams").grams'), 0);
  approx(run('resolvePortion(getFood("legacy-custom"),undefined,"grams").grams'), 100);
  pass('清空、无效与负数数量不按 100g 默认入账', { emptyGrams: 0, negativeGrams: 0, omittedParserDefaultGrams: 100 });

  const prepared = await (async () => {
    context.__originalPhoto = new Blob([new Uint8Array(100000)], { type: 'image/png' });
    context.__originalPhoto.name = 'fixture.png';
    return run('preparePhoto(__originalPhoto)');
  })();
  assert.strictEqual(prepared.converted, true);
  assert.strictEqual(prepared.width, 1600);
  assert.strictEqual(prepared.height, 1200);
  assert.strictEqual(prepared.originalBytes, 100000);
  assert.strictEqual(prepared.uploadBytes, 20000);
  assert.strictEqual(prepared.uploadFile.type, 'image/jpeg');
  pass('照片在本机缩放并转码为 JPEG', { source: '3200x2400', output: '1600x1200', originalBytes: 100000, uploadBytes: 20000 });

  run(`state.review=[];state.photoItems=parseRecognitionResponse({items:[{
    name:'米饭',grams:150,gramsMin:120,gramsMax:180,confidence:0.92,weightConfidence:0.42,
    referenceObject:'直径26厘米餐盘',kcal:999999,alternatives:[{name:'炒饭',confidence:0.06}]
  }]});`);
  assert.strictEqual(run('state.photoItems.length'), 1);
  assert.ok(run('Boolean(state.photoItems[0].foodId)'));
  run('renderPhotoResults();');
  const photoHtml = elements.get('photo-results').innerHTML;
  for (const token of ['食物种类置信度', '重量估算置信度', '92%', '42%', '120–180 g', '直径26厘米餐盘', '尚未计入']) {
    assert.ok(photoHtml.includes(token), token);
  }
  run('addPhotoItem(0);');
  assert.strictEqual(run('state.review.length'), 1);
  assert.strictEqual(run('state.review[0].inputMode'), 'photo');
  approx(run('state.review[0].weightConfidence'), 0.42);
  approx(run('state.review[0].weightRange.min'), 120);
  approx(run('state.review[0].weightRange.max'), 180);
  assert.ok(run('photoAudit(state.review[0])').includes('而非由照片直接给出'));
  const expectedPhotoKcal = run('energyFor(getFood(state.review[0].foodId),150).kcal');
  approx(run('reviewCalc(state.review[0]).kcal'), expectedPhotoKcal);
  assert.notStrictEqual(expectedPhotoKcal, 999999);
  const beforePhotoConfirm = run('state.data.entries.length');
  run('confirmReview();');
  assert.strictEqual(run('state.data.entries.length'), beforePhotoConfirm + 1);
  approx(run(`state.data.entries[${beforePhotoConfirm}].kcal`), expectedPhotoKcal);
  approx(run(`state.data.entries[${beforePhotoConfirm}].confidence`), 0.92);
  approx(run(`state.data.entries[${beforePhotoConfirm}].weightConfidence`), 0.42);
  assert.strictEqual(run(`state.data.entries[${beforePhotoConfirm}].referenceObject`), '直径26厘米餐盘');
  pass('模拟识别候选显示双置信度/范围/参考物，热量由本地/USDA 食物与确认克数重算', { grams: 150, expectedKcal: expectedPhotoKcal, serviceReportedKcalIgnored: 999999 });

  run(`state.review=[];state.photoItems=parseRecognitionResponse({items:[
    {name:'米饭',grams:150,confidence:0.9,weightConfidence:0.4},
    {name:'西兰花',grams:100,confidence:0.85,weightConfidence:0.5}
  ]});renderPhotoResults();`);
  assert.ok(elements.get('photo-results').innerHTML.includes('id="photo-add-all"'));
  const addAllTarget = { closest: selector => selector === '#photo-add-all' ? {} : null };
  run('void 0');
  elements.get('photo-results').listeners.click.forEach(fn => fn({ target: addAllTarget }));
  assert.strictEqual(run('state.review.length'), 2);
  assert.strictEqual(run('state.photoItems.every(item=>item.added)'), true);
  assert.ok(run('state.review.every(row=>row.inputMode==="photo" && reviewCalc(row).grams>0)'));
  elements.get('photo-results').listeners.click.forEach(fn => fn({ target: addAllTarget }));
  assert.strictEqual(run('state.review.length'), 2);
  assert.strictEqual(run('state.data.entries.some(entry=>entry.grams===150 && entry.inputMode==="photo" && entry.kcal===195)'), true);
  pass('动态“全部加入”一次加入多项候选，重复点击不会重复添加', { candidates: 2, reviewRows: 2, duplicateRowsAfterSecondClick: 0 });

  run(`state.review=[];state.photoItems=parseRecognitionResponse({items:[{name:'米饭',confidence:0.8,weightConfidence:0.2}]});addPhotoItem(0);`);
  approx(run('reviewCalc(state.review[0]).grams'), 0);
  const beforeMissingWeight = run('state.data.entries.length');
  run('confirmReview();');
  assert.strictEqual(run('state.data.entries.length'), beforeMissingWeight);
  pass('照片缺少克重时保留待确认并阻止入账，不默认 100g', { grams: 0, entriesUnchanged: true });

  run(`state.review=[];state.photoItems=[];state.photo={uploadFile:new Blob(['x'],{type:'image/jpeg'}),converted:true,originalFile:{name:'x.jpg'}};
    state.data.settings.recognitionEndpoint='https://fixture.invalid/recognize';state.session.photoConsent=true;
    __fetchImpl=async()=>({ok:false,status:503,text:async()=>''});`);
  await run('recognize()');
  assert.strictEqual(run('state.photoItems.length'), 0);
  assert.strictEqual(run('state.review.length'), 0);
  assert.ok(elements.get('photo-status').textContent.includes('HTTP 503'));
  pass('识别服务失败时不生成虚假食物或热量', { status: 503, candidates: 0, reviewRows: 0 });

  run(`state.data.settings.recognitionEndpoint='';state.session.photoConsent=false;__fetchCalls=[];
    __fetchImpl=async()=>{throw new Error('不应发起请求')};`);
  await run('recognize()');
  assert.strictEqual(run('__fetchCalls.length'), 0);
  assert.strictEqual(elements.get('dlg-settings').open, true);
  assert.strictEqual(run('state.photoItems.length'), 0);
  pass('未配置或未授权识别服务时不发起上传', { fetchCalls: 0, settingsOpened: true });

  run(`state.data.settings.recognitionEndpoint='https://fixture.invalid/recognize';state.session.photoConsent=true;
    state.session.recognitionKey='fixture-secret';state.photoBusy=false;state.review=[];state.photoItems=[];__fetchCalls=[];
    $('#photo-note').value='餐盘直径26厘米';
    __fetchImpl=async(url,options)=>({ok:true,status:200,text:async()=>JSON.stringify({items:[{
      name:'米饭',grams:150,gramsMin:120,gramsMax:180,confidence:0.9,weightConfidence:0.4,
      referenceObject:'26厘米餐盘',kcal:888888
    }]})});`);
  await run('recognize()');
  assert.strictEqual(run('state.photoItems.length'), 1);
  assert.strictEqual(run('state.review.length'), 0);
  const requestCheck = run(`(()=>{const [url,options]=__fetchCalls[0];return {
    url,method:options.method,schema:options.body.get('schema'),note:options.body.get('note'),
    auth:options.headers.Authorization,hasImage:Boolean(options.body.get('image'))
  }})()`);
  assert.strictEqual(requestCheck.url, 'https://fixture.invalid/recognize');
  assert.strictEqual(requestCheck.method, 'POST');
  assert.strictEqual(requestCheck.schema, 'shike.food-vision.v2');
  assert.strictEqual(requestCheck.note, '餐盘直径26厘米');
  assert.strictEqual(requestCheck.auth, 'Bearer fixture-secret');
  assert.strictEqual(requestCheck.hasImage, true);
  assert.ok(elements.get('photo-status').textContent.includes('尚未计入'));
  pass('真实请求适配层发送压缩图/说明/协议版本，响应仍不自动入账', { schema: 'shike.food-vision.v2', autoAdded: false, fixture: true });

  run(`state.usdaResults=[{fdcId:999001,description:'Fixture broccoli',dataType:'Fixture',
    foodNutrients:[{nutrientId:1008,value:34},{nutrientId:1003,value:2.8},{nutrientId:1004,value:0.4},{nutrientId:1005,value:6.6}]}];
    state.photoItems=[normalizeRecognitionItem({name:'未匹配蔬菜',grams:80},0)];state.usdaPhotoIndex=0;pickUsda('999001');`);
  assert.strictEqual(run('state.photoItems[0].foodId'), 'usda-999001');
  assert.ok(run('state.photoItems[0].matchMethod').includes('用户核对 USDA'));
  assert.strictEqual(run('state.review.length'), 0);
  approx(run('photoEnergy(state.photoItems[0]).kcal'), 27.2);
  pass('照片候选手动匹配 USDA 后按确认克数重算，不自动入账', { grams: 80, kcal: 27.2, fixtureFdcId: 999001 });

  run('state.review=[];');
  const breakfastRows = run('parseDescription("2个水煮蛋和1杯全脂牛奶")');
  assert.ok(breakfastRows.length >= 2);
  const breakfastKcal = run('parseDescription("2个水煮蛋和1杯全脂牛奶").reduce((s,r)=>s+reviewCalc(r).kcal,0)');
  approx(breakfastKcal, 304.4, 0.01);
  const lunchRows = run('parseDescription("1碗米饭和150克鸡胸肉和100克西兰花")');
  console.log('LUNCH_ROWS', JSON.stringify(lunchRows.map(r => ({ rawName: r.rawName, foodId: r.foodId, quantity: r.quantity, unit: r.unit, portion: run(`reviewCalc(${JSON.stringify(r)})`) })), null, 2));
  const lunchKcal = lunchRows.reduce((s,r)=>s+run(`reviewCalc(${JSON.stringify(r)}).kcal`),0);
  approx(lunchKcal, 477.5, 0.01);
  assert.ok(run('csvCell("=1+1")').startsWith("'"));
  pass('既有文字解析、标准示例热量与 CSV 公式转义回归', { breakfastKcal, lunchKcal });

  const reloaded = createContext(shared);
  assert.strictEqual(reloaded.run('window.__shikeBootOK'), true);
  assert.strictEqual(reloaded.run('state.data.entries.length'), run('state.data.entries.length'));
  assert.strictEqual(reloaded.run('state.data.entries[0].id'), 'legacy-entry');
  assert.strictEqual(reloaded.run('state.data.customFoods.some(f=>f.id==="legacy-custom")'), true);
  assert.strictEqual(reloaded.run(`state.data.customFoods.some(f=>f.id===${JSON.stringify(newFoodId)})`), false);
  assert.ok(reloaded.run('state.data.entries.some(e=>e.inputMode==="photo" && e.weightConfidence===0.42)'));
  pass('重新加载后旧记录、全局食物与照片估算审计字段仍在', { entries: reloaded.run('state.data.entries.length') });

  const report = {
    version: '1.2.0',
    source: htmlPath,
    method: 'Node VM + deterministic DOM/canvas/fetch fixtures; no rendered browser preview',
    fixtureNotice: '识别与 USDA 在线响应均为协议测试夹具，不代表真实识别准确率或实时 USDA 查询结果。',
    passed: results.length,
    failed: 0,
    results
  };
  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const out = path.join(outputDir, 'test-1.2.0-vm-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`ALL ${results.length} TEST GROUPS PASSED`);
  console.log(out);
})().catch(err => {
  console.error(err && err.stack || err);
  process.exitCode = 1;
});

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 复用 1.2.0 的同一 VM 桩，避免新旧测试环境漂移；不执行旧测试主体。
const legacyTest = fs.readFileSync(path.join(__dirname, "test_1_2_0_vm.cjs"), "utf8");
const harnessEnd = legacyTest.indexOf("(async () => {");
assert(harnessEnd > 0, "legacy VM harness boundary not found");
const { createContext } = new Function("require", "__dirname", `${legacyTest.slice(0, harnessEnd)}\nreturn { createContext };`)(require, __dirname);
const root = path.join(__dirname, "..");
const results = [];
function pass(name, detail) { results.push({ name, pass: true, detail }); console.log(`PASS ${name}: ${detail}`); }
function approx(a, b, tolerance = 0.01) { assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`); }
function throws(fn, pattern) { assert.throws(fn, pattern); }
async function test(name, fn) {
  try { const detail = await fn(); pass(name, detail); }
  catch (error) { results.push({ name, pass: false, error: error.stack || String(error) }); console.error(`FAIL ${name}:`, error); process.exitCode = 1; }
}

(async () => {
  await test("1.2 data migrates in place and survives reload", () => {
    const shared = new Map([["shike-food-energy-ledger-v1", JSON.stringify({
      entries: [{ id: "legacy-entry", date: "2026-11-13", meal: "早餐", name: "旧燕麦", quantity: 1, unit: "克", grams: 100, kcal: 380, kj: 1589.92, protein: 13, fat: 7, carb: 68, createdAt: "2026-11-13T08:00:00.000Z" }],
      customFoods: [{ id: "legacy-food", name: "旧食物", kcal: 100, protein: 1, fat: 2, carb: 3 }],
      settings: { dailyTarget: 1800, recognitionEndpoint: "" }
    })]]);
    const c = createContext(shared);
    assert.equal(c.run("state.data.schemaVersion"), 2);
    assert.equal(c.run("state.data.entries[0].id"), "legacy-entry");
    assert.equal(c.run("state.data.entries[0].kcal"), 380);
    assert.equal(c.run("state.data.customFoods[0].id"), "legacy-food");
    assert.equal(c.run("state.data.settings.dailyTarget"), 1800);
    assert.equal(c.run("state.data.goals.calorieMode"), "manual");
    assert.equal(c.run("calorieTarget130()"), 1800);
    assert.equal(c.run("state.data.workouts.length + state.data.bodyMetrics.length"), 0);
    c.run(`state.data.workouts.push(normalizeWorkout130({id:"persist-w",date:"2026-11-13",type:"strength",name:"力量",exercises:[{name:"深蹲",weightKg:60,reps:10,sets:3}]}));
      state.data.bodyMetrics.push(normalizeBodyMetric130({id:"persist-b",date:"2026-11-13",weightKg:70}));
      state.data.workoutTemplates.push(normalizeTemplate130({id:"persist-t",name:"腿",type:"strength",exercises:[{name:"深蹲",weightKg:60,reps:10,sets:3}]})); saveData();`);
    const reloaded = createContext(shared);
    assert.equal(reloaded.run("state.data.entries[0].id"), "legacy-entry");
    assert.equal(reloaded.run("state.data.workouts[0].id"), "persist-w");
    assert.equal(reloaded.run("state.data.bodyMetrics[0].id"), "persist-b");
    assert.equal(reloaded.run("state.data.workoutTemplates[0].id"), "persist-t");
    assert.equal(reloaded.run("JSON.parse(localStorage.getItem(STORAGE_KEY)).schemaVersion"), 2);
    return "旧饮食、食物库和 1800 kcal 目标保留；训练、模板、身体数据重载后仍在原键中";
  });

  await test("BMR, activity and goal adjustments are explicit estimates", () => {
    const c = createContext();
    const result = c.run(`JSON.stringify(estimateEnergy130({sex:"male",age:30,heightCm:175,weightKg:70},"maintain","sedentary"))`);
    const estimate = JSON.parse(result);
    assert.deepEqual(estimate, { bmr: 1649, tdee: 1979, target: 1980 });
    assert.equal(c.run("estimateEnergy130({sex:'male',age:30,heightCm:175,weightKg:70},'lose','sedentary').target"), 1680);
    assert.equal(c.run("estimateEnergy130({sex:'male',age:30,heightCm:175,weightKg:70},'gain','sedentary').target"), 2180);
    assert.equal(c.run("estimateEnergy130({sex:'male',age:null,heightCm:175,weightKg:70},'maintain','sedentary')"), null);
    const data = JSON.parse(c.run(`JSON.stringify(migrateData130({settings:{dailyTarget:2000},goals:{calorieMode:"auto",estimatedCalories:1650}}))`));
    c.context.__energyData = data;
    assert.equal(c.run("calorieTarget130(__energyData)"), 1650);
    return "Mifflin–St Jeor BMR=1649，久坐 TDEE=1979；维持/减脂/增肌分别 1980/1680/2180 kcal（公式估算）";
  });

  await test("training and rest nutrition targets switch by recorded workout", () => {
    const c = createContext();
    c.context.__nutritionData = {
      settings: { dailyTarget: 2000 },
      nutritionTargets: { training: { protein: 150, carb: 250, fat: 60 }, rest: { protein: 120, carb: 200, fat: 50 } },
      workouts: [{ id: "w", date: "2026-11-13", type: "cardio", durationMin: 30, exercises: [] }]
    };
    c.run("__nutritionData = migrateData130(__nutritionData)");
    assert.equal(c.run("dayType130('2026-11-13',__nutritionData)"), "training");
    assert.equal(c.run("dayType130('2026-11-12',__nutritionData)"), "rest");
    assert.equal(c.run("nutritionTarget130('2026-11-13',__nutritionData).protein"), 150);
    assert.equal(c.run("nutritionTarget130('2026-11-12',__nutritionData).protein"), 120);
    return "有训练记录的日期采用 150 g 蛋白质目标，无训练日期采用 120 g";
  });

  await test("strength volume and cardio/strength calorie estimates", () => {
    const c = createContext();
    const volume = c.run(`workoutVolume130({exercises:[{weightKg:60,reps:10,sets:3},{weightKg:20,reps:12,sets:2},{weightKg:0,reps:15,sets:4}]})`);
    approx(volume, 2280);
    const normalized = JSON.parse(c.run(`JSON.stringify(normalizeWorkout130({date:"2026-11-13",type:"strength",exercises:[{name:"深蹲",weightKg:60,reps:10,sets:3},{name:"推举",weightKg:20,reps:12,sets:2}]}))`));
    approx(normalized.exercises[0].volumeKg, 1800); approx(normalized.volumeKg, 2280);
    assert.equal(c.run("estimateWorkoutKcal130('strength','strength',45,70)"), 276);
    assert.equal(c.run("estimateWorkoutKcal130('cardio','running',30,70)"), 294);
    assert.equal(c.run("estimateWorkoutKcal130('cardio','running',30,null)"), null);
    return "60×10×3 + 20×12×2 + 自重 0 = 2280 kg；45 分钟力量约 276、30 分钟跑步约 294 kcal";
  });

  await test("incomplete exercise is blocked and valid workout saves without calorie deduction", () => {
    const c = createContext();
    c.run(`setRecordType130("workout"); $("#workout-date").value="2026-11-13"; $("#workout-name").value="腿部训练"; $("#workout-duration").value="45";
      state.data.profile.weightKg=70; state.fitness.draftExercises=[{name:"深蹲",weightKg:"60",reps:"",sets:"3",rpe:""}];`);
    assert.match(c.run("validateWorkoutDraft130(workoutDraft130())"), /不完整/);
    assert.equal(c.run("state.data.workouts.length"), 0);
    c.run(`state.fitness.draftExercises=[{name:"深蹲",weightKg:"60",reps:"10",sets:"3",rpe:"8"}]; saveWorkout130({preventDefault(){}});`);
    assert.equal(c.run("state.data.workouts.length"), 1);
    approx(c.run("state.data.workouts[0].volumeKg"), 1800);
    assert.equal(c.run("state.data.workouts[0].estimatedKcal"), 276);
    assert.equal(c.run("dayTotals('2026-11-13').kcal"), 0);
    assert.equal(c.run("state.data.entries.length"), 0);
    return "缺次数时拒绝保存；有效训练容量 1800 kg，估算消耗未进入饮食 entries 或抵扣热量";
  });

  await test("seven-day moving average uses actual samples only", () => {
    const c = createContext();
    c.context.__metrics = [
      { date: "2026-11-06", weightKg: 65 }, { date: "2026-11-07", weightKg: 70 },
      { date: "2026-11-09", weightKg: 71 }, { date: "2026-11-10", weightKg: null },
      { date: "2026-11-13", weightKg: 72 }, { date: "2026-11-14", weightKg: 99 }
    ];
    const detail = JSON.parse(c.run("JSON.stringify(movingAverageDetail130(__metrics,'2026-11-13','weightKg',7))"));
    assert.deepEqual(detail, { value: 71, count: 3, start: "2026-11-07", end: "2026-11-13" });
    assert.equal(c.run("movingAverage130(__metrics,'2026-11-13')"), 71);
    assert.equal(c.run("movingAverage130([],'2026-11-13')"), null);
    return "11/07–11/13 仅取 70、71、72 三次有效测量，平均 71 kg；窗口外与空值不补入";
  });

  await test("same-day body metric updates instead of duplicating", () => {
    const c = createContext();
    c.run(`setRecordType130("body"); $("#body-date").value="2026-11-13"; $("#body-weight").value="70.2"; $("#body-waist").value="80"; $("#body-fat").value=""; saveBodyMetric130({preventDefault(){}});`);
    assert.equal(c.run("state.data.bodyMetrics.length"), 1);
    const id = c.run("state.data.bodyMetrics[0].id");
    c.run(`$("#body-date").value="2026-11-13"; $("#body-weight").value="70.6"; $("#body-waist").value="79.5"; $("#body-fat").value="20"; saveBodyMetric130({preventDefault(){}});`);
    assert.equal(c.run("state.data.bodyMetrics.length"), 1);
    assert.equal(c.run("state.data.bodyMetrics[0].id"), id);
    assert.equal(c.run("state.data.bodyMetrics[0].weightKg"), 70.6);
    assert.equal(c.run("state.data.bodyMetrics[0].waistCm"), 79.5);
    assert.equal(c.run("state.data.bodyMetrics[0].bodyFatPct"), 20);
    return "同日第二次保存更新原 ID：70.2→70.6 kg，并补入体脂率，不产生重复记录";
  });

  await test("weekly summary counts goal days, training and average-weight change", () => {
    const c = createContext();
    c.context.__weekData = {
      settings: { dailyTarget: 2000 },
      nutritionTargets: { training: { protein: 150, carb: 0, fat: 0 }, rest: { protein: 120, carb: 0, fat: 0 } },
      entries: [
        { id: "e1", date: "2026-11-09", name: "A", kcal: 1900, protein: 150 },
        { id: "e2", date: "2026-11-10", name: "B", kcal: 2201, protein: 119 },
        { id: "e3", date: "2026-11-12", name: "C", kcal: 2000, protein: 120 }
      ],
      workouts: [
        { id: "w1", date: "2026-11-09", type: "strength", durationMin: 60, exercises: [{ name: "深蹲", weightKg: 60, reps: 10, sets: 3 }] },
        { id: "w2", date: "2026-11-15", type: "cardio", durationMin: 30, volumeKg: 0, exercises: [] }
      ],
      bodyMetrics: [
        { id: "b0", date: "2026-11-02", weightKg: 68 }, { id: "b1", date: "2026-11-08", weightKg: 70 },
        { id: "b2", date: "2026-11-09", weightKg: 70 }, { id: "b3", date: "2026-11-15", weightKg: 72 }
      ]
    };
    c.run("__weekData=migrateData130(__weekData)");
    const summary = JSON.parse(c.run("JSON.stringify(weeklySummary130(__weekData,'2026-11-13'))"));
    assert.equal(summary.start, "2026-11-09"); assert.equal(summary.end, "2026-11-15");
    assert.equal(summary.foodDays, 3); assert.equal(summary.calorieGoalDays, 2); assert.equal(summary.proteinGoalDays, 2);
    assert.equal(summary.trainingCount, 2); assert.equal(summary.trainingMinutes, 90); approx(summary.volumeKg, 1800);
    assert.equal(summary.currentAverage, 71); assert.equal(summary.previousAverage, 69); assert.equal(summary.averageChange, 2);
    return "周一至周日：3 个有记录日中热量/蛋白质各达标 2 天，训练 2 次 90 分钟，7 日均重 69→71 kg";
  });

  await test("legacy/current JSON import validates and complete CSV/JSON exports retain new data", () => {
    const c = createContext();
    const oldPayload = JSON.stringify({ entries: [], customFoods: [], dailyReferenceTargetKcal: 1900 });
    c.context.__oldPayload = oldPayload;
    assert.equal(c.run("parseImport130(__oldPayload).settings.dailyTarget"), 1900);
    assert.equal(c.run("parseImport130(__oldPayload).schemaVersion"), 2);
    c.context.__badJSON = "{"; throws(() => c.run("parseImport130(__badJSON)"), /有效的 JSON/);
    c.context.__futureJSON = JSON.stringify({ schemaVersion: 99, entries: [] });
    throws(() => c.run("parseImport130(__futureJSON)"), /更新版本/);
    c.context.__badEntry = JSON.stringify({ entries: [{ date: "bad", name: "", kcal: null }] });
    throws(() => c.run("parseImport130(__badEntry)"), /第 1 条饮食记录/);
    c.run(`state.data.entries=[{id:"e",date:"2026-11-13",meal:"早餐",name:"燕麦",kcal:200,kj:836.8,protein:8,fat:3,carb:35,grams:50}];
      state.data.workouts=[normalizeWorkout130({id:"w",date:"2026-11-13",type:"strength",name:"腿部",exercises:[{name:"深蹲",weightKg:60,reps:10,sets:3}]})];
      state.data.workoutTemplates=[normalizeTemplate130({id:"t",name:"腿",type:"strength",exercises:[{name:"深蹲",weightKg:60,reps:10,sets:3}]})];
      state.data.bodyMetrics=[normalizeBodyMetric130({id:"b",date:"2026-11-13",weightKg:70,waistCm:80,notes:"=1+1"})];`);
    const payload = JSON.parse(c.run("JSON.stringify(buildExportPayload130())"));
    assert.equal(payload.schemaVersion, 2); assert.equal(payload.entries.length, 1); assert.equal(payload.workouts.length, 1);
    assert.equal(payload.workoutTemplates.length, 1); assert.equal(payload.bodyMetrics.length, 1); assert(payload.goals && payload.nutritionTargets);
    const workoutCSV = c.run("buildWorkoutCSV130()"); const bodyCSV = c.run("buildBodyCSV130()");
    assert(workoutCSV.startsWith("\uFEFF日期,类型,名称")); assert(workoutCSV.includes("深蹲")); assert(workoutCSV.includes("1800"));
    assert(bodyCSV.startsWith("\uFEFF日期,体重_kg,腰围_cm,体脂率_%")); assert(bodyCSV.includes("'=1+1"));
    return "旧 JSON 的 1900 kcal 目标可迁移；坏 JSON/未来版本/坏记录被拒绝；新 JSON 与两个 CSV 含完整新增数据且防公式注入";
  });

  await test("new UI has no duplicate IDs and all static selectors resolve", () => {
    const html = fs.readFileSync(path.join(root, "project/app/src/main/assets/index.html"), "utf8");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ["record-diet-panel", "record-workout-panel", "record-body-panel", "goal-rings", "today-workouts", "trend-workout-panel", "trend-body-panel", "dlg-fitness", "dlg-nutrition", "dlg-weekly", "import-file"]) assert(ids.includes(id), id);
    assert(html.includes('const STORAGE_KEY = "shike-food-energy-ledger-v1"'));
    assert(!/<script[^>]+src=/i.test(html));
    return `${ids.length} 个 ID 无重复；三类记录/趋势、目标与周总结挂载点完整；无外部脚本依赖`;
  });
})().finally(() => {
  const report = {
    app: "食刻 Android", version: "2.0.0", schemaVersion: 2,
    generatedAt: new Date().toISOString(), scope: "Node VM + legacy 1.2.0 DOM/localStorage stubs; not an Android device test",
    passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results
  };
  fs.mkdirSync(path.join(root, "reference"), { recursive: true });
  fs.writeFileSync(path.join(root, "reference/Shike_2.0.0_runtime-tests.json"), JSON.stringify(report, null, 2));
  console.log(`RESULT ${report.passed} passed / ${report.failed} failed`);
});

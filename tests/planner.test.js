// Запуск: node --test tests/planner.test.js
const test = require("node:test");
const assert = require("node:assert");
const P = require("../docs/planner.js");
const lib = require("../docs/exercises.json");

test("план по правилам подходит под любые ответы", () => {
  for (const goal of Object.keys(P.GOALS)) for (const level of [1, 2, 3]) for (const eq of ["none", "dumbbell", "gym"])
    for (const n of [2, 3, 4, 5, 6]) for (const avoid of [[], ["knees"], ["back", "shoulders"], Object.keys(P.AVOID)])
      for (const focus of [[], ["abs"], ["biceps", "glutes"]]) {
        const wd = [0, 1, 2, 3, 4, 5].slice(0, n);
        const plan = P.buildPlan(lib, { goal, level, eq, wd, avoid, focus }, 1);
        assert.strictEqual(plan.d.length, n);
        for (const day of plan.d) {
          assert.ok(day.x.length >= 4);
          const keys = day.x.map((x) => x[0]);
          assert.strictEqual(new Set(keys).size, keys.length, "повтор в дне");
          for (const k of keys) {
            const e = lib.find((e) => e.k === k);
            assert.ok(!e.avoid.some((a) => avoid.includes(a)), `${k} нарушает ограничения`);
            assert.ok(e.lvl <= level);
          }
        }
      }
});

test("акцент добавляет упражнения на выбранную мышцу в каждый день", () => {
  const plan = P.buildPlan(lib, { goal: "mass", level: 2, eq: "gym", wd: [0, 2, 4], avoid: [], focus: ["biceps"] }, 1);
  for (const day of plan.d) assert.ok(day.x.some(([k]) => lib.find((e) => e.k === k).mus.includes("biceps")));
});

test("следующая неделя тяжелее и с другими упражнениями", () => {
  const s = { goal: "loss", level: 2, eq: "dumbbell", wd: [0, 2, 4], avoid: [], focus: [] };
  const w1 = P.buildPlan(lib, s, 1), w2 = P.buildPlan(lib, s, 2);
  assert.strictEqual(w2.w, 2);
  assert.ok(w2.d[0].x[0][2] > w1.d[0].x[0][2] || w2.d[0].x[0][0] !== w1.d[0].x[0][0]);
  assert.notDeepStrictEqual(w1.d.map((d) => d.x.map((x) => x[0])), w2.d.map((d) => d.x.map((x) => x[0])));
});

test("быстрая тренировка только на выбранную мышцу", () => {
  const s = { goal: "fit", level: 1, eq: "none", days: 3, avoid: [], focus: [] };
  const q = P.buildQuick(lib, s, "abs");
  assert.ok(q.x.length >= 3 && q.x.every(([k]) => lib.find((e) => e.k === k).mus.includes("abs")));
  assert.ok(!P.availableMuscles(lib, s).includes("biceps"), "без инвентаря бицепс недоступен");
});

test("план из ссылки очищается от мусора", () => {
  const p = P.sanitizePlan(lib, { g: "fit", d: [{ t: "<b>x</b>", x: [["pu", 99, 999], ["nope", 3, 3], "junk"] }] });
  assert.deepStrictEqual(p.d[0].x, [["pu", 6, 50]]);
  assert.throws(() => P.sanitizePlan(lib, { g: "fit", d: [{ x: [["nope", 1, 1]] }] }));
});

test("день 1 — ближайший тренировочный день, начиная с сегодня", () => {
  assert.deepStrictEqual(P.orderWeekdays([0, 1, 3], 1), [1, 3, 0]); // вторник: Вт, Чт, потом Пн
  assert.deepStrictEqual(P.orderWeekdays([0, 2, 4], 5), [0, 2, 4]); // суббота: следующий — Пн
  assert.deepStrictEqual(P.validateSurvey({ goal: "fit", level: 1, eq: "none", wd: [3, 1, 5] }).wd, [3, 1, 5]);
});

test("калории растут с весом и интенсивностью", () => {
  assert.ok(P.kcal(P.MET.cardio, 70, 60) > P.kcal(P.MET.core, 70, 60));
  assert.ok(P.kcal(5, 90, 60) > P.kcal(5, 60, 60));
  assert.strictEqual(Math.round(P.kcal(5, 70, 60) * 100) / 100, 6.13); // 5 × 3.5 × 70 / 200
});

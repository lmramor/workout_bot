// Запуск: node --test tests/planner.test.js
const test = require("node:test");
const assert = require("node:assert");
const P = require("../docs/planner.js");
const lib = require("../docs/exercises.json");

test("план по правилам подходит под любые ответы", () => {
  for (const goal of Object.keys(P.GOALS)) for (const level of [1, 2, 3]) for (const eq of ["none", "dumbbell", "gym"])
    for (const days of [2, 3, 4, 5, 6]) for (const avoid of [[], ["knees"], ["back", "shoulders"], Object.keys(P.AVOID)]) {
      const plan = P.buildPlan(lib, { goal, level, eq, days, avoid });
      assert.strictEqual(plan.d.length, days);
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

test("план из ссылки очищается от мусора", () => {
  const p = P.sanitizePlan(lib, { g: "fit", d: [{ t: "<b>x</b>", x: [["pu", 99, 999], ["nope", 3, 3], "junk"] }] });
  assert.deepStrictEqual(p.d[0].x, [["pu", 6, 50]]);
  assert.throws(() => P.sanitizePlan(lib, { g: "fit", d: [{ x: [["nope", 1, 1]] }] }));
});

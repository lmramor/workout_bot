/*
 * Логика плана: фильтрация упражнений, сборка плана по правилам, разбор плана из ссылки.
 * Работает и в браузере (window.Planner), и в Node для тестов (module.exports).
 */
(function (root) {
  "use strict";

  const GOALS = {
    mass: { title: "Набор массы", reps: 10, rest: 90 },
    loss: { title: "Похудение", reps: 15, rest: 40 },
    fit: { title: "Поддержание формы", reps: 12, rest: 60 },
    endurance: { title: "Выносливость", reps: 20, rest: 30 },
  };
  const LEVELS = { 1: "Новичок", 2: "Средний", 3: "Продвинутый" };
  const EQUIPMENT = { none: "Без инвентаря", dumbbell: "Гантели", gym: "Тренажёрный зал" };
  const AVOID = { knees: "Колени", back: "Спина", shoulders: "Плечи", wrists: "Запястья" };

  const DAY_TYPES = {
    full: { title: "Всё тело", cats: ["legs", "push", "pull", "core"], extra: { cardio: ["cardio", "legs"], strength: ["legs", "pull"] } },
    upper: { title: "Верх тела", cats: ["push", "pull", "push", "pull", "core"], extra: { cardio: ["cardio"], strength: [] } },
    lower: { title: "Ноги и пресс", cats: ["legs", "legs", "legs", "core", "core"], extra: { cardio: ["cardio"], strength: [] } },
  };
  const SPLITS = {
    2: ["full", "full"],
    3: ["full", "full", "full"],
    4: ["upper", "lower", "upper", "lower"],
    5: ["upper", "lower", "full", "upper", "lower"],
    6: ["upper", "lower", "full", "upper", "lower", "full"],
  };
  const FALLBACK = { pull: ["core", "legs"], push: ["core", "legs"], cardio: ["legs", "core"], legs: ["core"], core: ["legs"] };
  const EQ_RANK = { none: 0, dumbbell: 1, gym: 2 };

  function validateSurvey(s) {
    if (!s || typeof s !== "object") throw new Error("bad survey");
    const out = {
      goal: String(s.goal),
      level: Number(s.level),
      eq: String(s.eq),
      days: Number(s.days),
      avoid: Array.isArray(s.avoid) ? s.avoid.map(String).filter((a) => a in AVOID) : [],
    };
    if (!(out.goal in GOALS) || !(out.level in LEVELS) || !(out.eq in EQUIPMENT) || !(out.days in SPLITS)) {
      throw new Error("bad survey");
    }
    return out;
  }

  /** Упражнения, доступные пользователю: по инвентарю, уровню и ограничениям. */
  function allowedExercises(lib, s) {
    return lib.filter(
      (e) => EQ_RANK[e.eq] <= EQ_RANK[s.eq] && e.lvl <= s.level && !e.avoid.some((a) => s.avoid.includes(a))
    );
  }

  function amountFor(e, s) {
    if (e.mode === "time") {
      return [30, 40, 50][s.level - 1] + (s.goal === "endurance" ? 10 : 0);
    }
    const reps = GOALS[s.goal].reps;
    return e.cat === "cardio" ? Math.min(reps, 15) : reps;
  }

  /** План по правилам: без ИИ, всегда работает. */
  function buildPlan(lib, survey) {
    const s = validateSurvey(survey);
    const pool = allowedExercises(lib, s);
    // Сначала самое «тяжёлое» из доступного инвентаря, чтобы в зале не давать только отжимания.
    const byCat = {};
    for (const e of pool) (byCat[e.cat] = byCat[e.cat] || []).push(e);
    for (const c in byCat) byCat[c].sort((a, b) => EQ_RANK[b.eq] - EQ_RANK[a.eq]);
    const cursor = {};
    const sets = s.level === 1 ? 3 : s.goal === "mass" ? 4 : 3;
    const cardioGoal = s.goal === "loss" || s.goal === "endurance";

    const days = SPLITS[s.days].map((type) => {
      const t = DAY_TYPES[type];
      const cats = t.cats.concat(cardioGoal ? t.extra.cardio : t.extra.strength);
      const used = new Set();
      const items = [];
      for (const cat of cats) {
        for (const c of [cat].concat(FALLBACK[cat] || [])) {
          const list = byCat[c] || [];
          let pick = null;
          for (let i = 0; i < list.length; i++) {
            const e = list[((cursor[c] || 0) + i) % list.length];
            if (!used.has(e.k)) { pick = e; cursor[c] = (cursor[c] || 0) + i + 1; break; }
          }
          if (pick) { used.add(pick.k); items.push([pick.k, sets, amountFor(pick, s)]); break; }
        }
      }
      return { t: t.title, x: items };
    });
    return { v: 1, g: s.goal, d: days, src: "rules" };
  }

  /** Проверяет план, пришедший в ссылке: только известные упражнения и разумные числа. */
  function sanitizePlan(lib, p) {
    const byKey = Object.fromEntries(lib.map((e) => [e.k, e]));
    if (!p || !Array.isArray(p.d) || !(p.g in GOALS)) throw new Error("bad plan");
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));
    const days = p.d.slice(0, 7).map((d, i) => ({
      t: typeof d.t === "string" && d.t.trim() ? d.t.trim().slice(0, 40) : `День ${i + 1}`,
      x: (Array.isArray(d.x) ? d.x : [])
        .filter((it) => Array.isArray(it) && byKey[it[0]])
        .slice(0, 10)
        .map(([k, sets, amount]) => [
          k,
          clamp(sets, 1, 6),
          byKey[k].mode === "time" ? clamp(amount, 10, 180) : clamp(amount, 1, 50),
        ]),
    })).filter((d) => d.x.length);
    if (!days.length) throw new Error("empty plan");
    return { v: 1, g: p.g, d: days, src: p.src === "ai" ? "ai" : "rules" };
  }

  function decodeParam(str) {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /** Примерная длительность дня в минутах. */
  function estimateMinutes(lib, day, goal) {
    const byKey = Object.fromEntries(lib.map((e) => [e.k, e]));
    const rest = GOALS[goal].rest;
    let sec = 0;
    for (const [k, sets, amount] of day.x) {
      const work = byKey[k].mode === "time" ? amount : amount * 3;
      sec += sets * work + sets * rest;
    }
    return Math.max(5, Math.round(sec / 60 / 5) * 5);
  }

  const api = { GOALS, LEVELS, EQUIPMENT, AVOID, validateSurvey, allowedExercises, buildPlan, sanitizePlan, decodeParam, estimateMinutes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof window !== "undefined" ? window : globalThis);

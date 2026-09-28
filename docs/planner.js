/*
 * Логика плана: фильтрация упражнений, план по правилам, прогрессия по неделям,
 * быстрая тренировка на одну мышцу, проверка плана из ссылки.
 * Работает и в браузере (window.Planner), и в Node для тестов (module.exports).
 */
(function (root) {
  "use strict";

  const GOALS = {
    loss: { title: "Похудение", icon: "🔥", reps: 15, rest: 40 },
    mass: { title: "Набор массы", icon: "💪", reps: 10, rest: 90 },
    fit: { title: "Поддержание формы", icon: "⚖️", reps: 12, rest: 60 },
    endurance: { title: "Выносливость", icon: "🏃", reps: 20, rest: 30 },
  };
  const LEVELS = { 1: "Новичок", 2: "Средний", 3: "Продвинутый" };
  const EQUIPMENT = { none: "Дома без инвентаря", dumbbell: "Дома с гантелями", gym: "В зале" };
  const AVOID = { knees: "Колени", back: "Спина", shoulders: "Плечи", wrists: "Запястья" };
  const MUSCLES = {
    chest: "Грудь", lats: "Спина", delts: "Плечи", biceps: "Бицепс",
    triceps: "Трицепс", abs: "Пресс", legs: "Ноги", glutes: "Ягодицы",
  };
  const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

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
    // Порядок дней важен: первый в списке — «День 1»
    const wd = Array.isArray(s.wd) ? [...new Set(s.wd.map(Number))].filter((d) => d >= 0 && d <= 6) : null;
    const out = {
      goal: String(s.goal),
      level: Number(s.level),
      eq: String(s.eq),
      days: wd && wd.length ? wd.length : Number(s.days),
      avoid: Array.isArray(s.avoid) ? s.avoid.map(String).filter((a) => a in AVOID) : [],
      focus: Array.isArray(s.focus) ? s.focus.map(String).filter((m) => m in MUSCLES) : [],
      kg: Math.min(200, Math.max(35, Math.round(Number(s.kg) || 70))),
    };
    if (wd && wd.length) out.wd = wd;
    if (!(out.goal in GOALS) || !(out.level in LEVELS) || !(out.eq in EQUIPMENT) || !(out.days in SPLITS)) {
      throw new Error("bad survey");
    }
    return out;
  }

  /** Дни недели по порядку, начиная с ближайшего к сегодняшнему (0 = понедельник). */
  function orderWeekdays(wd, today) {
    const sorted = [...wd].sort((a, b) => a - b);
    const i = sorted.findIndex((d) => d >= today);
    return i <= 0 ? sorted : sorted.slice(i).concat(sorted.slice(0, i));
  }

  // Интенсивность нагрузки (MET) для оценки калорий
  const MET = { legs: 5.5, push: 4.5, pull: 4.5, core: 3.8, cardio: 8.0, rest: 1.8 };

  /** Калории за время: ккал/мин = MET × 3.5 × вес / 200 (стандартная формула). */
  function kcal(met, kg, seconds) {
    return (met * 3.5 * kg / 200) * (seconds / 60);
  }

  /** Упражнения, доступные пользователю: по инвентарю, уровню и ограничениям. */
  function allowedExercises(lib, s) {
    return lib.filter(
      (e) => EQ_RANK[e.eq] <= EQ_RANK[s.eq] && e.lvl <= s.level && !e.avoid.some((a) => s.avoid.includes(a))
    );
  }

  /** Мышцы, для которых хватает упражнений (минимум 2) с таким инвентарём. */
  function availableMuscles(lib, s) {
    const pool = allowedExercises(lib, s);
    return Object.keys(MUSCLES).filter((m) => pool.filter((e) => e.mus.includes(m)).length >= 2);
  }

  function amountFor(e, s, week) {
    const w = Math.max(0, (week || 1) - 1);
    if (e.mode === "time") {
      const base = [30, 40, 50][s.level - 1] + (s.goal === "endurance" ? 10 : 0);
      return Math.min(base + w * 5, base + 20);
    }
    const reps = GOALS[s.goal].reps;
    const base = e.cat === "cardio" ? Math.min(reps, 15) : reps;
    // Для массы растёт вес, а не повторения, поэтому прибавка скромнее
    return s.goal === "mass" ? Math.min(base + w, base + 2) : Math.min(base + w * 2, base + 6);
  }

  function setsFor(s, week) {
    const base = s.level === 1 ? 3 : s.goal === "mass" ? 4 : 3;
    return Math.min(4, base + (week >= 3 && s.level > 1 ? 1 : 0));
  }

  /** План по правилам: без ИИ, всегда работает. week > 1 — больше нагрузки и другие упражнения. */
  function buildPlan(lib, survey, week) {
    const s = validateSurvey(survey);
    week = Math.max(1, Math.min(52, Number(week) || 1));
    const pool = allowedExercises(lib, s);
    const focusFirst = (e) => (s.focus.some((m) => e.mus.includes(m)) ? 1 : 0);
    // Сначала упражнения на выбранные мышцы, потом самое «тяжёлое» из доступного инвентаря.
    const byCat = {};
    for (const e of pool) (byCat[e.cat] = byCat[e.cat] || []).push(e);
    for (const c in byCat) byCat[c].sort((a, b) => focusFirst(b) - focusFirst(a) || EQ_RANK[b.eq] - EQ_RANK[a.eq]);
    const cursor = {};
    for (const c in byCat) cursor[c] = ((week - 1) * 2) % byCat[c].length; // новая неделя — новые упражнения
    const sets = setsFor(s, week);
    const cardioGoal = s.goal === "loss" || s.goal === "endurance";
    let focusTurn = 0;

    const days = SPLITS[s.days].map((type) => {
      const t = DAY_TYPES[type];
      const cats = t.cats.concat(cardioGoal ? t.extra.cardio : t.extra.strength);
      const used = new Set();
      const items = [];
      const take = (e) => { used.add(e.k); items.push([e.k, sets, amountFor(e, s, week)]); };
      for (const cat of cats) {
        for (const c of [cat].concat(FALLBACK[cat] || [])) {
          const list = byCat[c] || [];
          let pick = null;
          for (let i = 0; i < list.length; i++) {
            const e = list[((cursor[c] || 0) + i) % list.length];
            if (!used.has(e.k)) { pick = e; cursor[c] = (cursor[c] || 0) + i + 1; break; }
          }
          if (pick) { take(pick); break; }
        }
      }
      // Акцент: ещё одно упражнение на выбранную мышцу в каждом дне
      if (s.focus.length) {
        for (let n = 0; n < s.focus.length; n++) {
          const m = s.focus[(focusTurn + n) % s.focus.length];
          const e = pool.find((x) => x.mus.includes(m) && !used.has(x.k));
          if (e) { take(e); focusTurn = (focusTurn + n + 1) % s.focus.length; break; }
        }
      }
      return { t: t.title, x: items };
    });
    return { v: 1, g: s.goal, w: week, s, d: days };
  }

  /** Быстрая тренировка на одну мышцу — чтобы сделать ещё одну сразу после основной. */
  function buildQuick(lib, survey, muscle) {
    const s = validateSurvey(survey);
    if (!(muscle in MUSCLES)) throw new Error("bad muscle");
    const list = allowedExercises(lib, s)
      .filter((e) => e.mus.includes(muscle))
      .sort((a, b) => (b.mus[0] === muscle) - (a.mus[0] === muscle) || EQ_RANK[b.eq] - EQ_RANK[a.eq])
      .slice(0, 5);
    return { t: MUSCLES[muscle], x: list.map((e) => [e.k, 3, amountFor(e, s, 1)]) };
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
    const out = { v: 1, g: p.g, w: clamp(p.w || 1, 1, 52), d: days };
    try { if (p.s) out.s = validateSurvey(p.s); } catch (e) { /* план без опроса тоже годится */ }
    return out;
  }

  function decodeParam(str) {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /** Примерная длительность дня в минутах и калории. */
  function estimate(lib, day, goal, kg) {
    const byKey = Object.fromEntries(lib.map((e) => [e.k, e]));
    const rest = GOALS[goal].rest;
    let sec = 0, cal = 0;
    for (const [k, sets, amount] of day.x) {
      const e = byKey[k];
      const work = e.mode === "time" ? amount : amount * 3;
      sec += sets * (work + rest);
      cal += kcal(MET[e.cat], kg || 70, sets * work) + kcal(MET.rest, kg || 70, sets * rest);
    }
    return { minutes: Math.max(5, Math.round(sec / 60 / 5) * 5), kcal: Math.round(cal / 5) * 5 };
  }
  const estimateMinutes = (lib, day, goal) => estimate(lib, day, goal).minutes;

  const api = {
    GOALS, LEVELS, EQUIPMENT, AVOID, MUSCLES, WEEKDAYS,
    MET, kcal, orderWeekdays, estimate,
    validateSurvey, allowedExercises, availableMuscles, buildPlan, buildQuick, sanitizePlan, decodeParam, estimateMinutes,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof window !== "undefined" ? window : globalThis);

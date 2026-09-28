import json
import subprocess
from pathlib import Path

import pytest

from services import planner
from services.planner import InvalidData, allowed_exercises, parse_ai_plan, plan_url_param, validate_survey

ROOT = Path(__file__).resolve().parent.parent
SURVEY = validate_survey({"goal": "loss", "level": 1, "eq": "dumbbell", "wd": [0, 2, 4],
                          "avoid": ["knees"], "focus": ["biceps"], "remind": "19:00"})


def ai_answer(days=3, keys=("pu", "rw", "gb", "pl", "cr")):
    return json.dumps({"days": [
        {"title": f"День {i}", "items": [{"key": k, "sets": 3, "amount": 12} for k in keys]}
        for i in range(days)
    ]})


def test_library_images_exist():
    for e in planner.LIBRARY:
        assert (ROOT / "docs" / "img" / f"{e['k']}.webp").exists(), e["k"]


def test_survey_days_come_from_weekdays():
    assert SURVEY["days"] == 3 and SURVEY["wd"] == [0, 2, 4]
    assert SURVEY["focus"] == ["biceps"] and SURVEY["remind"] == "19:00"
    with pytest.raises(InvalidData):
        validate_survey({**SURVEY, "remind": "25:00"})
    with pytest.raises(InvalidData):
        validate_survey({**SURVEY, "wd": [0, 1, 2, 3, 4, 5, 6]})


def test_validate_survey_rejects_garbage():
    with pytest.raises(InvalidData):
        validate_survey({"goal": "fly", "level": 1, "eq": "gym", "days": 3})
    with pytest.raises(InvalidData):
        validate_survey({"goal": "loss", "level": 1, "eq": "gym", "days": 12})
    assert validate_survey({**SURVEY, "avoid": ["knees", "hack"]})["avoid"] == ["knees"]


def test_allowed_respects_equipment_level_and_injuries():
    allowed = allowed_exercises(SURVEY)
    assert allowed
    for e in allowed:
        assert e["eq"] in ("none", "dumbbell")
        assert e["lvl"] == 1
        assert "knees" not in e["avoid"]


def test_parse_ai_plan_drops_unknown_and_forbidden():
    raw = ai_answer(keys=("pu", "rw", "gb", "pl", "cr", "sq", "bp", "hack", "pu"))  # sq бережёт колени, bp — зал
    plan = parse_ai_plan(raw, SURVEY)
    keys = [k for k, *_ in plan["d"][0]["x"]]
    assert keys == ["pu", "rw", "gb", "pl", "cr"]
    assert plan["src"] == "ai" and len(plan["d"]) == 3
    assert plan["w"] == 1 and "remind" not in plan["s"] and plan["s"]["wd"] == [0, 2, 4]


def test_parse_ai_plan_clamps_numbers():
    raw = json.dumps({"days": [{"title": "X", "items": [
        {"key": "pu", "sets": 50, "amount": 500}, {"key": "pl", "sets": 0, "amount": 1},
        {"key": "cr", "sets": "3", "amount": "15"}]}] * 3})
    x = parse_ai_plan(raw, SURVEY)["d"][0]["x"]
    assert x == [["pu", 5, 25], ["pl", 2, 15], ["cr", 3, 15]]


@pytest.mark.parametrize("raw", ["не json", "{}", ai_answer(days=2), ai_answer(keys=("pu", "bp"))])
def test_parse_ai_plan_rejects_bad_answers(raw):
    with pytest.raises(InvalidData):
        parse_ai_plan(raw, SURVEY)


def test_fallback_param_when_no_plan():
    param = plan_url_param(None, SURVEY)
    assert param.startswith("s=")
    js = (
        "const P=require('./docs/planner.js');const lib=require('./docs/exercises.json');"
        f"const p=P.buildPlan(lib,P.decodeParam('{param[2:]}'),1);process.stdout.write(String(p.d.length));"
    )
    assert subprocess.run(["node", "-e", js], cwd=ROOT, capture_output=True, text=True, check=True).stdout == "3"


def test_reminders_fire_once_on_selected_days():
    from database import db
    db.init_db()
    db.set_reminder(1, [0, 2], "19:00")
    db.set_reminder(2, [1], "19:00")
    db.set_reminder(3, [0], "19:00", enabled=False)
    assert db.due_reminders(0, "19:00", "2026-09-28") == [1]
    assert db.due_reminders(0, "19:01", "2026-09-28") == []
    db.mark_reminded(1, "2026-09-28")
    assert db.due_reminders(0, "19:00", "2026-09-28") == []   # второй раз за день не шлём
    assert db.due_reminders(2, "19:00", "2026-09-30") == [1]


def test_param_is_readable_by_mini_app():
    """План, упакованный ботом, должен читаться docs/planner.js без изменений."""
    plan = parse_ai_plan(ai_answer(), SURVEY)
    param = plan_url_param(plan, SURVEY)
    assert param.startswith("p=") and len(param) < 1800
    js = (
        "const P=require('./docs/planner.js');const lib=require('./docs/exercises.json');"
        f"const p=P.sanitizePlan(lib,P.decodeParam('{param[2:]}'));"
        "process.stdout.write(JSON.stringify(p));"
    )
    out = subprocess.run(["node", "-e", js], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == plan

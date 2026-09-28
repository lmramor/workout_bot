import json
import subprocess
from pathlib import Path

import pytest

from services import planner
from services.planner import InvalidData, allowed_exercises, parse_ai_plan, plan_url_param, validate_survey

ROOT = Path(__file__).resolve().parent.parent
SURVEY = {"goal": "loss", "level": 1, "eq": "dumbbell", "days": 3, "avoid": ["knees"]}


def ai_answer(days=3, keys=("pu", "rw", "gb", "pl", "cr")):
    return json.dumps({"days": [
        {"title": f"День {i}", "items": [{"key": k, "sets": 3, "amount": 12} for k in keys]}
        for i in range(days)
    ]})


def test_library_images_exist():
    for e in planner.LIBRARY:
        assert (ROOT / "docs" / "img" / f"{e['k']}.webp").exists(), e["k"]


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
    assert plan_url_param(None, SURVEY).startswith("s=")


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

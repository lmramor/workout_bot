import json
import subprocess
from pathlib import Path

import pytest

from services.planner import InvalidData, plan_url_param, validate_survey

ROOT = Path(__file__).resolve().parent.parent
RAW = {"goal": "loss", "level": 1, "eq": "dumbbell", "wd": [4, 0, 2],
       "avoid": ["knees", "hack"], "focus": ["biceps", "wings"], "kg": 82, "remind": True}


def test_library_images_exist():
    lib = json.loads((ROOT / "docs" / "exercises.json").read_text(encoding="utf-8"))
    for e in lib:
        assert (ROOT / "docs" / "img" / f"{e['k']}.webp").exists(), e["k"]


def test_survey_is_cleaned():
    s = validate_survey(RAW)
    assert s["wd"] == [0, 2, 4] and s["days"] == 3
    assert s["avoid"] == ["knees"] and s["focus"] == ["biceps"]
    assert s["kg"] == 82 and s["remind"] is True
    assert validate_survey({**RAW, "kg": 5})["kg"] == 35


@pytest.mark.parametrize("bad", [
    {**RAW, "goal": "fly"},
    {**RAW, "wd": [1]},
    {**RAW, "wd": [0, 1, 2, 3, 4, 5, 6]},
    {k: v for k, v in RAW.items() if k != "level"},
])
def test_survey_rejects_garbage(bad):
    with pytest.raises(InvalidData):
        validate_survey(bad)


def test_link_is_readable_by_mini_app():
    """Ссылка от бота должна превращаться в план в docs/planner.js."""
    param = plan_url_param(validate_survey(RAW))
    assert param.startswith("s=") and "remind" not in param
    js = (
        "const P=require('./docs/planner.js');const lib=require('./docs/exercises.json');"
        f"const s=P.decodeParam('{param[2:]}');const p=P.buildPlan(lib,s,1);"
        "process.stdout.write(JSON.stringify({days:p.d.length,kg:p.s.kg,focus:p.s.focus}));"
    )
    out = subprocess.run(["node", "-e", js], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == {"days": 3, "kg": 82, "focus": ["biceps"]}


def test_parse_reminder_time():
    from handlers.reminders import parse_time
    assert parse_time("19:30") == "19:30"
    assert parse_time("7.05") == "07:05"
    assert parse_time(" 9 00 ") == "09:00"
    assert parse_time("25:00") is None and parse_time("вечером") is None


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

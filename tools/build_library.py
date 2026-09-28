"""Собирает docs/exercises.json и docs/img/<key>.webp из free-exercise-db.

Запуск: python tools/build_library.py <путь к папке free-exercise-db/exercises>
Каждая картинка — два кадра упражнения рядом (начало и конец движения),
мини-апп показывает их по очереди как зацикленный клип.
"""
import json
import sys
from pathlib import Path

from PIL import Image

from library_src import L, MUSCLES

ROOT = Path(__file__).resolve().parent.parent
FRAME_W, FRAME_H = 640, 427


def main(src: Path) -> None:
    out_img = ROOT / "docs" / "img"
    out_img.mkdir(parents=True, exist_ok=True)
    lib = []
    assert set(MUSCLES) == {x[0] for x in L}, "у каждого упражнения должны быть мышцы"
    for key, ex_id, name, eq, cat, mode, lvl, avoid, cue in L:
        sprite = Image.new("RGB", (FRAME_W * 2, FRAME_H))
        for i in (0, 1):
            frame = Image.open(src / ex_id / f"{i}.jpg").convert("RGB")
            frame = frame.resize((FRAME_W, FRAME_H), Image.LANCZOS)
            sprite.paste(frame, (i * FRAME_W, 0))
        sprite.save(out_img / f"{key}.webp", "WEBP", quality=70, method=6)
        lib.append({"k": key, "name": name, "eq": eq, "cat": cat, "mode": mode,
                    "lvl": lvl, "avoid": avoid, "mus": MUSCLES[key], "cue": cue, "src": ex_id})
    (ROOT / "docs" / "exercises.json").write_text(
        json.dumps(lib, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Готово: {len(lib)} упражнений")


if __name__ == "__main__":
    main(Path(sys.argv[1]))

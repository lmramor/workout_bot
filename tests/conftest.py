import os
import sys
import tempfile
from pathlib import Path

# Тестам не нужны настоящие ключи, а база — во временной папке
os.environ.setdefault("BOT_TOKEN", "123:test")
os.environ.setdefault("WEBAPP_URL", "https://example.github.io/workout_bot/")
os.environ["DB_PATH"] = str(Path(tempfile.mkdtemp()) / "test.db")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

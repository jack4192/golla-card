"""Spring 쪽에 넘길 API 명세를 openapi.json 으로 저장한다.

    uv run python -m scripts.export_openapi
"""

import json
from pathlib import Path

from engine.api import create_app

PATH = Path(__file__).resolve().parent.parent / "openapi.json"


def main() -> None:
    PATH.write_text(json.dumps(create_app().openapi(), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"저장: {PATH}")


if __name__ == "__main__":
    main()

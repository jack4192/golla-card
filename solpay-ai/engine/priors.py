"""전체 사용자 분포. 개인 이력이 적을 때 섞어 쓴다."""

import json
from dataclasses import dataclass
from pathlib import Path

from engine.slots import Slot, slot_key

DEFAULT_AMOUNTS = (5000, 10000, 20000)


@dataclass
class Priors:
    slot_counts: dict[str, dict[str, int]]
    amounts: dict[str, list[int]]
    built_until: str = ""

    def for_slot(self, slot: Slot) -> dict[str, int]:
        return self.slot_counts.get(slot_key(slot), {})

    def amount_quantiles(self, category: str) -> tuple[int, ...]:
        return tuple(self.amounts.get(category, DEFAULT_AMOUNTS))

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(
            {"built_until": self.built_until, "slot_counts": self.slot_counts, "amounts": self.amounts},
            ensure_ascii=False, indent=1), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "Priors":
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(data["slot_counts"], data["amounts"], data.get("built_until", ""))

    @classmethod
    def empty(cls) -> "Priors":
        return cls({}, {})


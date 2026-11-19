"""전체 사용자 분포. 개인 이력이 적을 때 섞어 쓴다."""

import json
from dataclasses import dataclass, field
from pathlib import Path

from engine.slots import Slot, slot_key

DEFAULT_AMOUNT = 10000


@dataclass
class Priors:
    slot_counts: dict[str, dict[str, int]]
    amounts: dict[str, int]          # 업종별 결제 금액 중앙값
    built_until: str = ""
    brands: dict[str, dict[str, int]] = field(default_factory=dict)   # 업종 → 브랜드 코드("" 는 브랜드 없음) → 건수

    def for_slot(self, slot: Slot) -> dict[str, int]:
        return self.slot_counts.get(slot_key(slot), {})

    def amount_median(self, category: str) -> int:
        value = self.amounts.get(category, DEFAULT_AMOUNT)
        if isinstance(value, list):              # 예전 priors.json(25·50·75% 분위수)은 가운데 값을 쓴다
            value = value[len(value) // 2]
        return int(value)

    def brand_share(self, category: str) -> dict[str | None, float]:
        counts = self.brands.get(category, {})
        total = sum(counts.values())
        return {(b or None): n / total for b, n in counts.items()} if total else {None: 1.0}

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(
            {"built_until": self.built_until, "slot_counts": self.slot_counts, "amounts": self.amounts,
             "brands": self.brands}, ensure_ascii=False, indent=1), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "Priors":
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(data["slot_counts"], data["amounts"], data.get("built_until", ""), data.get("brands", {}))

    @classmethod
    def empty(cls) -> "Priors":
        return cls({}, {})


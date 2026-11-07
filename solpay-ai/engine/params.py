"""배치 알고리즘의 기준값. 설계서의 수치는 전부 여기에 모은다."""

from dataclasses import dataclass, replace

BASE_ORDER_FIRST_TIER = "first_tier"   # 모든 카드의 첫 구간을 먼저 채운다 (기본값)
BASE_ORDER_TOP_TIER = "top_tier"       # 1번 카드의 최고 구간부터 채운다 (챗봇 순서 규칙)


@dataclass(frozen=True)
class Params:
    # 3단계 점수
    w1: float = 1.0                     # 즉시 혜택
    w2: float = 1.0                     # 실적 기여 가치
    w3: float = 1.0                     # 프로모션 가치
    weight_min: float = 0.5             # 성향 규칙이 바꿀 수 있는 범위
    weight_max: float = 1.5

    # 4~5단계 교체와 2장 표시
    switch_threshold: int = 300         # 전환 기준 (원)
    evidence_prob: float = 0.3          # 근거 시나리오 확률 합의 최소값
    two_card_loss: int = 300            # 2장 표시 손실 기준 (원)
    scenario_min_prob: float = 0.2      # 2장 표시를 판단할 시나리오의 최소 확률
    top_gap_ratio: float = 0.1          # 1·2위 차이가 이 비율 이내면 2장 표시

    # 기본 카드
    base_order: str = BASE_ORDER_FIRST_TIER
    unreachable_sigma: float = 2.0      # 필요액이 예산 + 이 배수×σ 를 넘으면 건너뜀

    # 2단계 시나리오
    radius_m: float = 50.0              # 위치 후보 반경
    confirm_accuracy_m: float = 30.0    # 후보가 1곳일 때 확정하는 위치 정확도
    distance_scale_m: float = 50.0      # 거리 점수 exp(−거리 ÷ 이 값)
    visit_window_days: int = 90         # 방문 빈도 집계 기간
    prior_strength: int = 20            # 구간 결제가 이 건수보다 적으면 전체 분포를 섞는다
    min_category_prob: float = 0.02     # 이보다 작은 업종은 시나리오에서 뺀다
    amount_min_history: int = 5         # 금액 이력이 이보다 적으면 전체 분포를 쓴다
    repeat_min_count: int = 8           # 반복 구간 최소 결제 수
    repeat_min_share: float = 0.5       # 반복 구간 1위 업종 최소 확률
    max_chips: int = 3                  # 가맹점 후보 칩 수

    # 평일/주말 구분. 운영에서는 공휴일 테이블로 교체한다.
    holidays: tuple[str, ...] = (
        "2026-07-17", "2026-08-17", "2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09",
    )

    def with_(self, **changes) -> "Params":
        return replace(self, **changes)

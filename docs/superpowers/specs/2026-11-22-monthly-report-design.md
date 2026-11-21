# 월간 리포트 설계 (2026-11-22)

## 왜 만드나

금융 AI 시스템 설계 경진대회에서 AI 활용이 약해 보인다. 월간 리포트는 사용자가 한 달 동안 카드별로 무엇을 받았는지, 실적은 어디까지 왔는지,
SOL페이가 어떤 전략으로 카드를 배치했고 그 덕분에 얼마를 더 받았는지를 한 화면에서 보여 준다.
숫자는 엔진이 계산하고 요약 문장은 OpenAI 가 쓰는 원칙("고르는 건 엔진, 문구는 AI")을 그대로 지킨다.
API 명세서 64번 '이번 달 혜택 리포트'(백엔드 미구현, 앱 화면 없음)에 해당한다.

## 사용자 결정 (2026-11-22)

| 항목 | 결정 |
|---|---|
| 요약 문장 | OpenAI 가 쓰고 숫자 검사. 검사에 걸리거나 OpenAI 장애면 정해진 문구 (추천 페이지 문구와 같은 방식) |
| SOL페이 효과 | "지난달 결제를 추천 1순위 카드로 냈다면" 다시 계산한다 |
| 효과 계산 범위 | 지난달 카드 혜택 차이 + 지난달 프로모션 차이 + 지난달 실적이 이번 달 혜택에 주는 차이(추정)를 더한다. 화면에는 셋을 나눠 보여 준다 |
| 덜 받은 사용자 | 숨기지 않고 그대로 보여 주되 이유를 남긴다 |
| 카드별 프로모션 | 카드별로는 보여 주지 않는다 (효과 합계에만 들어간다) |
| 보이는 곳 | AI 서버 API + 개발용 시험 화면(/dev) 탭. 앱 화면은 Spring 연결 때 |
| 카드 배치 전략 | 이번 달 실적 채우기 방식, 고른 근거, 지금 실적을 채우는 카드를 보여 준다 |

## 목표 / 하지 않을 것

- 목표: 카드별 이번 달·지난달 숫자, 전략과 근거, SOL페이 효과(이유 포함), AI 요약을 API 한 번으로 준다.
- 하지 않을 것: 앱(Expo) 화면, Spring 연동, 리포트 저장(DB 쓰기), 알림 발송, 카드별 프로모션 표시, 연말 리포트 변경.
- 실패로 보는 것: 요약 문장에 엔진에 없는 숫자가 들어가는 것, 덜 받은 사용자에게 더 받았다고 말하는 것, 이유 없이 손해만 보여 주는 것.

## API

`GET /internal/users/{user_id}/monthly-report?at=2026-11-05T12:00:00+09:00` (`at` 기본값 지금, 토큰 검사 같음, 없는 사용자 404)

- 이번 달 = `at` 이 속한 달(진행 중, `at` 까지), 지난달 = 그 앞 달(확정).
- 같은 사용자·같은 날짜로 다시 부르면 메모리 캐시를 돌려주고 `cached: true` (추천 페이지와 같은 방식, OpenAI 비용 절약).

```json
{
  "user_id": 1, "at": "...", "month": "2026-11", "prev_month": "2026-10", "cached": false,
  "summary": {"headline": "...", "points": ["...", "..."]}, "copy_source": "llm | template",
  "totals": {"this_month_benefit": 1180, "prev_month_benefit": 47070},
  "cards": [{
    "user_card_id": 1, "card_id": 2, "name": "신한카드 Discount Plan", "issuer": "SHINHAN", "display_order": 1,
    "this_month": {"perf": 48440, "benefit": 1140, "payments": 9,
                   "tier_min": 1500000, "remaining_to_keep": 1451560, "next_tier": 400000, "remaining_to_next": 351560,
                   "limits": [{"name": "카드 월 통합 한도", "used": 1140, "limit": 50000, "left": 48860}]},
    "prev_month": {"perf": 1542790, "benefit": 43220, "payments": 112,
                   "first_tier": 400000, "tier_reached": 1500000, "achieved": true, "short_of_first": 0},
    "synced_note": false
  }],
  "strategy": {
    "current": "main_top", "label": "주력 카드 우선", "description": "구간 혜택이 가장 큰 주력 카드의 높은 구간부터 채우고 남으면 다른 카드",
    "chosen_by": "monthly", "chosen_by_label": "월간 맞춤 (지난 결제로 방식 비교)",
    "compare_months": 6, "compare": [{"method": "main_top", "label": "주력 카드 우선", "benefit": 418100}, "..."],
    "base_card": {"user_card_id": 1, "name": "...", "target_tier": 400000, "remaining": 351560},
    "current_order": [{"rank": 1, "user_card_id": 1, "name": "..."}], "message": "엔진 안내 문구"
  },
  "solpay_effect": {
    "month": "2026-10", "placement_payments": 81, "changed_payments": 43,
    "actual":      {"card": 47070, "promotion": 500, "next_month": 46820},
    "recommended": {"card": 47360, "promotion": 500, "next_month": 51710},
    "diff":        {"card": 290, "promotion": 0, "next_month": 4890, "total": 5180},
    "top_changes": [{"day": "2026-10-12", "category": "카페", "amount": 6500, "actual_card": "...", "recommended_card": "...",
                     "diff": -300, "why": "실적 채우기"}],
    "tier_changes": [{"card": "KB ALL 카드", "actual_perf": 371800, "recommended_perf": 412000, "first_tier": 400000,
                      "actual_reached": false, "recommended_reached": true}]
  }
}
```

## 계산

### 카드별 숫자
- 이번 달: 지금 `card_status` 와 같은 상태 재생. 한도는 챗봇 `get_card_status` 의 한도 계산을 공용 함수로 옮겨 같이 쓴다.
  `tier_min` 은 지난달 실적으로 이번 달 받는 구간 하한, `remaining_to_keep` 은 다음 달에도 그 구간을 받기까지 남은 금액,
  `next_tier` 는 이번 달 실적 바로 위 구간.
- 지난달: 지금 보이는 결제 중 이번 달 1일 전 결제만으로 상태를 다시 만든다(늦게 들어온 타사 결제 포함).
  `achieved` = 첫 구간(혜택을 받기 시작하는 최소 실적) 달성 여부, `tier_reached` = 도달한 가장 높은 구간 하한,
  `short_of_first` = 첫 구간까지 모자랐던 금액.
  확인: 1번 사용자 10월 카드별 실적·혜택이 팀 DB `card_month_status` 와 같다 (Discount Plan 1,542,790원·43,220원 등).
- 금액은 엔진이 계산한 카드사 혜택(할인·캐시백·적립)이다. 프로모션은 카드별로 넣지 않는다.
- 실적 조건이 없는 카드(구간이 0원 하나뿐)는 구간 칸을 `null` 로 두고 `achieved: null`.
- `totals` 는 카드별 금액의 합. 이유 코드는 1순위 카드 안내 문구 코드로 묶는다: RULE → 사용자 규칙, PROMOTION·PROMOTION_CARD → 프로모션,
  PERFORMANCE·HOLD·BASE_CHANGED → 실적 채우기, 나머지 → 혜택 비교.
- OpenAI 키가 없으면 바로 정해진 문구(`copy_source: template`).

### 카드 배치 전략
- 챗봇 `explain_ranking` 의 이번 달 방식 안내(`_month_strategy`)를 서비스 함수로 옮겨 리포트와 챗봇이 같이 쓴다.
  우선순위: 사용자 규칙(order) → 사용자 확정 → 월간 맞춤(최근 6개월 결제를 방식마다 다시 돌린 혜택 비교) → 기본 방식.
- 방식 설명은 `params.py` 정의를 그대로 쓴다: 첫 구간 우선(모든 카드의 첫 구간 먼저), 주력 카드 우선(구간 혜택이 가장 큰 카드의 높은 구간부터),
  가치 최대(예산 안에서 구간 증분 혜택 − 포기하는 혜택이 최대인 조합), 실적 안 채움(결제마다 혜택률 1위), 1번 카드 최고 구간 우선.
- 지금 실적을 채우는 카드와 결제 화면 순서·안내 문구는 기록을 남기지 않는 `preview(user, at)` 로 구한다.

### SOL페이 효과 (지난달)
- 지난달 1일 기준 상태 세 벌(실제·추천·엔진이 보는 상태)에서 지난달 결제를 시간순으로 다시 흘린다 (재생 평가 `replay_user` 를 한 달로 줄인 것).
  결제화면을 연 결제(`is_placement`)만 엔진 1순위 카드로 바꾸고, 나머지(온라인·자동이체·교통)는 실제 카드 그대로.
  엔진이 보는 상태는 동기화 시각(`visible_at`) 이후에 결제를 안다. 규칙은 지금 규칙, 일정·일정 팝업은 쓰지 않는다.
- card = 각 결제로 받은 카드 혜택 합. promotion = 그 결제·카드에 걸리는 진행 중 행사 중 가장 큰 것 (실제·추천 같은 조건으로, 마이샵은 켰다고 본다).
- next_month = 지난달 카드별 결제를 지난달 실적 구간으로 이번 달에 똑같이 했다면 받을 혜택 추정 (`strategy.month_benefit`, 월간 맞춤 방식과 같은 추정).
- total = card + promotion + next_month 의 차이. 음수여도 그대로 준다.
- 이유: `top_changes` = 추천과 실제 카드가 달랐던 결제 중 차이(카드 혜택+프로모션)가 큰 순 3건 (덜 받은 결제 우선, 엔진 이유 코드를 '실적 채우기/프로모션/혜택 비교/사용자 규칙'으로),
  `tier_changes` = 실제와 추천의 실적 도달 구간이 다른 카드.
- 결제화면을 연 결제가 지난달 없으면 `solpay_effect: null` 과 `effect_note` 를 준다.
- 사전 측정 (10월, 표본 60명): 중앙값 +3,735원, 덜 받은 사람 10명 (최소 −14,500원, 최대 +50,200원). 한 사람 0.1~0.3초.

### 요약 문장 (OpenAI)
- 새 파일 `engine/chat/report_copy.py`: `facts_of(report)` → OpenAI(`OPENAI_MODEL`, 기본 gpt-4o-mini, JSON `{headline, points}`, points 최대 3개)
  → 검사 → 걸리면 한 번 다시 쓰기 → 그래도 걸리면 `template_copy`. 제한 시간 `REPORT_COPY_TIMEOUT_SEC` 기본 8초.
- OpenAI 에 보내는 사실: 카드 상품명, 업종 이름, 금액, 날짜(일 단위), 방식 이름. 가맹점 이름·사용자 이름은 보내지 않는다.
- 검사: 문장 속 숫자는 사실에 있는 값만 (만 원 단위 반올림 '약 5만 원' 허용), total 이 음수면 '더 받았다'류 표현 금지 + 덜 받은 금액과 이유 하나 이상 언급,
  저장·설정 주장 금지(챗봇 검사기 재사용).
- 정해진 문구 예: "10월에 카드 혜택 47,070원을 받았어요." / "추천대로 냈다면 5,180원을 더 받을 수 있었어요(10월 290원, 실적 덕분에 11월 4,890원 예상)." /
  덜 받은 경우 "추천대로 냈다면 700원 덜 받았어요. KB ALL 카드로 실적을 모았지만 40만 원 구간에 닿지 못했어요."

### 개발용 화면
`/dev` 에 '5. 월간 리포트' 탭: 사용자·시각 입력 → 요약, 카드 표(이번 달/지난달), 전략과 비교 점수, SOL페이 효과와 이유.

## 확인 방법
- 자동 테스트: 지난달 구간 계산(달성/미달/첫 구간 모자란 금액), 효과 부호와 합(덜 받은 경우 포함), 이유 정렬, 검사기(모르는 숫자·음수인데 '더 받았다'),
  정해진 문구, API 404·캐시, 팀 DB CSV 로 1번 사용자 10월 숫자가 `card_month_status` 와 같은지(CSV 없으면 건너뜀).
- `evaluation/report_eval.py`: 실제 OpenAI 로 데모 사용자 1~5 × 2026-11-05 리포트 — LLM 통과 수, 다시 쓴 수, 응답 시간. 표본 60명 효과 분포도 출력.

## 남기는 것 (빌더가 정할 것)
- 파일 나누기(서비스 함수 위치), 캐시 키 세부, /dev 탭 모양.

## 내가 정한 것 (사용자 확인 필요)
1. 리포트 기준은 `at` 하나: 이번 달(진행 중) + 지난달(확정). 지난 달 리포트는 `at` 을 그 달로 주면 된다.
2. "지난달 실적 달성" = 첫 구간 달성 여부 + 도달한 가장 높은 구간. `user_cards.target_tier_id`(목표 구간)는 엔진이 쓰지 않아 쓰지 않는다.
3. 효과 계산의 프로모션은 실제·추천 모두 "조건이 맞으면 받았다"고 본다 (DB 의 실제 프로모션 기록과 섞지 않는다).
4. 효과 계산에 지금 규칙을 쓴다 (지난달에 규칙이 달랐을 수 있다).
5. OpenAI 에 가맹점 이름을 보내지 않고 업종 이름만 보낸다.
6. 리포트는 저장하지 않고 하루 단위 메모리 캐시만 둔다.

# 월간 리포트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /internal/users/{id}/monthly-report` 가 카드별 이번 달·지난달 숫자, 카드 배치 전략과 근거, 지난달 SOL페이 효과(이유 포함), OpenAI 요약을 한 번에 준다.

**Architecture:** 숫자 계산은 새 `engine/report.py`(순수 함수)와 `PlacementService.monthly_report`, 요약은 추천 페이지 문구 작성기를 물려받은 `engine/chat/report_copy.py`.
SOL페이 효과는 재생 평가를 한 달로 줄인 `report.replay_month` 이고, 카드 고르기는 콜백으로 받아 테스트에서 바꿔 낄 수 있다.

**Tech Stack:** Python 3.13, FastAPI, pytest, openai SDK(Chat Completions, json_schema), uv. 작업 폴더 `~/Desktop/solpay/solpay-ai`.

**Spec:** `docs/superpowers/specs/2026-11-22-monthly-report-design.md`

## Global Constraints

- 숫자는 엔진 값만. LLM 은 문장만 쓴다. 요약 숫자는 사실에 있는 값(챗봇 검사기 `guard.collect_facts`/`unknown_numbers` 의 반올림 허용 규칙)만.
- OpenAI 에 가맹점 이름·사용자 이름을 보내지 않는다 (카드 상품명, 업종 이름, 금액, 일 단위 날짜, 방식 이름만).
- 카드별 프로모션은 응답에 넣지 않는다. 프로모션은 `solpay_effect` 의 promotion 칸에만.
- 효과 total = card + promotion + next_month 차이, 음수도 그대로. 음수면 요약에 덜 받은 금액과 이유를 쓰고 '더 받' 표현 금지.
- FastAPI 는 리포트를 저장하지 않는다. 캐시는 메모리 `(user_id, at.date())`.
- 기본값: `OPENAI_MODEL`=gpt-4o-mini, `REPORT_COPY_TIMEOUT_SEC`=8.
- 테스트 실행은 공용 RDS 를 피한다: `SOLPAY_DATABASE_URL="" SOLPAY_STORE=teamdb OPENAI_API_KEY="" uv run pytest ...`
- 커밋은 사용자가 요청할 때만 (계획서에 커밋 단계 없음).

## Review Focus

1. 지난달 결제가 하나도 없는 카드·사용자 (새 카드, 신규 가입) → 지난달 칸 0, `achieved` False(구간 있으면)/None(무실적), 효과 `null` + `effect_note`. → Task 1·3 테스트.
2. 실적 조건 없는 카드(구간 0원 하나) → 구간 칸 `null`, 0으로 나누거나 '첫 구간까지 0원 모자람'으로 말하지 않기. → Task 1 테스트.
3. 추천이 덜 준 사용자 → 요약에 '더 받' 금지, 덜 받은 금액·이유 포함, 정해진 문구도 같음. → Task 4 테스트.
4. OpenAI 가 모르는 숫자·저장 주장·소비 권유를 쓴 경우 → 한 번 다시 쓰고 그래도면 정해진 문구. → Task 4 테스트.
5. 월초 1일 00시(`at` 이 달의 첫 순간)·이번 달 결제 0건 → 이번 달 칸 0, 지난달은 온전히. → Task 5 테스트.

---

### Task 1: 카드별 이번 달·지난달 숫자

**Files:**
- Create: `engine/report.py`
- Modify: `engine/chat/tools.py` (get_card_status 의 한도 계산을 `report.limits_of` 로 바꿈)
- Test: `tests/test_report.py`

**Interfaces:**
- Produces:
  - `limits_of(card: Card, ledger: CardMonth) -> list[dict]` — `[{"name", "used", "limit", "left"}]`, 지금 `tools.get_card_status` 의 limits 와 같은 값.
  - `tier_info(tiers: list[int], perf: int) -> dict` — `{"first_tier", "tier_reached", "achieved", "short_of_first"}`. 실적 조건 없는 카드(`tiers` 가 비었거나 `[0]`)는 네 칸 모두 None.
  - `card_rows(now: UserState, prev: UserState, catalog: Catalog) -> list[dict]` — 스펙 `cards[]` 모양. `now` 는 이번 달로 roll 된 상태, `prev` 는 지난달로 roll 된 상태. 결제 건수는 각 상태 `cur_rows` 의 카드별 개수.

- [ ] **Step 1: 실패하는 테스트** (`tests/conftest.py` 의 `catalog`·`params`·`USER_CARDS`·`pay`·`at` 사용. 카드 101=생활(300k/500k), 102=외식(300k), 103=국민 교통(200k))

```python
def test_tier_info():
    assert tier_info([300_000, 500_000], 320_000) == {"first_tier": 300_000, "tier_reached": 300_000, "achieved": True, "short_of_first": 0}
    assert tier_info([200_000], 150_000) == {"first_tier": 200_000, "tier_reached": None, "achieved": False, "short_of_first": 50_000}
    assert tier_info([0], 10_000) == {"first_tier": None, "tier_reached": None, "achieved": None, "short_of_first": None}

def test_card_rows_이번_달과_지난달(catalog, params):
    # 9월: 101 에 32만, 103 에 15만 / 10월: 101 에 카페 1만
    # → 101 prev_month.perf 320000·achieved True, this_month.tier_min 300000·perf 10000·next_tier 300000·remaining_to_next 290000
    # → 103 prev_month.short_of_first 50000, this_month.tier_min None
    # → 102 prev_month.payments 0·perf 0·achieved False
    ...
```

- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_report.py -q` → ImportError(engine.report)
- [ ] **Step 3: `engine/report.py` 에 세 함수 구현.** `this_month` 칸: `perf, benefit(=ledger.discount), payments, tier_min, remaining_to_keep, next_tier, remaining_to_next, limits`(이름은 스펙 그대로). `synced_note = issuer != "SHINHAN"`. 무실적 카드는 구간 칸 None. `tools.get_card_status` 의 limits 블록을 `limits_of(card, st)` 호출로 바꾼다(출력 동일).
- [ ] **Step 4: 통과 확인** — `uv run pytest tests/test_report.py tests/test_chat.py -q` → 모두 통과 (챗봇 카드 상태 테스트 그대로).

### Task 2: 카드 배치 전략 근거

**Files:**
- Modify: `engine/service.py` (새 `strategy_info`), `engine/chat/tools.py` (`_month_strategy` 가 `strategy_info` 를 씀), `engine/report.py` (`STRATEGY_DESC`, `REASON_GROUP`, `reason_group`)
- Test: `tests/test_report.py`

**Interfaces:**
- Consumes: 기존 `PlacementService.monthly_strategy`, `rules.resolve`, `tools.STRATEGY_LABEL`(→ `report.py` 로 옮기고 tools 는 import).
- Produces:
  - `PlacementService.strategy_info(user_id: int, at, context=None) -> dict` — `{"current", "label", "description", "chosen_by", "chosen_by_label", "compare_months", "compare": [{"method", "label", "benefit"}]}`.
    chosen_by ∈ `"rule" | "user_confirmed" | "monthly" | "insufficient_history" | "default"`. compare 는 혜택 큰 순, scores 없으면 `[]`·compare_months None.
  - `report.STRATEGY_DESC: dict[str, str]` — params.py 주석 문장 그대로 (first_tier "모든 카드의 첫 구간을 먼저 채운다", main_top "구간 혜택이 가장 큰 주력 카드의 높은 구간부터 채우고 남으면 다른 카드",
    value "남은 예산 안에서 (구간 증분 혜택 − 포기하는 혜택) 합이 최대인 구간 조합", none "실적을 채우지 않고 결제마다 혜택률이 가장 높은 카드", top_tier "1번 카드의 최고 구간부터 채운다").
  - `report.reason_group(code: str) -> str` — RULE→"사용자 규칙", PROMOTION·PROMOTION_CARD→"프로모션", PERFORMANCE·HOLD·BASE_CHANGED→"실적 채우기", 그 밖→"혜택 비교".

- [ ] **Step 1: 실패하는 테스트**

```python
def test_strategy_info_규칙이_있으면_rule(...):   # order 규칙(base_order="none") → chosen_by "rule", label "실적 안 채움"
def test_strategy_info_월간_맞춤_꺼짐이면_default(...):  # Params(adaptive_months=0) → chosen_by "default", compare []
def test_reason_group():
    assert reason_group("HOLD") == "실적 채우기" and reason_group("PROMOTION_CARD") == "프로모션" and reason_group("TIME_BENEFIT") == "혜택 비교"
```
- [ ] **Step 2: 실패 확인** — AttributeError(strategy_info)
- [ ] **Step 3: 구현.** `strategy_info` = 지금 `tools._month_strategy` 로직 + key 값. `_month_strategy` 는 `strategy_info` 결과를 지금 출력 모양(`current`=라벨, `chosen_by`=라벨, `compare_months`, `compare`)으로 바꿔 돌려준다(챗봇 응답 불변).
- [ ] **Step 4: 통과 확인** — `uv run pytest tests/test_report.py tests/test_chat.py -q`

### Task 3: 지난달 SOL페이 효과

**Files:**
- Modify: `engine/report.py` (`replay_month`)
- Test: `tests/test_report.py`

**Interfaces:**
- Produces: `replay_month(start: Callable[[], UserState], payments: list[Payment], choose: Callable[[UserState, Payment], tuple[int, str]], promo: Callable[[int, Payment], int], catalog: Catalog, month: str) -> dict | None`
  - `start()` 은 지난달 1일 직전까지 반영한 새 상태를 돌려준다(세 번 부름: 실제·추천·엔진이 보는 상태). `payments` 는 지난달 결제(시간순).
  - 결제화면 결제(`is_placement`)만 `choose(view, p)` → (카드, 이유 코드). 엔진이 보는 상태에는 결제화면 결제는 바로, 나머지는 `visible_at` 이후에 넣는다(재생 평가 `replay_user` 와 같음).
  - promotion 은 결제화면 결제만 `promo(카드, p)`.
  - next_month = 카드별 `strategy.month_benefit(card, 그 카드로 간 지난달 결제, 지난달 실적, catalog)` 합.
  - 반환: 스펙 `solpay_effect` 모양. `top_changes` 는 카드가 바뀐 결제 중 `diff`(카드 혜택+프로모션) 기준 3건: total < 0 이면 diff 오름차순(덜 받은 결제 먼저), 아니면 내림차순.
    항목 `{"day", "category"(catalog 업종 이름), "amount", "actual_card", "recommended_card", "diff", "why"(reason_group)}`.
    `tier_changes` 는 실제·추천의 도달 구간이 다른 카드: `{"card", "first_tier", "actual_perf", "recommended_perf", "actual_tier", "recommended_tier"}` (스펙 예시의 bool 대신 도달 구간 하한 값, 없으면 None).
  - 결제화면 결제가 0건이면 None.

- [ ] **Step 1: 실패하는 테스트** (conftest 카탈로그, 9월 실적으로 데운 상태)

```python
def test_replay_month_같은_카드면_차이_0(...):          # choose 가 늘 실제 카드 → diff 모두 0, changed_payments 0
def test_replay_month_덜_받으면_음수와_이유(...):       # 카페 1만 원 결제 실제 101(10%) → choose 가 (102, "PERFORMANCE")
    # diff.card == -1000, diff.total == diff.card + diff.promotion + diff.next_month,
    # top_changes[0] == {"category": "카페", "amount": 10000, "actual_card": "생활(가칭)", "recommended_card": "외식(가칭)", "diff": -1000, "why": "실적 채우기", ...}
def test_replay_month_온라인_결제는_바꾸지_않는다(...): # online(...) 결제는 choose 를 부르지 않는다 (choose 가 부르면 실패하는 가짜)
def test_replay_month_결제화면_결제가_없으면_None(...):
def test_replay_month_구간이_달라진_카드(...):          # 103 에 결제를 몰아 첫 구간 20만 도달 → tier_changes 에 recommended_tier 200000, actual_tier None
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** (`dataclasses.replace(p, user_card_id=...)`, heapq 로 늦게 보이는 결제 관리)
- [ ] **Step 4: 통과 확인** — `uv run pytest tests/test_report.py -q`

### Task 4: 요약 문장 (OpenAI·검사·정해진 문구)

**Files:**
- Modify: `engine/chat/page_copy.py` — `PageCopyWriter` 가 클래스 속성 `system`, `schema`, `schema_name`, `prompt_version`, `settings_env`(제한 시간 환경 변수 이름)와 정적 메서드 `check(copy, facts)`, `template(facts)` 를 쓰게 바꿈 (값은 지금 그대로, 동작 불변)
- Create: `engine/chat/report_copy.py`
- Test: `tests/test_report_copy.py` (가짜 클라이언트는 `tests/test_page_copy.FakeClient` 재사용)

**Interfaces:**
- Produces:
  - `facts_of(report: dict) -> dict` — 스펙 '요약 문장'의 사실만 (카드 상품명·업종 이름·금액·날짜·방식). `cards[].name` 외 가맹점 이름 칸 없음.
  - `template_copy(facts: dict) -> dict` — `{"headline": str, "points": list[str]}` (points ≤ 3). 문구 틀은 스펙 예시 그대로:
    "{지난달}월에 카드 혜택 {합계}원을 받았어요." / "추천대로 냈다면 {total}원을 더 받을 수 있었어요({지난달}월 {card+promotion}원, 실적 덕분에 {이번 달}월 {next_month}원 예상)." /
    음수: "추천대로 냈다면 {abs(total)}원 덜 받았어요." + 이유 한 문장(tier_changes 첫 항목이면 "{card}로 실적을 모았지만 {first_tier 만 원 표기} 구간에 닿지 못했어요", 아니면 top_changes 첫 항목의 업종·why).
    효과 None 이면 효과 문장 없이 지난달 혜택 + 이번 달 방식 문장.
  - `check_copy(copy: dict, facts: dict) -> list[str]` — 문제 목록: 형식(headline 문자열·points 1~3개), `guard.unknown_numbers`, `guard.SAVED_CLAIM`·`guard.SPEND_PUSH` 단어, total < 0 인데 "더 받" 포함, total < 0 인데 덜 받은 금액(반올림 허용) 없음.
  - `ReportCopyWriter(PageCopyWriter)` — `prompt_version = "2026-11-22.1"`, `schema_name = "report_copy"`, `settings_env = "REPORT_COPY_TIMEOUT_SEC"`, `write(facts) -> (copy, "llm"|"template", log)`.

- [ ] **Step 1: 실패하는 테스트**

```python
def test_정해진_문구_더_받은_경우():   # total 5180, card 290, promotion 0, next_month 4890 → points 에 "5,180원을 더 받을 수 있었어요" 와 "4,890원 예상"
def test_정해진_문구_덜_받은_경우():   # total -700, tier_changes KB ALL first_tier 400000 → "700원 덜 받았어요" + "40만 원 구간에 닿지 못했어요", "더 받" 없음
def test_검사_모르는_숫자():           # points 에 "12,345원" → 문제 1개
def test_검사_음수인데_더_받았다():     # total -700 인데 "더 받았어요" → 문제
def test_writer_검사_실패면_다시_쓰고_정해진_문구():  # FakeClient 두 번 모두 나쁜 답 → source "template", log["retries"] == 1
def test_writer_키_없으면_정해진_문구():  # client None → "template", reason "no_api_key"
def test_page_copy_동작_불변():         # 기존 tests/test_page_copy.py 전부 통과로 확인
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현.** SYSTEM 프롬프트: 역할(월간 카드 리포트 요약), 숫자 원칙(사실에 있는 숫자만, 계산 금지), 덜 받은 경우 규칙, 소비 권유·저장 주장 금지, 출력 JSON. SCHEMA: `{"headline": string, "points": array of string, maxItems 3}` strict.
- [ ] **Step 4: 통과 확인** — `uv run pytest tests/test_report_copy.py tests/test_page_copy.py tests/test_recommendation_page.py -q`

### Task 5: 서비스·API·캐시·시험 화면·문서

**Files:**
- Modify: `engine/service.py` (`monthly_report`, `self.reports = {}`), `engine/api.py` (라우트, `app.state.report_writer`), `engine/static/dev_console.html` (5번 탭), `README.md`, `postman/solpay-ai.postman_collection.json`
- Test: `tests/test_report.py` (서비스·API), 같은 파일 끝에 팀 DB CSV 통합 테스트(없으면 건너뜀, `tests/test_chat.py` 의 `service` 픽스처 방식)

**Interfaces:**
- Consumes: Task 1~4 의 모든 함수, `PlacementService.preview`, `_all_promotions`, `build_state`.
- Produces: `PlacementService.monthly_report(user_id: int, at, writer=None) -> dict` (스펙 응답 + `copy_source`, `copy_log`, `cached`). 라우트 `GET /internal/users/{user_id}/monthly-report?at=`.
  - 지난달 상태 = 지금 보이는 결제 중 `paid_at < 이번 달 1일` 만으로 만든 상태를 지난달로 roll. 효과의 `start()` = `paid_at < 지난달 1일` 만으로 만든 상태(`build_state` 로 만들어 월간 맞춤 방식이 지난달 기준이 되게) — `dataclasses.replace(context, payments=...)`.
  - `choose` = `engine.rank_state(view, RankRequest(user_id, p.paid_at), rules, weights, 그 시각 진행 중 행사, last_base)` 의 1순위 카드와 `reason_code`.
  - `promo` = 진행 중 행사 중 `value(merchant_id, issuer, card_id, amount, paid_at)` 최대 (merchant_id 없으면 0).
  - 효과 None 이면 `effect_note`: "지난달 결제화면 결제가 없어 비교하지 않았어요".
  - `strategy` = `strategy_info(...)` + `preview(user_id, at)` 에서 `base_card`(`{"user_card_id", "name", "target_tier": 기본 카드 이번 달 실적 바로 위 구간, "remaining"}`),
    `current_order`(`cards[:display_count]` 의 순위·카드·이름), `message`(1순위 카드 안내 문구).
  - `totals` = `{"this_month_benefit": 카드별 this_month.benefit 합, "prev_month_benefit": prev_month.benefit 합}`.

- [ ] **Step 1: 실패하는 테스트**

```python
def test_monthly_report_형식과_캐시(report_svc):    # 키: month, prev_month, cards, strategy, solpay_effect, summary, copy_source "template", cached False → 두 번째 True
def test_monthly_report_월초_0시(report_svc):       # at=2026-10-01 00:00 → this_month perf 모두 0, prev_month 9월 값
def test_api_404_와_응답(...):                      # TestClient: 없는 사용자 404, 있는 사용자 200
def test_팀DB_1번_10월_숫자가_card_month_status_와_같다(service):  # at 2026-11-05 12:00 → 카드별 prev_month.perf·benefit == CSV 2026-10 perf·benefit_amount
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현.** /dev 탭: 버튼 '월간 리포트 보기' → 요약(제목·요점), 카드 표(카드 | 이번 달 실적 | 받은 혜택 | 다음 구간까지 | 지난달 실적 | 지난달 혜택 | 첫 구간 달성), 전략(방식·뜻·고른 근거·비교 표·지금 채우는 카드), 효과(세 부분과 합계, 이유 표), 오른쪽에 응답 JSON·ms (4번 탭 모양을 따름).
  README '하루 일정·신규 카드 추천' 표에 API 한 줄, Postman 에 요청 하나(상태 200, `cards` 배열, `summary.headline` 문자열 검사).
- [ ] **Step 4: 통과 확인** — `uv run pytest -q` 전체 통과 (현재 303 + 새 테스트).

### Task 6: 실제 OpenAI 평가

**Files:**
- Create: `evaluation/report_eval.py` (`evaluation/page_eval.py` 구조를 따름, 저장소는 teamdb 강제)

- [ ] **Step 1: 구현** — 데모 사용자 1~5 × `2026-11-05T12:00+09:00` 리포트를 실제 OpenAI 로: copy_source, 다시 쓴 수, ms, 요약 문장 출력. `--sample 60` 이면 사용자 1~60 효과 total 중앙값·음수 인원·최소·최대만(OpenAI 없이).
- [ ] **Step 2: 실행** — `uv run python -m evaluation.report_eval` (OPENAI_API_KEY 필요) → LLM 통과 수/5 기록. `--sample 60` → 중앙값 +3,735원·음수 10명 근처(사전 측정)인지 확인. 크게 다르면 원인을 보고한다.
- [ ] **Step 3: README 'AI' 절에 평가 결과 한 줄**

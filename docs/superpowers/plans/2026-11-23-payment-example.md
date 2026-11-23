# 결제 화면 예상 혜택 예시를 AI 배치 거래에 맞추기 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 카드 배치 응답에 1순위 카드 문구가 가리키는 거래(`example`)를 담고, 앱 결제 화면의 '이 거래의 예상 혜택'이 그 거래로 계산되게 한다.

**Architecture:** 엔진에 `engine/example.py` 를 새로 두어 `Decision`·`ScenarioSet`·문구 코드로 예시 거래를 고르고, `RankResult.example` → `/internal/rank` 응답 `example` 로 내보낸다. 백엔드는 응답을 그대로 넘긴다. 앱은 순수 함수(`aiEstimateCore.js`, `aiPlacementCore.js`)로 예시 → 계산 요청·안내 줄을 만들고 `PaymentScreen.js` 가 고른다.

**Tech Stack:** Python 3.12 FastAPI·pytest (solpay-ai), React Native·Expo, `node --test` (frontend).

**Spec:** `docs/superpowers/specs/2026-11-23-payment-example-design.md`

## Global Constraints

- 응답 칸 이름 `example`, 키는 정확히 `basis, category_code, category_name, merchant_id, name, amount, prob`.
- `basis` 값은 `promotion` / `benefit` / `schedule` / `likely` 넷뿐.
- `prob` = P(업종) × P(그 가게·브랜드|업종), 소수 셋째 자리 반올림. 금액은 시나리오 금액들의 가운데 값(짝수 개면 아래쪽 가운데).
- `NO_CARD` 면 `example: null`. 백엔드 `FALLBACK` 응답에는 칸이 없다 → 앱은 없음으로 본다.
- 안내 줄 문구(행사일 때만): `이 시간대에 {name}에서 결제할 가능성(약 {p}%)을 곱한 값이 AI 문구의 '약 {N}원'이에요.` p 가 1 미만이면 `1% 미만`.
- 백엔드 코드는 고치지 않는다. QR 결제 시트·AI 문구·배치 계산은 바꾸지 않는다.
- 작업 폴더: 엔진은 `~/Desktop/solpay`(브랜치 `ai/placement-engine`), 앱은 `~/Desktop/solpay-final`(브랜치 `final`). `~/Desktop/solpay` 의 `data/`·`.gitignore`·docx 변경은 다른 세션 것이라 건드리지 않는다.
- 커밋·푸시는 사용자 요청이 있을 때만. 커밋할 때는 경로를 지정해 `git add` 한다.

## Review Focus

1. AI 가 기본 순서(`FALLBACK`)로 답하거나 1순위 카드가 기기 지갑에 없으면 → 예시 없음, 상자는 고정 예시(스타벅스 15,000원). Task 3 테스트.
2. 예시 거래의 AI 계산이 실패하면 → 상자는 고정 예시로 돌아가고 앱 계산을 쓴다 ('조건 확인 필요'가 남지 않음). Task 3 `chooseEstimateScenario` 테스트.
3. 가맹점 번호가 없는 예시(업종만) → 계산 요청에 `merchant_id` 를 넣지 않는다. Task 3 테스트.
4. 가능성이 아주 작거나(0.4%) 1 이상·0 → '1% 미만' / 안내 줄 없음. Task 3 테스트.
5. 행사 문구인데 행사를 준 시나리오를 못 찾음(행사 목록이 비었거나 이름이 다름) → `likely` 로 대신. Task 1 테스트.

---

### Task 1: 엔진 — 예시 거래 고르기 (`engine/example.py`)

**Files:**
- Create: `solpay-ai/engine/example.py`
- Modify: `solpay-ai/engine/catalog.py` (`Catalog.merchant_for`)
- Modify: `solpay-ai/engine/messages.py:81-91` (`_best_benefit` 이 브랜드·금액도 돌려줌, `_benefit_message` 는 그대로 동작)
- Test: `solpay-ai/tests/test_rank_example.py`

**Interfaces:**
- Produces: `rank_example(state: UserState, decision: Decision, scenarios: ScenarioSet, code: str, promotions: list[Promotion], at: datetime) -> dict` — 키는 Global Constraints 대로.
- Produces: `schedule_example(catalog: Catalog, item: ScheduleItem, name: str | None = None) -> dict` — `basis="schedule"`, `prob=1.0`.
- Produces: `Catalog.merchant_for(category: str, brand_code: str | None) -> int | None` — 그 업종·브랜드 코드의 가맹점 중 번호가 가장 작은 것 (없거나 brand_code 가 None 이면 None).
- Produces: `messages._best_benefit(...) -> tuple[Benefit | None, Scenario | None, str | None, int | None]` (혜택, 시나리오, 브랜드 코드, 금액).

고르는 규칙 (1순위 = `decision.first`):
- `code == PROMOTION`: `label = decision.scores[first].promotion_label`. 시나리오마다 `ranker.promotion_value` 와 같은 방식으로 이 라벨의 행사가 이 카드에 주는 기여(`s.prob × share × 평균 금액`)를 세어 가장 큰 (시나리오, 가맹점, 행사)를 고른다. `s.merchants` 가 있으면 그 가맹점들, 없으면 `promo_brands or brands` 의 브랜드마다 `catalog.promo_merchants(p.merchant_ids).get((s.category, b))`. `name = promotion.brand`, `prob = s.prob × share`. 못 찾으면 `likely`.
- `code in (TIME_BENEFIT, AMOUNT_BENEFIT, GENERAL_BENEFIT)`: `_best_benefit` 의 시나리오·브랜드·금액. `merchant_id = catalog.merchant_for(s.category, brand)`, `name` = 그 가맹점의 `brand`(없으면 업종 이름), `prob = s.prob × s.brands[brand]`.
- 그 밖: 가장 확률 높은 시나리오. 브랜드는 `promo_brands or brands` 에서 비중이 가장 큰 키(None 이면 브랜드 없음: `merchant_id=None`, `name`=업종 이름, `prob=s.prob`). `basis` 는 `scenarios.mode == MODE_SCHEDULE` 이면 `schedule`, 아니면 `likely`.

- [ ] **Step 1: 실패하는 테스트 쓰기** — `tests/test_popup.py` 의 `cafe_catalog, CARDS, PROMOS, HOLLYS, MEGA, state_of` 와 `tests/conftest.at` 를 쓴다. `NINE = at(10, 7, 9)`.

```python
def test_행사_문구면_그_행사를_준_가게가_예시다():
    state = state_of(cards=[CARDS[0]])
    scen = ScenarioSet([Scenario("CAFE", 1.0, (6_000,), {}, {None: 1.0},
                                 promo_brands={"HOLLYS": 0.5, None: 0.5})], MODE_TIME, (False, 1))
    d = decide(state, [CARDS[0]], scen, NINE, Params(), PROMOS)
    ex = rank_example(state, d, scen, PROMOTION, PROMOS, NINE)
    assert ex == {"basis": "promotion", "category_code": "CAFE", "category_name": "카페",
                  "merchant_id": HOLLYS, "name": "할리스", "amount": 6_000, "prob": 0.5}
    assert ex["prob"] * 600 == pytest.approx(d.scores[201].promotion)   # 상자 금액 × 가능성 = 문구 금액

def test_가게를_알면_그_가게_확률을_쓴다():          # merchants={HOLLYS: 0.4, MEGA: 0.6}: 라벨은 메가 이벤트(500×0.6 > 600×0.4)
    # → merchant_id MEGA, name "메가MGC커피", prob 0.6
def test_혜택_문구면_문구를_만든_시나리오가_예시다():  # CAFE 0.6 (6,000) brands {"MEGA": 1.0} + REST 0.4 (10,000) {None: 1.0}, NINE
    # → {"basis": "benefit", "category_code": "CAFE", "merchant_id": MEGA, "name": "메가MGC커피", "amount": 6_000, "prob": 0.6}
def test_그_밖의_문구는_가장_가능성_높은_후보다():    # CAFE 0.3 + REST 0.7 (10,000) {None: 1.0}, code PERFORMANCE
    # → {"basis": "likely", "category_code": "REST", "category_name": "음식점", "merchant_id": None, "name": "음식점", "amount": 10_000, "prob": 0.7}
def test_일정_모드에서_그_밖의_문구면_basis_가_schedule():   # 같은 시나리오, MODE_SCHEDULE, code NEUTRAL → basis "schedule"
def test_행사를_못_찾으면_가장_가능성_높은_후보다():    # code PROMOTION, promotions=[] → basis "likely"
def test_금액은_가운데_값이다():                      # amounts (3_000, 6_000, 9_000) → 6_000; (3_000, 9_000) → 3_000
def test_일정_프로모션_카드_예시():
    item = ScheduleItem(1, 1, at(10, 7, 14), at(10, 7, 15), "CAFE", 6_000, brand="MEGA")
    assert schedule_example(cafe_catalog(), item, "메가MGC커피") == {
        "basis": "schedule", "category_code": "CAFE", "category_name": "카페",
        "merchant_id": MEGA, "name": "메가MGC커피", "amount": 6_000, "prob": 1.0}
def test_merchant_for_는_브랜드가_없으면_None():     # merchant_for("CAFE", None) is None, ("CAFE", "MEGA") == MEGA
```

- [ ] **Step 2: 실패 확인** — `cd ~/Desktop/solpay/solpay-ai && .venv/bin/python -m pytest tests/test_rank_example.py -q` → `ModuleNotFoundError: engine.example`.
- [ ] **Step 3: `Catalog.merchant_for`, `_best_benefit` 확장, `engine/example.py` 구현.** `_benefit_message` 는 새 반환값의 앞 두 개만 쓴다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → 전부 PASS. 그리고 `.venv/bin/python -m pytest tests/test_messages.py tests/test_promo_score.py -q` → PASS (기존 문구 그대로).

### Task 2: 엔진 — 응답에 싣기 (`RankResult.example`, `/internal/rank`)

**Files:**
- Modify: `solpay-ai/engine/domain.py:163-181` (`RankResult.example: dict | None = None`)
- Modify: `solpay-ai/engine/service.py:37-126` (세 갈래에서 채움)
- Modify: `solpay-ai/engine/api.py:47-56, 270-286` (`RankResponse.example: dict | None = None`, `example=result.example`)
- Modify: `solpay-ai/openapi.json` (다시 내보냄), `solpay-ai/postman/solpay-ai.postman_collection.json` (배치 요청에 `example` 검사 한 줄), `solpay-ai/README.md`·`docs/상세_기록.md` 의 배치 응답 설명
- Test: `solpay-ai/tests/test_service_api.py`

**Interfaces:**
- Consumes: Task 1 의 `rank_example`, `schedule_example`.
- Produces: `/internal/rank` 응답의 `example` (NO_CARD 면 null).

채우는 곳: 일반 경로 `rank_example(state, decision, scenarios, messages[decision.first].code, promotions, req.at)`, 고정 규칙 경로 `rank_example(..., RULE, ...)`(→ likely/schedule), 일정 프로모션 카드 경로 `schedule_example(self.catalog, item, brand)`.

- [ ] **Step 1: 실패하는 테스트** — `test_service_api.py` 에 추가:

```python
def test_배치_응답에_예시_거래가_있다(svc):
    with client(svc) as c:
        body = c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00"}).json()
    ex = body["example"]
    assert set(ex) == {"basis", "category_code", "category_name", "merchant_id", "name", "amount", "prob"}
    assert ex["basis"] in {"promotion", "benefit", "schedule", "likely"} and ex["amount"] > 0 and 0 < ex["prob"] <= 1
```
`test_카드가_없는_사용자의_배치는_빈_목록이다` 에 `assert body["example"] is None` 추가.

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_service_api.py -q -k "예시 or 빈_목록"` → KeyError 'example'.
- [ ] **Step 3: 구현** (domain·service·api).
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, 이어서 전체 `.venv/bin/python -m pytest -q` → 실패 0 (지금 545 통과·23 건너뜀에 새 테스트가 더해짐).
- [ ] **Step 5: 명세 다시 내보내기** — `.venv/bin/python -m scripts.export_openapi`, `git diff --stat openapi.json` 에 `example` 만 늘어난 것 확인. Postman 배치 요청 검사에 `pm.expect(body).to.have.property('example')` 추가, README·상세_기록 배치 응답 칸 설명에 `example` 한 줄.

### Task 3: 앱 — 예시 거래 순수 함수

**Files:**
- Modify: `frontend/utils/aiPlacementCore.js` (`applyRank` 결과에 `example`)
- Modify: `frontend/utils/aiEstimateCore.js` (`exampleScenario`, `chooseEstimateScenario`, `exampleNote`, `evaluateRequest` 의 `merchantId`)
- Test: `frontend/utils/__tests__/aiPlacementCore.test.mjs`, `frontend/utils/__tests__/aiEstimateCore.test.mjs`

**Interfaces:**
- Produces: `applyRank(...)` 결과에 `example: object | null` — 1순위 카드가 지갑에 있고 `rank.example` 이 있을 때만, 아니면 null.
- Produces: `exampleScenario(example) -> scenario | null` — `{ id: 'ai-example:' + category_code + ':' + (merchant_id ?? '') + ':' + amount, merchant: name, amount, categoryCode, merchantId, aiExample: true, basis, prob, category: /(?!)/, brand: /(?!)/ }`. `category_code`·`amount` 가 없으면 null. (`category`·`brand` 는 앱 계산이 혹시 불려도 아무 혜택도 맞추지 않게 하는 빈 정규식)
- Produces: `chooseEstimateScenario({ scheduleScenario, example, exampleRows, fixed }) -> scenario` — 일정 > (예시가 있고 `exampleRows` 가 비어 있지 않은 객체) > 고정.
- Produces: `exampleNote(example, message) -> string` — `basis==='promotion'` 이고 `0 < prob < 1` 일 때만 Global Constraints 의 문구, N 은 `message` 의 `/약 ([\d,]+)원/`. N 을 찾지 못하면 빈 문자열.
- Produces: `evaluateRequest(scenario)` — `categoryCode` 경로에서 `scenario.merchantId != null` 이면 `merchant_id` 도 넣는다.

- [ ] **Step 1: 실패하는 테스트**

```js
test('AI 1순위가 지갑에 있으면 예시 거래를 넘기고, 없거나 기본 순서면 null', () => {
  const rank = { cards: [{ user_card_id: 9, rank: 1, message: 'm' }], reason_code: 'PROMOTION', example: { category_code: 'CAFE', amount: 6000 } };
  assert.deepEqual(applyRank([{ id: 'a' }], rank, { a: 9 }).example, rank.example);
  assert.equal(applyRank([{ id: 'a' }], rank, { a: 8 }).example, null);
  assert.equal(applyRank([{ id: 'a' }], { ...rank, example: undefined, reason_code: 'FALLBACK' }, { a: 9 }).example, null);
});
test('예시 거래 → 계산 요청: 가맹점이 있으면 함께, 없으면 업종만', () => {
  const ex = { basis: 'promotion', category_code: 'DEPARTMENT_STORE', merchant_id: 67, name: '현대백화점', amount: 77200, prob: 0.041 };
  assert.deepEqual(evaluateRequest(exampleScenario(ex)), { category_code: 'DEPARTMENT_STORE', merchant_id: 67, amount: 77200 });
  assert.deepEqual(evaluateRequest(exampleScenario({ ...ex, merchant_id: null })), { category_code: 'DEPARTMENT_STORE', amount: 77200 });
  assert.equal(exampleScenario({ name: 'x' }), null);
});
test('예시 계산이 오기 전·실패하면 고정 예시, 일정 결제는 늘 일정', () => {
  const fixed = { id: 'coffee' }, sched = { id: 's' }, ex = exampleScenario({ category_code: 'CAFE', amount: 4900 });
  assert.equal(chooseEstimateScenario({ example: ex, exampleRows: null, fixed }), fixed);
  assert.equal(chooseEstimateScenario({ example: ex, exampleRows: {}, fixed }), fixed);
  assert.equal(chooseEstimateScenario({ example: ex, exampleRows: { a: {} }, fixed }), ex);
  assert.equal(chooseEstimateScenario({ scheduleScenario: sched, example: ex, exampleRows: { a: {} }, fixed }), sched);
});
test('안내 줄은 행사 문구이고 가능성이 0~1 사이일 때만', () => {
  const ex = { basis: 'promotion', name: '현대백화점', prob: 0.041 };
  assert.equal(exampleNote(ex, '현대백화점 마이샵 15%로 약 480원을 더 받을 수 있어요!'),
    "이 시간대에 현대백화점에서 결제할 가능성(약 4%)을 곱한 값이 AI 문구의 '약 480원'이에요.");
  assert.match(exampleNote({ ...ex, prob: 0.004 }, '약 30원'), /1% 미만/);
  assert.equal(exampleNote({ ...ex, prob: 1 }, '약 480원'), '');
  assert.equal(exampleNote({ ...ex, basis: 'benefit' }, '약 480원'), '');
});
```

- [ ] **Step 2: 실패 확인** — `cd ~/Desktop/solpay-final/frontend && node --test utils/__tests__/aiPlacementCore.test.mjs utils/__tests__/aiEstimateCore.test.mjs` → 새 테스트 FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, 그리고 `node --test utils/__tests__/*.test.mjs` 전체 PASS (지금 28개 + 새 테스트).

### Task 4: 앱 — 결제 화면에 붙이기와 화면 확인

**Files:**
- Modify: `frontend/screens/PaymentScreen.js:322-339` (시나리오 고르기·예시 계산 불러오기), `:662-703` (칩·안내 줄)
- Modify: `frontend/docs/AI_연동.md` (결제 화면 설명·파일 표)
- (엔진 확인용) `solpay-ai` 을 8041, 백엔드를 8091(`AI_BASE_URL=http://localhost:8041`), 정적 웹 빌드를 19006 에서 띄우고 끝나면 내린다. 사용자 서버(8031·8090·8081)는 건드리지 않는다.

**Interfaces:**
- Consumes: Task 3 의 `exampleScenario`, `chooseEstimateScenario`, `exampleNote`, `applyRank().example`.

동작: `placement.status==='ready'` 이고 일정 결제가 아니면 `exampleScenario(placement.result.example)` 의 AI 계산(`loadAiEstimates`)을 따로 불러 `exampleRows` 에 둔다. 상자 거래는 `chooseEstimateScenario(...)`. 예시를 쓰는 동안 상자 계산값은 `exampleRows`. 안내 줄은 상자 맨 아래(기존 bxFoot 위)에 `exampleNote(example, placement.result.message)` 가 빈 문자열이 아닐 때만. 예시로 바뀌면 결제 코드 문맥(`contextKey`)도 바뀌어 코드가 새로 발급되는 것은 그대로 둔다.

- [ ] **Step 1: 구현.**
- [ ] **Step 2: 앱 테스트·웹 빌드** — `node --test utils/__tests__/*.test.mjs` PASS, `CI=1 EXPO_PUBLIC_API_URL=http://localhost:8091 npx expo export --platform web --output-dir <scratchpad>/web-example` 성공.
- [ ] **Step 3: 화면 확인** — 로컬 시험 계정(`scratchpad/web_account.json`)으로 19006 에서 전체 결제 화면을 열어:
  - 'AI 추천' 문구의 가게와 상자 칩의 가게가 같다 (예: 현대백화점), 1순위 카드가 상자에서도 더 많이 받는다.
  - 행사 문구면 안내 줄이 보이고 퍼센트·금액이 응답(`explain`)과 맞는다.
  - AI 엔진(8041)을 끄고 다시 열면 상자가 스타벅스 15,000원 고정 예시로 나온다.
- [ ] **Step 4: 문서** — `frontend/docs/AI_연동.md` 결제 화면 절에 "예상 혜택 거래 = AI 배치 문구 속 거래(`example`), 없으면 고정 예시" 와 안내 줄 설명, 파일 표 갱신.

### Task 5: 합치기와 마무리 (사용자 요청 시)

- [ ] **Step 1:** 사용자에게 결과를 보이고 커밋 여부를 묻는다.
- [ ] **Step 2 (요청 시):** `~/Desktop/solpay` 에서 Task 1·2 파일과 설계서·계획서만 경로 지정 커밋 → `~/Desktop/solpay-final` 에서 `git merge ai/placement-engine` → 앱 파일 경로 지정 커밋.
- [ ] **Step 3:** final 에서 엔진 545+ 통과, 백엔드 30, 앱 전체 통과 확인. 푸시는 따로 요청받을 때.

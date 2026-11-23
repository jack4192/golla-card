# 홈 일정 카드를 AI 판단에 맞추기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 가 일정을 보고 카드 순서를 정하는 시간대에, 홈 일정 카드·일정 결제 화면·AI 추천 문구가 같은 카드와 같은 거래를 가리키게 한다.

**Architecture:**
- 엔진 `/internal/rank` 에 `record` 옵션을 더한다. false 면 같은 계산을 하고 추천 기록만 남기지 않는다.
- 백엔드는 `/api/ai/rank?record=false` 를 엔진으로 그대로 넘긴다.
- 앱 홈은 일정 창(시작 30분 전 ~ 끝 30분 후)이 열릴 때 미리보기를 한 번 부른다. 응답이 일정 모드이고 업종이 맞으면 AI 1순위 카드와 예시 거래를 보인다.
- 일정에서 들어온 결제 화면도 같은 판단으로 AI 예시 거래와 1순위 카드를 쓴다.

**Tech Stack:** Python 3 / FastAPI / pytest (엔진), Spring Boot 3 / JUnit5 (백엔드), Expo React Native Web / node:test (앱)

**Spec:** `/Users/jinwoo/Desktop/solpay/docs/superpowers/specs/2026-11-23-home-schedule-ai-design.md`

## Global Constraints

- 작업 폴더
  - 엔진: `~/Desktop/solpay/solpay-ai` (브랜치 ai/placement-engine)
  - 백엔드·앱: `~/Desktop/solpay-final/{backend,frontend}` (브랜치 final)
- **커밋·푸시 하지 않는다.** 사용자가 요청할 때만 한다.
  - `git add .` 금지.
  - 다른 세션이 남긴 커밋 안 된 파일은 건드리지 않는다: solpay 의 data/·docs/superpowers 의 다른 문서, final 의 place-classify-app·promotions-db 문서.
- 공용 RDS 금지. 엔진 테스트와 확인 서버는 `SOLPAY_DATABASE_URL=` 로 비워 실행한다. `.env` 값은 출력하지 않는다.
- 사용자가 켠 8031·8090·8081·8080 은 건드리지 않는다. 확인은 8041·8091·19006 에서 한다.
- 일정 창은 **시작 30분 전 ~ 끝 30분 후**(양끝 포함)다. 엔진 `params.schedule_lead_min/tail_min = 30` 과 같다.
- 'AI 가 그 일정을 보고 정함'은 아래가 모두 맞을 때다.
  - 배치 응답이 fallback 아님
  - `version === 'schedule'`
  - `example` 있음
  - `example.category_code === SERVER_CATEGORY[일정 업종]`
  - 1순위 카드가 지갑에 있음
- 홈 문구 (그대로)
  - `{가게} · {금액}원 · {1순위 카드 금액}원 예상 혜택 · AI 계산`
  - 1순위 카드 금액이 0 이하면 `{가게} · {금액}원 · AI 추천`
  - 금액은 `toLocaleString('ko-KR')`, 가게는 `example.name || example.category_name`
- 실패·예외(미리보기·계산 실패, FALLBACK, 조건 불일치)는 모두 지금 동작으로 돌아간다.
- 홈은 창 열쇠가 바뀔 때만 미리보기를 부른다. 1분마다 부르지 않는다.
- 주석·문구는 한국어로 쓴다.
- 테스트 명령 (현재 기준 수)
  - 엔진: `cd ~/Desktop/solpay/solpay-ai && SOLPAY_DATABASE_URL= .venv/bin/python -m pytest -q -p no:cacheprovider` (558 통과·23 건너뜀)
  - 앱: `cd ~/Desktop/solpay-final/frontend && node --test utils/__tests__/*.test.mjs` (33)
  - 백엔드: `cd ~/Desktop/solpay-final/backend && JAVA_HOME=$(/usr/libexec/java_home -v 21) sh gradlew test` (30)

## Review Focus

1. 홈 미리보기 응답이 창 열쇠가 바뀐 뒤에 도착하는 경우 → 옛 응답을 쓰지 않아야 한다(`aiPreview.key === windowKey`). 컴포넌트 안이라 단위 테스트가 없다.
2. 창 안에 업종이 다른 일정 둘이 겹치는 경우 → AI 예시 업종과 같은 행만 AI 카드이고, 다른 행은 지금 계산 그대로다. Task 3 테스트로 고정한다.
3. 데모 모드(서버 주소 없음) → 홈이 미리보기를 부르지 않는다. effect 첫 줄에서 SERVER_MODE 를 확인한다.
4. 일정 결제 화면에서 사용자가 다른 카드를 고른 뒤 → AI 가 다시 바꾸지 않는다(userPicked). 카드 선정 이유는 '지갑에서 선택한 카드…'.
5. 옛 엔진·백엔드(record 모름)와 붙은 경우 → 앱은 그대로 동작하고 기록만 남는다.
   - 옛 RankBody 는 pydantic 기본값이라 모르는 칸을 무시한다(400 이 아님).
   - 옛 백엔드는 모르는 쿼리를 무시한다.
   - 리뷰어가 코드로 확인한다.

---

### Task 1: 엔진 `record` 옵션

**Files:**
- Modify: `solpay-ai/engine/api.py` (RankBody, `/internal/rank`)
- Modify: `solpay-ai/engine/service.py:347-356` (`PlacementService.rank`)
- Test: `solpay-ai/tests/test_service_api.py`
- Docs: `solpay-ai/openapi.json` (`.venv/bin/python -m scripts.export_openapi`), `README.md` 배치 줄, `docs/상세_기록.md` 배치 응답 절, `postman/solpay-ai.postman_collection.json`

**Interfaces:**
- Produces: `RankBody.record: bool = True`. `PlacementService.rank(req: RankRequest, record: bool = True) -> tuple[int | None, RankResult]`. record=False 면 `_log_rank` 를 부르지 않고 `(None, result)` 를 돌려준다.

- [ ] **Step 1: 실패하는 테스트 쓰기** (같은 파일의 `svc` 픽스처, `client`, `AT` 를 쓴다)

```python
def test_record_false면_같은_배치를_주고_기록은_남기지_않는다(svc):
    with client(svc) as c:
        preview = c.post("/internal/rank", json={"user_id": 1, "at": AT, "record": False}).json()
        assert svc.store.logs == [] and preview["recommendation_id"] is None
        real = c.post("/internal/rank", json={"user_id": 1, "at": AT}).json()
    assert real["recommendation_id"] == 1 and len(svc.store.logs) == 1      # 기본값은 기록을 남긴다
    assert [x["user_card_id"] for x in preview["cards"]] == [x["user_card_id"] for x in real["cards"]]
    assert preview["example"] == real["example"] and preview["reason_code"] == real["reason_code"]
```

- [ ] **Step 2: 실패 확인**

Run: `cd ~/Desktop/solpay/solpay-ai && SOLPAY_DATABASE_URL= .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_service_api.py -k record`
Expected: FAIL. `svc.store.logs` 에 1건이 남는다.

- [ ] **Step 3: 구현**
  - `RankBody` 에 `record: bool = True` 를 더한다. 주석: 홈 미리보기는 false, 결제 화면은 기록.
  - 경로는 `svc.rank(req, record=body.record)` 를 부른다.
  - `PlacementService.rank` 는 `not result.cards or not record` 면 `(None, result)` 를 돌려준다.
  - docstring 에 '직전 기본 카드(last_base)를 바꾸지 않으려고 홈 미리보기는 기록하지 않는다'를 적는다.

- [ ] **Step 4: 통과 확인 + 전체**

Run: 엔진 테스트 명령 (Global Constraints)
Expected: 559 통과·23 건너뜀

- [ ] **Step 5: 문서**
  - openapi.json 을 다시 내보낸다. 바뀌는 곳은 RankBody 의 record 하나뿐이어야 한다(`git diff --stat`).
  - README·상세_기록에 'record=false: 같은 계산, 기록 없음, recommendation_id null'을 한 줄씩 적는다.
  - postman 모음에 '카드 배치 미리보기(record=false)' 요청을 더한다. 검사는 `recommendation_id === null` 과 `cards` 가 비어 있지 않음.

### Task 2: 백엔드 `?record=false` 전달

**Files:**
- Modify: `backend/src/main/java/com/paymate/backend/ai/AiController.java:47-52`
- Modify: `backend/src/main/java/com/paymate/backend/ai/AiService.java:73-82`
- Test: `backend/src/test/java/com/paymate/backend/ai/AiServiceTest.java`

**Interfaces:**
- Consumes: Task 1 의 `record` 본문 칸
- Produces: `POST /api/ai/rank?record=false` (기본 true)
  - `AiService.rank(Long userId, boolean explain, boolean record)` 가 본문에 `"record"` 를 늘 싣는다.
  - 기존 `rank(Long, boolean)` 은 `record=true` 로 넘기는 오버로드로 남긴다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

```java
@Test
@DisplayName("미리보기는 엔진 본문에 record=false 를, 기본 배치는 record=true 를 싣는다")
void rankRecordFlag() {
    ai.reply("/internal/rank", 200, "{\"cards\":[]}");
    service.rank(7L, false, false);
    assertThat(ai.last().body()).contains("\"record\":false");
    service.rank(7L, false);
    assertThat(ai.last().body()).contains("\"record\":true");
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ~/Desktop/solpay-final/backend && JAVA_HOME=$(/usr/libexec/java_home -v 21) sh gradlew test --tests '*AiServiceTest*'`
Expected: 컴파일 실패 (`rank(Long, boolean, boolean)` 없음)

- [ ] **Step 3: 구현**
  - 컨트롤러에 `@RequestParam(value = "record", defaultValue = "true") boolean record` 를 받아 `ai.rank(id, explain, record)` 로 넘긴다.
  - 컨트롤러 Javadoc 에 '홈 일정 카드 미리보기는 record=false'를 적는다.
  - FALLBACK 경로는 그대로 둔다.

- [ ] **Step 4: 통과 확인 + 전체**

Run: 백엔드 테스트 명령
Expected: 31 통과

### Task 3: 앱 순수 함수 (일정 창·AI 판단·문구) + 배치 요청

**Files:**
- Create: `frontend/utils/scheduleAiCore.js`
- Test: `frontend/utils/__tests__/scheduleAiCore.test.mjs`
- Modify: `frontend/utils/aiPlacementCore.js` (`applyRank` 결과에 `version`), `frontend/utils/__tests__/aiPlacementCore.test.mjs`
- Modify: `frontend/utils/aiEstimateCore.js:47-51` (`chooseEstimateScenario` 순서), `frontend/utils/__tests__/aiEstimateCore.test.mjs:64`
- Modify: `frontend/utils/api.js` (`aiRankPreview`), `frontend/utils/aiPlacement.js` (`loadPlacementPreview`)

**Interfaces:**
- Consumes: Task 2 의 `POST /api/ai/rank?record=false`. `SERVER_CATEGORY` (`./scheduleCategory.js`).
- Produces (`scheduleAiCore.js`, 가져올 때 `.js` 확장자를 붙인다)
  - `AI_SCHEDULE_WINDOW_MIN = 30`
  - `inAiWindow(row, clock: Date) -> boolean`: row 는 `{ startDate: Date, endDate: Date }`
  - `aiWindowKey(rows, clock: Date, walletKey: string) -> string`
    - 창 안이고 업종이 `SERVER_CATEGORY` 에 있으며 `'OTHER'` 가 아닌 행이 없으면 `''` 를 준다.
    - 있으면 각 행을 `key:cats+:start-end`(ms)로 이어 `#walletKey` 를 붙인다.
  - `scheduleAiExample(result, appCategories: string[]) -> example | null` (Global Constraints 의 판단 기준 중 지갑 조건 제외)
  - `scheduleAiLabel(example, value: number) -> string`
  - `scheduleAiMatch({ row, clock, preview, cards }) -> { card, label, benefitName, category } | null`
    - preview 는 `{ result, estimates }` 다.
    - 창 밖, 예시 없음, estimates 없음, `result.topId` 카드가 cards 에 없음 → null.
    - category 는 row.cats 중 예시 업종과 맞는 앱 업종이다.
  - `applyRank(...)` 결과에 `version: rank?.version ?? null` 을 더한다.
  - `chooseEstimateScenario` 순서: 계산이 온 예시 > 일정 > 고정.
  - `api.aiRankPreview()` 는 `request('/api/ai/rank?record=false', { method: 'POST', auth: true, timeout: AI_RANK_TIMEOUT_MS })` 다.
  - `loadPlacementPreview(walletCards)` 는 `loadPlacement` 와 같은 결과 형태이고 aiRankPreview 를 쓴다. 공통 부분은 함께 쓴다.

- [ ] **Step 1: 실패하는 테스트 쓰기** (`scheduleAiCore.test.mjs`. 날짜는 앱처럼 시간대 없는 로컬 시각 문자열로 만든다)

```js
const t = hm => new Date('2026-11-23T' + hm + ':00');
const row = { key: 'special:22', cats: ['cafe'], startDate: t('17:00'), endDate: t('18:30') };
const ex = { basis: 'schedule', category_code: 'CAFE', merchant_id: 12, name: '메가MGC커피', amount: 4900 };
const result = { version: 'schedule', fallback: false, topId: 'w1', example: ex };
const cards = [{ id: 'w1', name: '신한카드 Discount Plan' }, { id: 'w2', name: 'KB ALL 카드' }];
const estimates = { w1: { value: 500 }, w2: { value: 40 } };

test('일정 창은 시작 30분 전부터 끝 30분 후까지', () => {
  assert.equal(inAiWindow(row, t('16:30')), true);
  assert.equal(inAiWindow(row, t('16:29')), false);
  assert.equal(inAiWindow(row, t('19:00')), true);
  assert.equal(inAiWindow(row, t('19:01')), false);
  assert.equal(inAiWindow({ ...row, startDate: null }, t('17:10')), false);
});

test('창 열쇠는 창 안에 AI 업종 일정이 있을 때만 생기고 1분마다 바뀌지 않는다', () => {
  assert.notEqual(aiWindowKey([row], t('17:02'), 'w1,w2'), '');
  assert.equal(aiWindowKey([row], t('17:02'), 'w1,w2'), aiWindowKey([row], t('17:40'), 'w1,w2'));
  assert.equal(aiWindowKey([row], t('20:00'), 'w1,w2'), '');
  assert.equal(aiWindowKey([{ ...row, cats: ['other'] }], t('17:02'), 'w1'), '');
  assert.equal(aiWindowKey([{ ...row, cats: ['pcroom'] }], t('17:02'), 'w1'), '');
  assert.notEqual(aiWindowKey([row], t('17:02'), 'w1'), aiWindowKey([row], t('17:02'), 'w1,w2'));
});

test('일정 모드이고 업종이 같을 때만 AI 예시를 쓴다', () => {
  assert.equal(scheduleAiExample(result, ['cafe']), ex);
  assert.equal(scheduleAiExample({ ...result, version: 'pattern' }, ['cafe']), null);
  assert.equal(scheduleAiExample({ ...result, fallback: true }, ['cafe']), null);
  assert.equal(scheduleAiExample({ ...result, example: null }, ['cafe']), null);
  assert.equal(scheduleAiExample(result, ['restaurant']), null);
  assert.equal(scheduleAiExample(null, ['cafe']), null);
});

test('홈 문구', () => {
  assert.equal(scheduleAiLabel(ex, 500), '메가MGC커피 · 4,900원 · 500원 예상 혜택 · AI 계산');
  assert.equal(scheduleAiLabel(ex, 0), '메가MGC커피 · 4,900원 · AI 추천');
  assert.equal(scheduleAiLabel({ ...ex, name: null, category_name: '카페' }, 40), '카페 · 4,900원 · 40원 예상 혜택 · AI 계산');
});

test('창 안 같은 업종 일정에만 AI 1순위 카드를 붙인다', () => {
  const label = '메가MGC커피 · 4,900원 · 500원 예상 혜택 · AI 계산';
  assert.deepEqual(scheduleAiMatch({ row, clock: t('17:02'), preview: { result, estimates }, cards }),
    { card: cards[0], label, benefitName: label, category: 'cafe' });
  assert.equal(scheduleAiMatch({ row, clock: t('20:00'), preview: { result, estimates }, cards }), null);
  assert.equal(scheduleAiMatch({ row: { ...row, cats: ['restaurant'] }, clock: t('17:02'), preview: { result, estimates }, cards }), null);
  assert.equal(scheduleAiMatch({ row, clock: t('17:02'), preview: { result, estimates: null }, cards }), null);
  assert.equal(scheduleAiMatch({ row, clock: t('17:02'), preview: { result: { ...result, topId: 'w9' }, estimates }, cards }), null);
  assert.equal(scheduleAiMatch({ row, clock: t('17:02'), preview: null, cards }), null);
});
```

  - `aiPlacementCore.test.mjs` 에 더할 것: `applyRank(cards, { ...rank, version: 'schedule' }, links).version === 'schedule'`, version 이 없으면 `null`.
  - `aiEstimateCore.test.mjs:64` 를 다음 세 줄로 바꾼다.
    - `{ scheduleScenario: sched, example: ex, exampleRows: { a: {} }, fixed }` → `ex`
    - `{ scheduleScenario: sched, example: ex, exampleRows: null, fixed }` → `sched`
    - `{ scheduleScenario: sched, example: null, exampleRows: { a: {} }, fixed }` → `sched`

- [ ] **Step 2: 실패 확인**

Run: 앱 테스트 명령
Expected: FAIL. `scheduleAiCore.js` 가 없고, version 이 undefined 이며, 일정이 예시보다 앞선다.

- [ ] **Step 3: 구현.** 위 Interfaces 그대로. 판단 기준은 Global Constraints 의 문구를 주석으로 단다.

- [ ] **Step 4: 통과 확인**

Run: 앱 테스트 명령
Expected: 모두 통과 (33 + 새 테스트)

### Task 4: 홈 일정 카드·일정 결제 화면 연결 + 문서

**Files:**
- Modify: `frontend/components/TodaySchedulePanel.js` (상태, effect, timeline 뒤처리)
- Modify: `frontend/screens/PaymentScreen.js:346-372, 422-439, 682-690, 737-745`
- Docs: `frontend/docs/AI_연동.md` (홈 일정 카드 절, 일정 결제 화면, 테스트 수)

**Interfaces:**
- Consumes: Task 3 의 `aiWindowKey`, `scheduleAiExample`, `scheduleAiMatch`, `loadPlacementPreview`, `chooseEstimateScenario`, 기존 `exampleScenario`·`loadAiEstimates`

- [ ] **Step 1: TodaySchedulePanel**
  - 지금 만드는 timeline 을 `baseTimeline` 으로 이름을 바꾼다.
  - `walletKey` 를 그 위로 올린다.
  - `windowKey = SERVER_MODE ? aiWindowKey(baseTimeline, clock, walletKey) : ''`
  - 상태 `aiPreview = { key: '', result: null, estimates: null }`
  - effect([windowKey])
    - windowKey 가 비면 아무것도 하지 않는다.
    - 아니면 `loadPlacementPreview(cards)` 를 부른다.
    - 응답이 `scheduleAiExample(result, 창 안 행들의 cats)` 를 통과하면 `loadAiEstimates(exampleScenario(result.example))` 까지 받아 `{ key: windowKey, result, estimates }` 로 둔다.
    - 실패하면 `{ key: windowKey, result: null, estimates: null }`.
    - 열쇠가 바뀌면 진행 중인 응답은 버린다.
  - `preview = aiPreview.key === windowKey ? aiPreview : null`
  - `timeline = baseTimeline.map(row => scheduleAiMatch({ row, clock, preview, cards }) ? { ...row, match: that } : row)`
  - 아래 코드(firstMatch, currentMatch, windowRows, payFor 등)는 이 timeline 을 그대로 쓴다.
  - 업종 계산 effect(categoryKey)는 바꾸지 않는다.

- [ ] **Step 2: PaymentScreen (일정에서 들어옴)**
  - `aiExample`
    - 준비됨이고 일정이면 `scheduleAiExample(placement.result, [schedule.category])`
    - 준비됨이고 일정이 아니면 지금처럼 `placement.result?.example`
    - 아니면 null
  - `scheduleAi = Boolean(scheduleScenario && aiExample)`
  - 349줄 주석은 '일정 결제도 AI 가 그 일정을 보고 정했으면 그 거래 (2026-11-23 홈 일정 카드 설계서)'로 고친다.
  - 배치 effect
    - 조건 `!scheduleScenario` 를 `(!scheduleScenario || scheduleAiExample(result, [schedule.category]))` 로 바꾼다.
    - 428줄의 낡은 주석('앱 일정은 아직 AI 가 모른다')을 고친다.
  - 상자 아래 줄의 앞부분: `scenario.aiExample ? exampleBasisLine(scenario.basis) : scheduleScenario ? '일정 업종에 맞춘 결제 예시예요. ' : ''`
  - 카드 선정 이유: 첫 조건 `scheduleScenario` 를 `scheduleScenario && !scheduleAi` 로 바꾼다. 그러면 AI 1순위면 일반 결제와 같은 AI 문구가 나온다.

- [ ] **Step 3: 빌드·테스트 확인**

Run: 앱 테스트 명령, 그리고 `cd ~/Desktop/solpay-final/frontend && EXPO_PUBLIC_API_URL=http://localhost:8091 npx expo export -p web --output-dir /private/tmp/claude-501/-Users-jinwoo-Downloads---------/04cb4223-a5f4-49d4-b2cd-59c9b14e384b/scratchpad/web-home`
Expected: 테스트 모두 통과, 내보내기 성공 (오류 없음)

- [ ] **Step 4: 문서.** `AI_연동.md` 에 아래를 적는다.
  - 홈 일정 카드 규칙: 창·판단 기준·문구·미리보기(record=false)
  - 일정 결제 화면의 우선순위
  - 테스트 수

### Task 5: 화면 확인 (코드 없음)

- [ ] **Step 1: 확인 서버 띄우기** (모두 내가 띄우고 끝나면 내린다)
  - AI 8041: `~/Desktop/solpay/solpay-ai`, 환경 `SOLPAY_STORE=db SOLPAY_DATABASE_URL= POSTGRES_DB=solpay_backend SOLPAY_INTERNAL_TOKEN=<backend/.env AI_INTERNAL_TOKEN>`
  - 백엔드 8091: scratchpad `final-check/backend` 를 final 작업 트리 backend 로 다시 맞춘다(rsync, build·.gradle 제외). 그 뒤 `AI_BASE_URL=http://localhost:8041 SERVER_PORT=8091` 로 띄운다.
  - 앱 19006: Task 4 의 `web-home` 을 `python3 -m http.server 19006` 으로 띄운다. 브라우저는 `localhost:19006` 으로 연다(CORS).
- [ ] **Step 2: 임시 일정.** 시험 계정에 지금 시각을 덮는 카페 일정(시작 = 지금 정각 또는 반, 길이 90분)을 8091 `POST /api/schedules` 로 넣는다(사용자 승인됨). 번호를 적어 둔다.
- [ ] **Step 3: 행사 없을 때 (늘 AI)**
  - 8041 이 막 켜져 일정 행사를 아직 모르는 상태에서 홈을 연다.
  - 기대
    - '지금 일정에 맞는 카드예요' 카드 = 하단 결제 탭 → 혜택 자세히 보기의 AI 1순위 카드
    - 문구 = `{가게} · 4,900원 대 금액 · …`
    - 네트워크에 `/api/ai/rank?record=false` 1회, 응답 `recommendation_id` null
- [ ] **Step 4: 행사 있을 때**
  - 일정 맞춤 추천 화면(프로모션 탭)을 연 뒤 메인으로 간다.
  - 기대
    - 홈: `신한카드 Discount Plan` · `메가MGC커피 · 4,900원 · 500원 예상 혜택 · AI 계산`
    - '이 카드로 결제' → 결제 시트 카드도 Discount Plan
    - 혜택 자세히 보기: `메가MGC커피 · 4,900원`, Discount Plan 500원 vs KB ALL 40원, '오늘 일정에 맞춘 거래로 계산했어요.', 카드 선정 이유가 AI 문구
    - 하단 결제 탭 경로도 같다.
- [ ] **Step 5: 기록 확인.** 홈을 여러 번 열어도 로컬 `solpay_backend` 의 recommendation_logs 행 수는 결제 화면을 열 때만 는다. psql 로 홈 전후 행 수를 비교한다.
- [ ] **Step 6: 정리**
  - 임시 일정을 지우고, AI 일정이 원래대로(대중교통 20:00~21:00만)인지 확인한다.
  - 8041·8091·19006 을 내린다.

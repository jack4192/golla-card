# 일정 맞춤 추천 바로잡기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 세 가지를 바로잡는다.
- 누락 카드 혜택 6줄을 모든 카드 데이터 사본에 되살린다.
- 맞춤 추천 전에 AI 의 오늘 일정을 서버와 맞춘다.
- 카드 추천 탭이 처음부터 한 장만 보이게 한다.

**Architecture:**
- 데이터는 원본 CSV(`data/config/card_db`)를 고친다.
  - 같은 내용을 팀 DB 내보내기 3곳에 복사하고, 같은 내용의 SQL 하나를 로컬 DB 2곳에 넣는다(RDS 는 사용자).
  - 앱 40장 JSON 에도 같은 혜택을 더한다.
- 백엔드는 추천 경로 앞에서 `ScheduleAiSync.ensureSynced` 를 부른다.
- 앱은 순수 함수 `cardSource` 로 불러오는 중·AI·앱 계산 가운데 무엇을 보일지 정한다.

**Tech Stack:** Python CSV/pytest (data·엔진), Postgres(docker solpay-db), Spring Boot/JUnit5, Expo RN web/node:test

**Spec:** `/Users/jinwoo/Desktop/solpay/docs/superpowers/specs/2026-11-23-recommend-fixes-design.md`

## Global Constraints

- **브랜치와 폴더**
  - 데이터·엔진·설계 문서: `~/Desktop/solpay`(ai/placement-engine)
  - 백엔드·앱·SQL: `~/Desktop/solpay-final`(final)
  - 커밋·푸시는 사용자가 요청할 때만 한다. `git add .` 은 쓰지 않는다.
- **건드리지 않는 것**
  - 다른 세션의 커밋 안 된 파일: solpay 의 `data/generate/*`·`data/README.md`·`data/tests/test_export_db.py`·`data/config/v2*`·`db/`, final 의 place-classify-app 문서
- **공용 RDS 는 쓰지 않는다.** 엔진 테스트는 `SOLPAY_DATABASE_URL=` 로 실행한다. `.env` 값은 출력하지 않는다.
- **사용자 서버(8031·8090·8081)는 끄지 않는다.**
  - 확인 서버: AI 8041, 백엔드 8091, 정적 앱 19016. 19006 은 다른 세션이 쓰고 있다.
  - 확인 서버는 v2.1 설정이다: `POSTGRES_DB=solpay_v21 SOLPAY_ARTIFACTS=artifacts/v2.1`, 백엔드 `.env` 는 이미 solpay_v21.
- **새 번호와 값은 설계서 표 그대로 쓴다.**
  - 혜택 284~289 순서: ① 나라사랑 CGV, ② 나라사랑 테마파크, ③ Discount Plan 테마파크, ④ Discount Plan+ 테마파크, ⑤ SOL메이트, ⑥ SOL LINK
  - 구간 674~694, 대상 662~674
  - 부가서비스 14번(나라사랑 테마파크)은 지운다.
- **나라사랑카드는 계속 추천 제외다.** `engine/recommend.py` 의 RESTRICTED 는 그대로 둔다.
- **테스트 명령과 지금 수**
  - data: `cd ~/Desktop/solpay/data && uv run pytest -q` (지금 수는 실행해서 적는다)
  - 엔진: `cd ~/Desktop/solpay/solpay-ai && SOLPAY_DATABASE_URL= .venv/bin/python -m pytest -q -p no:cacheprovider`
  - 백엔드: `cd ~/Desktop/solpay-final/backend && JAVA_HOME=$(/usr/libexec/java_home -v 21) sh gradlew test` (43)
  - 앱: `cd ~/Desktop/solpay-final/frontend && node --test utils/__tests__/*.test.mjs` (51)

## Review Focus

1. **SQL 을 두 번 실행해도 같은지, 그리고 자동 번호.**
   - 이미 넣은 DB 에 다시 실행하면 중복이 없어야 한다.
   - 새 행 뒤 다음 자동 번호가 겹치지 않아야 한다(setval).
2. **ensureSynced 비교.**
   - AI 응답의 시각 형식("18:00")과 서버 항목 형식이 같아야 한다.
   - 금액·브랜드가 없을 때(null)도 같다고 봐야 한다.
   - 그러지 않으면 매번 PUT 하고 → 매번 OpenAI 를 새로 부른다.
3. **AI 가 꺼졌을 때.** 추천 화면은 지금처럼 실패를 보여야 하고, 백엔드는 500 이 아니어야 한다.
4. **카드 추천 탭.**
   - AI 가 카드를 주지 않는 날(프로모션 탭만 있는 날)에 불러오는 중이 끝나지 않으면 안 된다.
   - 오늘이 아닌 날짜(scheduleDate)는 AI 를 부르지 않으니 바로 앱 계산을 보여야 한다.
5. **앱 JSON note 형식.** 카드 상세 '혜택 조건'이 기존 항목처럼 보여야 한다(전월 구간 줄).

---

### Task 1: 카드 혜택 6줄 (원본·내보내기·SQL·로컬 DB·앱 JSON)

**Files:**
- Modify: `~/Desktop/solpay/data/config/card_db/{benefits,benefit_tiers,benefit_targets,card_perks}.csv`
- Test: `~/Desktop/solpay/data/tests/test_card_db_restored.py` (새 파일)
- Copy: 위 4개 csv → `~/Desktop/solpay/카드서비스_DB_1년{,_v2,_v2.1}/` (깃 밖)
- Create: `~/Desktop/solpay-final/backend/shared-db/restore_card_benefits_20261123.sql`
- Modify: `~/Desktop/solpay-final/frontend/data/cardCatalog40.json`
- Also: final 쪽 `data/config/card_db` 는 커밋할 때 ai 를 합치면 따라온다. 지금 final 작업 트리에는 손대지 않는다.

- [ ] **Step 1: 실패하는 테스트** (`test_card_db_restored.py`. config CSV 를 읽는다)

```python
def test_누락_혜택_6줄이_원본에_있다():
    b = {r["benefit_id"]: r for r in rows("benefits.csv")}
    assert [b[str(i)]["card_id"] for i in range(284, 290)] == ["11", "11", "1", "2", "13", "14"]
    assert b["284"]["value_type"] == "FIXED" and b["289"]["pay_type"] == "PAY"
    tiers = [t for t in rows("benefit_tiers.csv") if t["benefit_id"] == "284"]
    assert {t["tier_id"] for t in tiers} == {"34", "35", "36", "37", "38"} and {t["value"] for t in tiers} == {"5000"}
    assert {t["monthly_limit"] for t in rows("benefit_tiers.csv") if t["benefit_id"] == "288"} == {"2000"}
    targets = {(t["benefit_id"], t["category"], t["merchant_name"]) for t in rows("benefit_targets.csv")}
    assert ("284", "MOVIE", "CGV") in targets and ("288", "MEMBERSHIP", "쿠팡 로켓와우") in targets
    assert "14" not in {p["perk_id"] for p in rows("card_perks.csv")}
```

- [ ] **Step 2: 실패 확인.** data 테스트 명령(이 파일만) → FAIL (284 없음)
- [ ] **Step 3: 원본 CSV 고치기.**
  - scratchpad `benefit_sim/add_rows.py` 와 같은 값으로 원본 4개 표에 행을 더한다.
  - BOM 과 열 순서는 원본 그대로 둔다. 스크립트는 config 디렉터리를 인자로 받는다.
- [ ] **Step 4: 통과 확인 + data 전체.**
- [ ] **Step 5: 팀 DB 내보내기 3곳에 4개 csv 복사.** `cmp` 로 원본과 같은지 확인한다.
- [ ] **Step 6: SQL 파일 쓰기.**
  - INSERT 는 `ON CONFLICT (pk) DO NOTHING` 이고 부가서비스 14번은 DELETE 다.
  - 표마다 `setval(pg_get_serial_sequence(...), max(id))` 를 넣는다. 자동 번호 열이 없으면 건너뛴다.
  - 한 트랜잭션(BEGIN/COMMIT)으로 묶는다.
  - 머리말에 '사용자가 RDS 에 직접 실행, app_ai 는 쓰기 권한 없음'을 적는다.
- [ ] **Step 7: 로컬 DB 2곳에 실행하고, 두 번째 실행도 확인.**
  - 대상은 `solpay_backend`·`solpay_v21` 이다.
  - 혜택·구간·대상 수가 +6·+21·+13, 부가서비스가 −1 이고, 두 번째 실행 뒤에도 같아야 한다.
- [ ] **Step 8: 앱 JSON.**
  - 카드 1·2·11·13·14 의 benefits 에 항목 {benefitId, name, type, note} 를 더한다. type 은 할인/캐시백/적립이다.
  - note 는 기존 형식을 따른다: '최소 결제 …원', '대상 …', 구간마다 '전월 N원 이상 · 값 · 월 혜택 한도 …원 · 월 N회 · 건당 한도 …원'.
  - 앱 테스트 명령으로 확인하고, JSON 을 파싱해 5장에 새 benefitId 가 있는지 본다.
- [ ] **Step 9: 엔진 확인.** 엔진 전체 테스트를 돌리고, 카탈로그를 읽어 아래를 출력해 본다(테스트 파일 아님).
  - 나라사랑 MOVIE
  - Discount Plan AMUSEMENT_PARK
  - SOL메이트 DIGITAL_SUBSCRIPTION·MEMBERSHIP

### Task 2: 백엔드 추천 전 일정 맞추기

**Files:** `backend/src/main/java/com/paymate/backend/ai/ScheduleAiSync.java`, `AiController.java:108-111`, Test `ScheduleAiSyncTest.java`

**Interfaces:** `public void ensureSynced(Long userId, LocalDate day)`
- AI 응답(`ai.schedule` 의 JSON 글자 `{"day":..,"items":[{start,end,category,amount,brand}]}`)을 Jackson 으로 읽는다.
- `itemsFor` 결과와 (start,end,category,amount,brand) 목록이 같으면 아무것도 하지 않는다. 다르면 `ai.putSchedule(userId, day, expected)` 를 부른다.
- 예외는 잡아 경고 로그만 남긴다.

- [ ] **Step 1: 실패하는 테스트 3개** (기존 setUp·stored 사용)
  - `ensureSyncedSkipsWhenSame`: AI 가 같은 항목(brand 없음은 null)을 주면 `verify(ai, never()).putSchedule(...)`
  - `ensureSyncedPutsWhenDifferent`: AI 가 빈 목록이면 `putSchedule(7L, DAY, items)` 를 1번
  - `ensureSyncedSwallowsErrors`: `ai.schedule` 이 AiException 을 던져도 예외 없음, putSchedule 없음
- [ ] **Step 2: 실패 확인** (`--tests '*ScheduleAiSyncTest*'`, 컴파일 실패)
- [ ] **Step 3: 구현.**
  - 컨트롤러 `recommendationPage` 가 `scheduleSync.ensureSynced(authUser.getId(), ai.today())` 를 먼저 부른다.
  - Javadoc 에 이유를 적는다: 서버 재시작·AI 꺼짐·옛 백엔드로 저장한 일정이 AI 에 없으면 평소 소비로 추천됨.
- [ ] **Step 4: 통과 + 백엔드 전체** (46)

### Task 3: 앱 카드 추천 탭 불러오는 중

**Files:** `frontend/utils/aiRecommendCore.js`, Test `frontend/utils/__tests__/aiRecommendCore.test.mjs`, `frontend/screens/RoutineRecommendationScreen.js`

**Interfaces:** `cardSource({ serverMode, asksAi, aiState, aiCard }) -> 'loading' | 'ai' | 'local'`
- asksAi = 서버 모드이고 오늘 날짜(화면이 AI 를 부르는 경우)
- aiState 는 'loading' | 'ready' | 'failed'
- 판단 순서:
  - asksAi 가 아니면 local
  - aiState 가 loading 이면 loading
  - ready 이고 aiCard 가 있으면 ai
  - 그 밖은 local

- [ ] **Step 1: 실패하는 테스트**

```js
test('카드 추천 탭: AI 를 묻는 동안은 불러오는 중, 답이 오면 AI 카드, 실패·카드 없음·데모·다른 날은 앱 계산', () => {
  assert.equal(cardSource({ asksAi: true, aiState: 'loading', aiCard: null }), 'loading');
  assert.equal(cardSource({ asksAi: true, aiState: 'ready', aiCard: { card: {} } }), 'ai');
  assert.equal(cardSource({ asksAi: true, aiState: 'ready', aiCard: null }), 'local');
  assert.equal(cardSource({ asksAi: true, aiState: 'failed', aiCard: null }), 'local');
  assert.equal(cardSource({ asksAi: false, aiState: 'loading', aiCard: null }), 'local');
});
```

- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현 + 화면.**
  - aiState 상태를 두고, 요청 시작 시 loading, 성공 시 ready, 실패 시 failed 로 바꾼다.
  - recommendations 의 card 를 cardSource 로 고른다. loading 이면 카드 자리에 `ActivityIndicator` 와 'AI가 추천 카드를 고르고 있어요'를 보인다.
  - 프로모션 탭은 지금 그대로 둔다.
  - 연말 결산 기록 effect 가 loading 중의 앱 계산 카드를 기록하지 않게 한다(selected 가 없음).
- [ ] **Step 4: 통과 + 앱 전체 + 웹 내보내기**

### Task 4: 문서·확인

- [ ] **Step 1: 문서.**
  - `frontend/docs/AI_연동.md`: 카드 추천 탭 불러오는 중, 추천 전 일정 맞추기
  - `backend/docs/AI_연동.md`: recommendation-page 앞 일정 맞추기
  - 설계서 끝에 실행 결과 수치를 적는다.
- [ ] **Step 2: 전체 리뷰** (opus, executing-plans 방식)
- [ ] **Step 3: 화면 확인** (v2.1 확인 서버)
  - 시험 계정(v2.1 에 있는 계정, 없으면 데모 1번)으로 일정 맞춤 추천 카드 탭이 처음부터 한 장만 보이는지 본다.
  - 백엔드 로그에서 일정 맞추기 PUT 이 다를 때만 나가는지 본다.
  - 카드 탭 상세에 나라사랑 CGV·테마파크 혜택이 보이는지 본다.
- [ ] **Step 4: 정리.** 확인 서버를 끈다. 사용자에게 RDS SQL 실행 방법과 v2.1 서버 명령을 알린다.

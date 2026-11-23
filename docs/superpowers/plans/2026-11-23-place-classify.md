# 일정 직접 입력 업종·가맹점 자동 분류 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일정 직접 입력의 짧은 말("스벅", "헬스장")을 업종·브랜드로 분류하는 API 를 만들고, 일정에 브랜드를 저장해 카드·프로모션 추천에 반영하며, 결제 데모에서 입력→분류 칩→추천까지 시연한다.

**Architecture:** 분류는 새 `engine/place.py`(규칙: 가맹점·별칭·업종 검색)와 `engine/chat/place_llm.py`(OpenAI 보조)를 `PlacementService.classify_place` 가 묶는다. 일정 항목에 선택 칸 `brand` 를 더해 저장소·배치·추천 페이지·팝업이 쓴다. 결제 데모는 프록시 API 와 화면만 더한다.

**Tech Stack:** Python 3.13, FastAPI, pydantic, openai SDK(json_schema), pytest, 바닐라 JS(결제 데모·/dev). 코드: `solpay-ai/`, `demo/`.

**Spec:** `docs/superpowers/specs/2026-11-23-place-classify-design.md`

## Global Constraints

- 입력 원문은 저장하지 않고 로그에도 남기지 않는다. OpenAI 로는 `privacy.redact` 를 거친 40자 이내 글만 보낸다.
- 업종 목록 = `put_schedule` 이 받는 `catalog.category_names` 중 `ALL` 제외. 브랜드 목록 = 카탈로그 가맹점의 `brand_code` 집합. 목록 밖 값은 쓰지 않는다.
- 확신 없이 틀린 브랜드를 붙이지 않는다: 여러 브랜드가 걸리면 brand=null + candidates.
- 일반 업종 말("백화점")은 업종만, brand=null.
- OpenAI: `OPENAI_MODEL` 기본 gpt-4o-mini, temperature 0, `PLACE_CLASSIFY_TIMEOUT_SEC` 기본 5. 실패·키 없음 → `source="none"`.
- 일정의 `brand` 는 선택 칸이다. 브랜드 없는 일정(예전 요청)은 지금과 똑같이 동작한다.
- 테스트는 `cd solpay-ai && SOLPAY_DATABASE_URL="" SOLPAY_STORE=teamdb OPENAI_API_KEY="" uv run pytest -q -p no:cacheprovider ...` (공용 RDS·OpenAI 금지). 데모 테스트는 `cd demo && PYTHONPATH=$PWD uv run --no-project --with-requirements requirements.txt --with pytest pytest -q`.
- 작업은 별도 worktree 브랜치에서 (원래 작업 트리에 다른 세션의 커밋 전 변경이 있음).

## Review Focus

1. 빈 글·공백뿐인 글 → API 422 ("가게 이름을 입력해 주세요"). → Task 3 테스트.
2. 전화번호 같은 개인정보가 섞인 글 → OpenAI 로 가는 글에서 가려지고, 서비스 기록(`log`)에 원문이 없다. → Task 2 테스트.
3. 여러 업종에 걸치는 짧은 말("GS" → GS25 편의점 / GS칼텍스 주유) → brand=null, candidates 에 둘 다. → Task 1 테스트.
4. OpenAI 가 목록 밖 업종·브랜드를 돌려줌 → 업종 비움(후보로만)·브랜드 null. → Task 2 테스트.
5. 브랜드 없는 예전 형식 일정 저장·조회 → 그대로 동작하고 응답 brand=null. → Task 3 테스트.

---

### Task 1: 규칙 분류 (가맹점·별칭·업종 검색)와 금액 힌트

**Files:**
- Create: `solpay-ai/engine/place.py`
- Test: `solpay-ai/tests/test_place.py`

**Interfaces:**
- Produces:
  - `clean_text(text: str) -> str` — 앞뒤 공백 제거, `privacy.redact`, 40자 자르기.
  - `@dataclass PlaceMatch: category: str | None; brand: str | None (brand_code); brand_name: str | None; candidates: list[dict]; exact: bool` — candidates 항목은 `{"category", "category_name", "brand", "brand_name"}`.
  - `match_place(text: str, catalog: Catalog) -> PlaceMatch` — 정확 일치(가맹점 이름·브랜드 이름·`catalog.aliases`) 한 브랜드 → exact=True·category·brand. 업종 이름 일치(`find_categories`) → category 만. 부분 일치가 여러 (브랜드, 업종)이면 brand=None·category=None·candidates. 아무것도 없으면 빈 PlaceMatch.
  - `amount_hint(payments: list[Payment], catalog: Catalog, category: str, brand: str | None, at: datetime, priors: Priors) -> int` — 최근 90일 현장 결제 중 그 brand 중앙값 → 없으면 그 category 중앙값 → 없으면 `priors.amount_median(category)`; 100원 단위 반올림.

- [ ] **Step 1: 실패하는 테스트** (팀 DB CSV 카탈로그가 필요하면 `tests/test_chat.py` 의 `service` 픽스처처럼 없으면 건너뜀)
```python
def test_브랜드_별칭_정확_일치(): # "스타벅스","스벅" → CAFE·스타벅스 brand, exact; "메가커피" → 메가MGC커피; "올리브영" → HNB; "신세계백화점" → DEPARTMENT_STORE
def test_업종_이름만이면_브랜드_없음(): # "백화점" → category DEPARTMENT_STORE, brand None
def test_여러_브랜드면_후보만(): # "GS" → brand None, category None, candidates 에 CONVENIENCE(GS25) 와 FUEL(GS칼텍스 등) 모두
def test_못_찾으면_빈_결과(): # "헬스장", "친구랑 저녁" → category None, brand None, candidates []
def test_clean_text(): # "  스타벅스  " → "스타벅스"; 41자 → 40자; "010-1234-5678 스벅" 의 전화번호는 가려짐
def test_amount_hint_순서(): # 브랜드 결제 3건(5,000/6,500/7,000) → 6,500; 브랜드 없고 업종 결제만 → 업종 중앙값; 둘 다 없음 → priors 중앙값
```
- [ ] **Step 2: 실패 확인** — ImportError(engine.place)
- [ ] **Step 3: 구현** — `engine/chat/search.py` 의 `norm`·`find_merchants`·`find_categories` 를 재사용한다 (검색 규칙을 복사하지 않는다).
- [ ] **Step 4: 통과 확인** — `tests/test_place.py`

### Task 2: OpenAI 보조 분류와 서비스 조립

**Files:**
- Create: `solpay-ai/engine/chat/place_llm.py`
- Modify: `solpay-ai/engine/service.py` (`classify_place`, `self.place_cache = {}`)
- Test: `solpay-ai/tests/test_place.py`

**Interfaces:**
- Consumes: Task 1 의 `clean_text`, `match_place`, `amount_hint`. 설정은 `engine.chat.page_copy.CopySettings.from_env("PLACE_CLASSIFY_TIMEOUT_SEC")` (기본 timeout 은 5초가 되게 env 기본값 처리), 가짜 클라이언트는 `tests/test_page_copy.FakeClient`.
- Produces:
  - `PlaceLLM(client, settings)` with `classify(text: str, categories: dict[str, str], brands: dict[str, str]) -> dict | None` — json_schema 출력 `{"category": <categories 키 | "UNKNOWN">, "brand": <brands 키 | null>, "confidence": "high"|"low"}`. 목록 밖 category → "UNKNOWN", 목록 밖 brand → None. 예외·시간 초과·client None → None. `prompt_version = "2026-11-23.1"`.
  - `PlacementService.classify_place(text: str, user_id: int | None = None, at=None, llm: PlaceLLM | None = None) -> dict` — 응답 `{"category", "category_name", "brand", "brand_name", "source": "search"|"llm"|"none", "candidates", "amount_hint", "ms"}`.
    순서: `clean_text` → `match_place`(exact 이거나 category 있음 → search) → 아니면 `llm.classify`(high 이고 UNKNOWN 아님 → llm; low → category·brand 비우고 candidates=[그 후보]) → 아니면 none (candidates 는 match_place 후보 유지).
    `self.place_cache[clean_text]` 에 사용자와 무관한 분류 결과를 두고 재사용 (OpenAI 한 번). `amount_hint` 는 user_id 가 있을 때만 그 사람 결제로, 없으면 priors 로. 원문은 어떤 기록에도 넣지 않는다.

- [ ] **Step 1: 실패하는 테스트**
```python
def test_검색으로_찾으면_OpenAI_안_부름():      # FakeClient 호출 0, source "search"
def test_검색_실패면_OpenAI_분류():             # "헬스장" + FakeClient {"category":"FITNESS","brand":None,"confidence":"high"} → source "llm", category FITNESS
def test_OpenAI_목록_밖_값은_버림():            # {"category":"GYM","brand":"없는브랜드"} → category None, brand None, source "none"
def test_확신_낮으면_후보만():                  # confidence low → category None, candidates == [{"category":"FITNESS",...}]
def test_OpenAI_실패면_none():                  # FakeClient 가 예외 → source "none"
def test_같은_글자는_캐시():                    # "헬스장" 두 번 → FakeClient 호출 1
def test_OpenAI_로_가는_글은_가려지고_원문은_응답에_없음():  # "헬스장 010-1234-5678" → FakeClient 가 받은 메시지에 전화번호 없음, 응답 dict 어디에도 원문 없음
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — SYSTEM 프롬프트: 역할(일정 장소 분류), 업종·브랜드 목록만 사용, 사람 이름·위치는 무시, 모르면 UNKNOWN, 출력 JSON. 업종 목록과 브랜드 목록은 user 메시지의 사실 JSON 으로 준다.
- [ ] **Step 4: 통과 확인** — `tests/test_place.py`, `tests/test_page_copy.py`

### Task 3: API 와 일정 브랜드 저장

**Files:**
- Modify: `solpay-ai/engine/domain.py` (`ScheduleItem.brand: str | None = None`), `solpay-ai/engine/api.py` (`PlaceBody`, `POST /internal/places/classify`, `ScheduleItemBody.brand`, `_schedule_out`, `app.state.place_llm`), `solpay-ai/engine/service.py` (`put_schedule` brand 검증), `solpay-ai/engine/db_store.py` (payload·복원), 메모리 저장소(`engine/store.py`·`engine/team_db.py`)는 객체를 그대로 두므로 확인만, `README.md`, `postman/solpay-ai.postman_collection.json`
- Test: `solpay-ai/tests/test_place.py`, `solpay-ai/tests/test_db_store.py`

**Interfaces:**
- Consumes: Task 2 `classify_place`.
- Produces: `POST /internal/places/classify` body `{"text": str(1~100), "user_id": int | None, "at": datetime | None}` → classify_place 응답. 공백뿐이면 422 "가게 이름을 입력해 주세요", 없는 user_id 404. 일정 항목·응답에 `brand`(브랜드 코드 또는 null). 카탈로그에 없는 brand → 422 "알 수 없는 가맹점 브랜드: {brand}".

- [ ] **Step 1: 실패하는 테스트**
```python
def test_api_분류_200_빈글_422_없는사용자_404():
def test_일정_brand_저장과_조회():            # PUT 후 GET 응답 items[0]["brand"] == "스타벅스 코드"
def test_브랜드_없는_예전_일정도_그대로():      # brand 없이 PUT → 200, 응답 brand None
def test_목록_밖_brand_는_422():
# test_db_store.py: DB 저장소 왕복에 brand 가 남는다 (로컬 DB 없으면 기존처럼 건너뜀)
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — README '하루 일정' 표에 분류 API 한 줄, 일정 brand 설명. Postman 에 분류 요청 하나(200, `source` 문자열).
- [ ] **Step 4: 통과 확인** — 전체 테스트

### Task 4: 브랜드를 추천에 반영 (결제 화면·추천 페이지·팝업)

**Files:**
- Modify: `solpay-ai/engine/scenarios.py` (일정 분기), `solpay-ai/engine/page.py` (항목 브랜드), `solpay-ai/engine/popup.py` (행사 고르기)
- Test: `solpay-ai/tests/test_place.py` (또는 기존 `tests/test_recommendation_page.py`·`tests/test_popup.py` 에 추가)

**Interfaces:**
- Consumes: Task 3 `ScheduleItem.brand`.
- Produces (동작):
  - 일정 시나리오: item.brand 가 있으면 `brands = {item.brand if item.brand in state.relevant_brands else None: 1.0}`, `promo_brands = {item.brand: 1.0}`. 없으면 지금처럼.
  - 추천 페이지 카드 계산: item.brand 가 있으면 그 항목의 brands = `[item.brand]` (usual_brand·covered 추측 대신).
  - 팝업·추천 페이지 가맹점 탭의 행사: item.brand 가 있으면 그 브랜드(`catalog.merchants[m].is_brand` 또는 brand_code 일치)의 가맹점이 있는 행사만.

- [ ] **Step 1: 실패하는 테스트**
```python
def test_브랜드_일정은_그_브랜드_확률_1():
def test_내_카드와_무관한_브랜드는_혜택_계산에서_None_행사_계산은_그대로():
def test_추천_페이지는_일정_브랜드로_계산():    # 같은 업종 다른 브랜드 혜택 카드가 뽑히지 않는다
def test_팝업_행사는_일정_브랜드만():           # 같은 업종 다른 브랜드 행사는 빠진다
def test_브랜드_없는_일정은_지금과_같다():      # 기존 테스트 전부 통과로 확인
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 전체 테스트

### Task 5: 결제 데모와 /dev 화면

**Files:**
- Modify: `demo/app/ai.py` (`classify_place(text, user_id, at)`, `recommendation_page(user_id, at)`), `demo/app/main.py` (`POST /api/places/classify`, 일정 요청 항목 `brand` 선택 칸 전달, `POST /api/recommendation-page`), `demo/static/pay.html`, `demo/README.md`, `solpay-ai/engine/static/dev_console.html`
- Test: `demo/tests/test_flow.py` (가짜 AI), `demo/tests/test_with_engine.py` (실제 엔진, 있으면)

**Interfaces:**
- Consumes: Task 3 API, 기존 `POST /internal/users/{id}/recommendation-page`.
- Produces (화면):
  - 일정 줄마다 "가게 이름" 입력칸(placeholder "예: 스타벅스, 헬스장 · 개인정보는 적지 마세요"). 입력을 멈추고 0.4초 뒤 `/api/places/classify` → 칩 "→ {이모지 없이 업종 이름} · {브랜드 이름} (검색|AI 분류)" 를 보여 주고 업종 선택·금액(`amount_hint`)을 채운다. 후보만 오면 칩 자리에 후보 버튼. 사용자가 업종을 바꾸면 brand 를 비운다.
  - 저장 시 brand 를 보낸다. 일정 다음 화면은 `/api/recommendation-page`: `tabs` 에 card 가 있으면 기존 '카드를 추천해드려요' 화면(scrRec)에, merchant 가 있으면 기존 일정 맞춤 프로모션 화면에 그 내용을 보여 준다 (둘 다면 카드 → 프로모션 순). 기존 `/api/schedule-popup` 은 남겨 둔다.
  - `/dev` 3번 탭에 "가게 이름 분류" 입력칸과 결과(JSON + 칩). 모든 서버 글은 `esc()`.

- [ ] **Step 1: 실패하는 테스트**
```python
def test_분류_프록시는_AI_결과를_그대로():
def test_일정_저장에_brand_가_AI_로_간다():
def test_일정_다음은_추천_페이지():            # 가짜 AI 의 recommendation-page 응답 tabs ["card","merchant"] 를 그대로 전달
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 데모 테스트 + solpay-ai 전체 테스트

### Task 6: 정확도 평가와 브라우저 확인

**Files:**
- Create: `solpay-ai/evaluation/place_eval.py`
- Modify: `solpay-ai/README.md`

- [ ] **Step 1: 평가 세트** — 정답(업종, 브랜드 또는 None)을 단 60개 표현을 파일 안에 둔다: 브랜드 20(스타벅스·올리브영·신세계백화점·이마트·GS25·CU·다이소·메가MGC커피 등), 별칭·약칭 10(스벅·메가커피·올영 등, 카탈로그 별칭에 없는 것 포함), 오타 10(스타벅쓰·올리브엉 등), 일반 말 15(헬스장·친구랑 저녁·회식·병원 진료·주유·영화 보기·장보기 등), 애매·모름 5("GS", "산책", "집" 등 → 정답 None).
- [ ] **Step 2: 실행** — `uv run python -m evaluation.place_eval` (실제 OpenAI, 승인된 1회, `SOLPAY_DATABASE_URL=""`): 업종 정확도, 브랜드 정확도, **틀린 브랜드를 붙인 수**(목표 0), 출처별(검색/AI/없음) 비율, 중앙값·최대 ms. 틀린 표현 목록 출력.
- [ ] **Step 3: README 에 결과 한 줄**, 결제 데모를 띄워 "스벅" 입력 → 칩 → 저장 → 카드·프로모션 추천까지 브라우저로 확인(스크린샷).

# 행사 목록 DB 이전 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 행사 29건의 화면 정보를 DB `promotions` 표에 두고, AI 는 yml 대신 그 표를, 백엔드는 `GET /api/promotions` 로 같은 표를 앱에 주며, 앱의 행사 데이터·로고를 지운다.

**Architecture:** 원본은 `data/config/promotions.yml` 하나. 생성기가 거기서 (1) 팀 DB `promotions.csv` 의 새 칸 (2) DB 마이그레이션 SQL 을 만든다.
AI `team_db.load_promotions` 가 새 칸을 읽어 `Promotion` 에 화면 정보·실제 기간을 싣고(칸이 없으면 yml 로 채움), 서비스는 yml 합치기를 멈춘다.
백엔드는 엔티티 없이 네이티브 조회로 API 를 주고 로고 28장을 static 으로 제공한다. 앱은 순수 함수 파일 + 읽기 함수로 화면을 채운다.

**Tech Stack:** Python 3.13 + pandas + pytest (`data/`, `solpay-ai/`), Spring Boot 4 / Java 21 (`backend/`), Expo React Native + `node --test` (`frontend/`), PostgreSQL 16.

**Spec:** `docs/superpowers/specs/2026-11-23-promotions-db-design.md`

**작업 폴더 (실행 시작 때):**
- AI·생성기: `ai/placement-engine` 에서 딴 worktree `~/Desktop/solpay/.worktrees/promotions-ai` (브랜치 `ai/promotions-db`). `data/out`·`artifacts`·`.env`·`카드서비스_DB_1년` 은 원래 폴더로 심볼릭 링크(이전 worktree 와 같은 방식, `.git/info/exclude`).
- 백엔드·앱: `final` 에서 딴 worktree `~/Desktop/solpay/.worktrees/promotions-final` (브랜치 `feature/promotions-db`). `backend/.env`, `frontend/node_modules` 링크.
- 설계서·계획서는 `feature/promotions-db` 첫 커밋으로 옮긴다 (`~/Desktop/solpay-final` 의 커밋 안 한 사본은 지운다).

## Global Constraints

- 행사는 29건 (식별불가 30·31 은 어디에도 없다). DB 에 행을 새로 넣지 않는다.
- 기존 칸(`start_date`·`end_date`·`value`·`min_amount`·`max_amount`·`kind`·`merchant_name` 등)과 결제 데이터는 바꾸지 않는다. `start_date` 는 대부분 2025-11-01 그대로.
- 새 칸 (모두 NULL 허용, `needs_check` 만 `NOT NULL DEFAULT false`): `display_name varchar(100)`, `benefit_type varchar(10)` (point/cashback/discount), `benefit_text varchar(60)`,
  `display_start date`, `display_end date`, `payout varchar(40)`, `pay_method varchar(60)`, `note varchar(200)`, `needs_check boolean`, `logo_url varchar(200)`.
- 값은 설계서 '들어갈 값' 29줄 표 그대로 (화면 이름·혜택 문구·실제 기간·지급일·결제 방법·유의사항은 지금 앱 값, 혜택 종류·확인 필요는 yml). 로고 주소 = `/brand-logos/{파일}`.
- 점수 계산(카드 배치·결제 평가)은 지금과 같아야 한다: `start_date`~`end_date` 기간, `needs_check` 행사 제외.
- '지금 진행 중'(맞춤 추천 가맹점 탭·일정 팝업·챗봇 행사 목록)과 화면 기간은 `display_start`~`display_end` (없으면 `start_date`~`end_date`).
- 새 칸이 없는 데이터에서는 yml 에서 같은 번호의 `needs_check`·실제 기간·화면 이름을 채운다.
- 데모 모드(서버 주소 없음)에는 행사가 없다. 혜택 탭 안내 `서버에 연결하면 진행 중인 행사를 볼 수 있어요`, 읽기 실패 `행사를 불러오지 못했어요` + `다시 시도`.
- 다른 세션의 커밋 전 변경(`~/Desktop/solpay` 의 `data/generate/export_db.py` 등, v2·v2.1 폴더)은 건드리지 않는다. `data/tests/test_export_db.py` 도 고치지 않는다.
- AI 테스트: `SOLPAY_DATABASE_URL="" SOLPAY_STORE=teamdb OPENAI_API_KEY="" .venv/bin/python -m pytest -q` (solpay-ai). 생성기 테스트: `cd data && uv run pytest -q tests/test_promotions.py`.
- 백엔드 테스트: `cd backend && JAVA_HOME=$(/usr/libexec/java_home -v 21) sh gradlew test`. 앱 테스트: `cd frontend && node --test utils/__tests__/*.test.mjs`.
- 사용자가 띄운 8031·8090·8081 은 건드리지 않는다. RDS 는 사용자가 마스터 계정으로 실행. 푸시·`final` 합치기는 사용자 요청 때.
- 커밋 메시지 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **SQL 을 아직 실행하지 않은 DB**(공용 RDS·팀원 zip)로 AI 를 켜도 5·6 이 점수에 들어가지 않고 챗봇이 실제 기간을 말해야 한다 → Task 2 '칸 없음' 테스트.
2. **화면 이름과 가맹점 찾기 이름이 다른 행사**(2·3 온라인 다이소몰/다이소몰, 4 W컨셉, 21 차앤박): 혜택 탭·맞춤 추천은 화면 이름, 결제 매칭은 그대로 → Task 2·3 테스트.
3. **같은 브랜드 행사 두 건**(2·3 다이소몰, 3 은 11-16 시작): 11-10 에는 혜택 탭 '진행 예정', 챗봇 목록에 3 없음 → Task 3·6 테스트.
4. **서버 응답이 느리거나 실패**: 혜택 탭이 영원히 빈 화면이면 안 된다 (읽는 중 표시 → 실패 문구·다시 시도) → Task 7 화면 처리, Task 8 Step 4 에서 백엔드를 끄고 확인.
5. **로고 주소가 없는 행 / 로고 파일이 없는 주소**: 그림 칸 없이 이름만 (깨진 그림 아님) → Task 6·7.

---

### Task 1: 생성기 — yml 에 화면 값, 새 칸·SQL 만들기

**Files:**
- Modify: `data/config/promotions.yml` (30·31 줄 지우기, 29줄에 `benefit_text`·`pay_method`·`payout`(마이샵 포함)·`note`(앱 문구로)·`logo` 더하기)
- Modify: `data/generate/promotions.py` (`EXCLUDE` 정리, `DB_COLUMNS` 확장, `display_frame`, `db_frame`, `migration_sql`, CLI)
- Test: `data/tests/test_promotions.py` (기존 파일에 더하기)

**Interfaces:**
- Produces: `DISPLAY_COLUMNS = ["display_name", "benefit_type", "benefit_text", "display_start", "display_end", "payout", "pay_method", "note", "needs_check", "logo_url"]`
- Produces: `display_frame() -> pd.DataFrame` — `promotion_id` + `DISPLAY_COLUMNS`, yml 29줄에서 (`display_name`=yml `brand`, 기간=yml `starts`/`ends`, `logo_url`="/brand-logos/"+`logo` 또는 None, 빈 `note` → None).
- Produces: `db_frame(merchants)` 결과 칸 = 기존 14칸 + `DISPLAY_COLUMNS` (기존 칸 값은 지금과 같음).
- Produces: `migration_sql() -> str` — `ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS ...` 10줄 + `CHECK (benefit_type IN ('point','cashback','discount'))`(이미 있으면 건너뛰는 `DO $$ ... $$`) + 29개 `UPDATE public.promotions SET ... WHERE promotion_id = N;` + 끝의 확인 `SELECT count(*) FILTER (WHERE display_name IS NOT NULL)`. `BEGIN;`/`COMMIT;` 로 감싼다. INSERT 없음. 문자열은 `'` 를 `''` 로.
- Produces: CLI `uv run python -m generate.promotions --update-csv <팀 DB 폴더>` (그 폴더 `promotions.csv` 를 읽어 `promotion_id` 로 새 칸을 붙여 다시 씀, 다른 칸·행 순서 유지), `--sql` (SQL 을 표준 출력).

- [ ] **Step 1: 실패하는 테스트**

```python
def test_display_frame_has_29_rows_with_screen_values():
    df = display_frame().set_index("promotion_id")
    assert len(df) == 29 and 30 not in df.index and 31 not in df.index
    assert df.loc[2, "display_name"] == "온라인 다이소몰" and df.loc[2, "benefit_text"] == "1,000 마이신한포인트 적립"
    assert str(df.loc[3, "display_start"]) == "2026-11-16" and str(df.loc[5, "display_end"]) == "2026-12-25"
    assert df.loc[1, "logo_url"] == "/brand-logos/mega.png" and df.loc[1, "note"] == "키오스크에서 바코드 스캔 필요"
    assert bool(df.loc[5, "needs_check"]) and bool(df.loc[6, "needs_check"]) and not bool(df.loc[1, "needs_check"])
    assert df.loc[8, "payout"] == "결제일에 따라 다름" and df.loc[8, "pay_method"] == "마이샵 혜택 ON 설정 후 신한카드 결제"
    assert pd.isna(df.loc[8, "note"]) and df.loc[7, "benefit_type"] == "discount"

def test_db_frame_keeps_old_columns_and_adds_display():
    old = ["promotion_id", "card_id", "issuer", "merchant_id", "promo_name", "category", "merchant_name",
           "value_type", "value", "max_amount", "start_date", "end_date", "kind", "min_amount"]
    df = db_frame(pd.DataFrame(columns=["merchant_id", "brand", "brand_code", "place_name", "category_code"]))   # 기존 test_팀_DB_형식 과 같은 빈 가맹점
    assert list(df.columns) == old + DISPLAY_COLUMNS
    assert (df.start_date == "2025-11-01").sum() >= 25 and len(df) == 29

def test_migration_sql_updates_29_rows_and_never_inserts():
    sql = migration_sql()
    assert sql.count("UPDATE public.promotions SET") == 29 and "INSERT" not in sql.upper()
    assert "ADD COLUMN IF NOT EXISTS display_name varchar(100)" in sql
    assert "ADD COLUMN IF NOT EXISTS needs_check boolean NOT NULL DEFAULT false" in sql
    assert sql.strip().startswith("BEGIN;") or sql.lstrip().startswith("--")
```
`final_promotions()` 가 29건이고 결제 매칭에 쓰는 값이 바뀌지 않는다는 기존 테스트(`test_가맹점을_식별할_수_없는_2건을_뺀_29건` 등)는 그대로 통과해야 한다.
기존 `test_팀_DB_형식` 의 칸 목록 기대값은 새 칸을 포함하도록 고친다 (고친 이유를 주석에).

- [ ] **Step 2: 실패 확인** — `cd data && uv run pytest -q tests/test_promotions.py` → 새 테스트 FAIL.
- [ ] **Step 3: yml·`promotions.py` 구현** (yml 값은 설계서 29줄 표 그대로).
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `uv run pytest -q tests/test_promotions.py tests/test_generated.py` PASS.
- [ ] **Step 5: 팀 DB 폴더 갱신** — `uv run python -m generate.promotions --update-csv ../카드서비스_DB_1년` (링크 대상 = 원래 폴더). `schema.sql` 의 `CREATE TABLE promotions` 와 `테이블_명세서.csv` 의 promotions 줄에 새 10칸을 손으로 더한다 (git 밖 파일). 확인: `promotions.csv` 29행·24칸.
- [ ] **Step 6: 커밋** — `생성기: 행사 화면 값(화면 이름·혜택 문구·실제 기간·지급일·결제 방법·유의사항·로고)을 yml 에, DB 새 칸·마이그레이션 SQL 만들기, 식별불가 2건 삭제`

---

### Task 2: AI — DB 새 칸으로 행사 불러오기 (칸이 없으면 yml)

**Files:**
- Modify: `solpay-ai/engine/domain.py` (`Promotion`)
- Modify: `solpay-ai/engine/loader.py` (`promotion_from_row`)
- Modify: `solpay-ai/engine/team_db.py` (`load_promotions`)
- Modify: `solpay-ai/engine/team_db.py` `TeamDbStore`, `solpay-ai/engine/db_store.py` `TeamDbPgStore` (속성 `promotions_complete = True`)
- Test: `solpay-ai/tests/test_promotions_db.py` (새 파일)

**Interfaces:**
- Produces (`Promotion` 새 필드, 기본값 있음): `display_name: str = ""`, `shown_from: datetime | None = None`, `shown_to: datetime | None = None`, `logo_url: str | None = None`.
- Produces: `Promotion.name -> str` (property, `display_name or brand`), `Promotion.shown(at: datetime) -> bool` (`shown_from/shown_to` 가 있으면 그 기간, 없으면 `active(at)`). `active()`·`applies()` 는 그대로.
- Produces: `load_promotions(src, catalog, cmap)` — 표에 `display_name` 칸이 있으면 새 칸을 싣는다(`display_start` 0시 ~ `display_end` 23:59:59 KST, `needs_check` 는 그 값). 칸이 없으면 `loader.load_popup_promotions(catalog)` 결과를 번호로 찾아 `needs_check`·`shown_from/to`(yml starts/ends)·`display_name`(yml brand) 를 채운다(`logo_url` None).
- Produces: 저장소 속성 `promotions_complete: bool` — `TeamDbStore`·`TeamDbPgStore` 는 True, 그 밖(parquet) 은 속성 없음(= False).

- [ ] **Step 1: 실패하는 테스트** — CSV 폴더 픽스처 두 개(지금 `카드서비스_DB_1년` 을 `tmp_path` 에 복사하고 `promotions.csv` 만 바꿈: 새 칸 있는 것 / 새 칸을 지운 것), `CsvSource`(team_db 의 CSV 소스)로 `load_promotions` 호출.
  - 칸 있음: 2번 `name == "온라인 다이소몰"`, `brand == "다이소몰"`, 3번 `shown(2026-11-10 12:00 KST) is False`·`active(같은 시각) is True`·`shown(2026-11-20) is True`, 1번 `logo_url == "/brand-logos/mega.png"`, 5·6 `needs_check`, 29건.
  - 칸 없음: 5·6 `needs_check` (yml 로 채움), 3번 `shown_from` = 2026-11-16 0시 KST, 2번 `name == "온라인 다이소몰"`, `logo_url is None`.
  - 공통: 5번은 `applies(그 가맹점, "SHINHAN", 아무 카드, 2026-11-20)` 가 False (점수에서 빠짐).
- [ ] **Step 2: 실패 확인** — `... pytest -q tests/test_promotions_db.py` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 새 테스트 PASS, 전체 AI 테스트 PASS (이 단계에서는 서비스 동작을 아직 안 바꿨다).
- [ ] **Step 5: 커밋** — `AI: 행사를 DB 새 칸(화면 이름·실제 기간·확인 필요·로고)으로 불러오기, 칸이 없으면 yml 로 채우기`

---

### Task 3: AI — yml 합치기 그만, '진행 중'은 실제 기간, 응답에 화면 이름·로고

**Files:**
- Modify: `solpay-ai/engine/service.py` (`popup_promotions`, `_all_promotions`, 추천 페이지·월간 리포트의 `merge_promotions` 두 곳)
- Modify: `solpay-ai/engine/popup.py` (`promotion_offers` 의 `promo.active(item.start)` → `promo.shown(item.start)`, `PromotionOffer` 에 `display_name: str = ""`, `logo_url: str | None = None` 과 `to_dict` 키 `display_name`·`logo_url`)
- Modify: `solpay-ai/engine/chat/tools.py` (`list_promotions`: `p.shown(self.at)`, 행 `brand` 는 `p.name`, 행에 `logo_url`)
- Modify: `solpay-ai/README.md` (행사 원본 = DB 표, 칸 없을 때 yml), `solpay-ai/docs/상세_기록.md` 한 줄
- Test: `solpay-ai/tests/test_promotions_db.py` 에 더하기, 기존 `test_popup.py`·`test_recommendation_page.py`·`test_chat.py`·`test_service_api.py`·`test_promo_score.py` 중 합치기를 전제한 기대값만 고침

**Interfaces:**
- Consumes: Task 2 (`Promotion.name`, `shown`, `promotions_complete`).
- Produces: `promotions_complete` 인 저장소에서 `service.popup_promotions` = `store.promotions` 전체, `service._all_promotions(context)` = `list(context.promotions)` (합치기 없음). 아니면 지금 동작(yml 합치기) 그대로.
- Produces: 맞춤 추천 `merchant.offers[]` 와 일정 팝업 행사에 `display_name`·`logo_url` 키. 챗봇 `list_promotions` 행 `{promotion_id, brand(화면 이름), title, kind, benefit, start(실제), end(실제), cards, logo_url, min_amount?}`.

- [ ] **Step 1: 점수 기준선 저장 (바꾸기 전 커밋에서)** — 스크래치 스크립트로 teamdb 모드 서비스에 사용자 1~20 × 시각 3개(2026-10-15 12:30, 2026-11-10 12:30, 2026-11-23 19:00 KST)의 `rank` 결과(`cards` 순서·`reason_code`·각 카드 점수)와 `evaluate(CAFE 6000)` 결과를 JSON 으로 저장.
- [ ] **Step 2: 실패하는 테스트**
  - `test_chat_promotion_list_uses_real_period_and_screen_name`: `at=2026-11-23` 사용자 1 의 `list_promotions` 에 5·6 없음, 모든 `start` 가 `2026-11-` 로 시작, 2번 행 `brand == "온라인 다이소몰"`, 행에 `logo_url` 키.
  - `test_chat_promotion_list_hides_not_yet_started`: `at=2026-11-10` 에는 3번이 없다(2번은 있다).
  - `test_page_offers_carry_display_name_and_logo`: 추천 페이지 행사 하나 이상에 `display_name`·`logo_url` 키, 로고가 있는 행사는 `/brand-logos/` 로 시작.
  - `test_service_does_not_merge_yml_when_store_is_complete`: `promotions_complete` 저장소에서 `_all_promotions` 번호가 중복 없이 29건 이하.
- [ ] **Step 3: 실패 확인 → 구현 → 통과 확인** — 새 테스트와 전체 AI 테스트 PASS (합치기 전제 기대값을 고친 테스트는 고친 이유를 테스트 주석에).
- [ ] **Step 4: 점수 비교** — Step 1 스크립트를 새 코드로 다시 돌려 JSON 이 같아야 한다 (다르면 다른 사용자·시각·카드를 보고 원인을 찾는다. 같은 번호 행사의 기간·가맹점이 DB 와 yml 에서 다른 SSG닷컴(DB 3곳·yml 1곳)은 점수에서 원래 DB 쪽이 쓰였으므로 같아야 정상).
- [ ] **Step 5: 커밋** — `AI: 행사는 DB 표 하나로, '진행 중'과 챗봇·추천 기간은 실제 기간, 응답에 화면 이름·로고 (점수 그대로)`

---

### Task 4: 로컬 DB 에 마이그레이션 적용

**Files:** 없음 (SQL 은 Task 5 에서 저장소에 넣는다)

- [ ] **Step 1: SQL 만들기** — AI worktree `data` 에서 `uv run python -m generate.promotions --sql > <scratchpad>/promotions_display.sql`.
- [ ] **Step 2: 로컬 두 DB 에 실행** — `docker exec -i solpay-db psql -U solpay_app -d solpay_backend -v ON_ERROR_STOP=1 < <파일>`, 같은 것을 `-d solpay` 에. 한 번 더 실행해 오류 없음(멱등) 확인.
- [ ] **Step 3: 확인** — 두 DB 모두 `SELECT count(*) FROM promotions WHERE display_name IS NOT NULL` = 29, `SELECT display_start FROM promotions WHERE promotion_id=3` = 2026-11-16, `SELECT count(*) FROM promotions` = 29, `start_date` 가 2025-11-01 인 행 수가 실행 전과 같음.

---

### Task 5: 백엔드 — `GET /api/promotions`, 로고, SQL 파일

**Files:**
- Create: `backend/src/main/resources/static/brand-logos/*.png` (앱 `frontend/assets/promotion-logos/` 5장 + `myshop-logos/` 23장, 같은 파일 이름)
- Modify: `backend/src/main/java/com/paymate/backend/config/SecurityConfig.java` (`GET /brand-logos/**` permitAll, `/card-images/**` 옆)
- Create: `backend/src/main/java/com/paymate/backend/promotion/repository/PromotionRepository.java` (`Repository` + 네이티브 조회), `.../promotion/repository/PromotionRow.java` (인터페이스 프로젝션), `.../promotion/service/PromotionService.java`, `.../promotion/dto/PromotionResponse.java` (record), `.../promotion/controller/PromotionController.java`
- Create: `backend/shared-db/add_promotion_display.sql` (Task 4 의 SQL 그대로, 맨 위에 실행 방법 주석 — `add_schedules_and_image_url.sql` 과 같은 형식)
- Modify: `backend/docs/AI_연동.md` 또는 `backend` 쪽 README 에 행사 API 한 단락
- Test: `backend/src/test/java/com/paymate/backend/promotion/PromotionServiceTest.java`, `.../promotion/PromotionApiTest.java`

**Interfaces:**
- Produces: `GET /api/promotions` (로그인 필요) → `List<PromotionResponse>`; `record PromotionResponse(Long promotionId, String kind, String name, String benefitType, String benefitText, Integer minAmount, Integer maxAmount, String start, String end, String payout, String method, String note, boolean needsCheck, String logoUrl)`.
  규칙: `name` = `display_name` 없으면 `merchant_name` 없으면 `promo_name`; `start/end` = `display_start/end` 없으면 `start_date/end_date` (`yyyy-MM-dd`); `minAmount` 0 → null; 정렬 = `kind` event 먼저, 그다음 `promotion_id`.
- 네이티브 조회는 새 칸을 직접 읽는다 (칸이 없는 DB 에서는 이 API 만 500, 백엔드 기동에는 영향 없음 — 엔티티 없음).

- [ ] **Step 1: 실패하는 테스트**
  - `PromotionServiceTest` (저장소 가짜): 화면 이름·실제 기간이 있으면 그 값 / 없으면 대신 값, `minAmount` 0 → null, event 가 myshop 보다 먼저.
  - `PromotionApiTest` (`@SpringBootTest` + MockMvc, 기존 기동 테스트처럼 `backend/.env` 로컬 DB 필요, Task 4 이후): `GET /brand-logos/mega.png` 토큰 없이 200, `GET /api/promotions` 토큰 없이 401, `JWTUtil.createAccessToken(1L, "test1@example.com", "USER")` 토큰으로 200·29건·첫 행 `promotionId` 1·`logoUrl` `/brand-logos/mega.png`·3번 `start` `2026-11-16`, 응답에 30·31 없음.
- [ ] **Step 2: 실패 확인** → **Step 3: 구현** → **Step 4: `sh gradlew test` 전체 PASS**.
- [ ] **Step 5: 커밋** — `백엔드: 행사 목록 API(/api/promotions)와 브랜드 로고 28장, 공용 DB 마이그레이션 SQL`

---

### Task 6: 앱 — 행사 API 읽기 (순수 함수 + 읽기 함수)

**Files:**
- Create: `frontend/utils/promotionsCore.js` (순수, react-native 안 가져옴)
- Create: `frontend/utils/promotions.js` (API 읽기·기억·훅)
- Modify: `frontend/utils/api.js` (`promotions: () => request('/api/promotions', { auth: true })`)
- Test: `frontend/utils/__tests__/promotionsCore.test.mjs`

**Interfaces:**
- Produces (`promotionsCore.js`):
  - `toBenefitRows(list, baseUrl) -> Row[]`, `Row = { id: 'promo-'+promotionId, promotionId, type: '이벤트'|'마이샵', merchant, benefit, minimum, cap, start, end, payout, method, note, needsCheck, logo: { uri } | null }` (`logoUrl` 이 `/` 로 시작하면 `baseUrl` 을 붙임, 없으면 null). 배열이 아니면 `[]`.
  - `benefitStatus(row, today) -> '진행 예정' | '기간 내' | '기간 종료'` (MainScreen 의 같은 이름 함수를 옮김), `activePromotions(rows, today) -> Row[]` (`type==='이벤트'` 이고 기간 내).
  - `selectDailyPromotion(items, now)` (`data/promotionBrands.js` 에서 그대로 옮김).
  - `PROMO_TEXT = { demo: '서버에 연결하면 진행 중인 행사를 볼 수 있어요', failed: '행사를 불러오지 못했어요', retry: '다시 시도' }`.
- Produces (`promotions.js`): `loadPromotions(): Promise<Row[]>` (서버 모드에서 한 번 읽으면 앱을 다시 열 때까지 기억, 실패하면 기억하지 않음), `usePromotions() -> { rows: Row[], status: 'off' | 'loading' | 'ready' | 'failed', reload() }` (데모 모드 = `off`, rows `[]`).

- [ ] **Step 1: 실패하는 테스트** — `toBenefitRows` (API 예시 2건: event 1번·myshop 8번) → `type`·`merchant`·`benefit`·`minimum` null·`logo.uri === 'http://x:8090/brand-logos/mega.png'`, `logoUrl` null → `logo` null, 배열 아님 → `[]`; `benefitStatus` 3가지; `activePromotions` 가 마이샵·기간 밖을 뺌; `selectDailyPromotion` 날짜 돌림이 옛 함수와 같음(2026-11-18 → 0번, 다음날 → 1번).
- [ ] **Step 2: 실패 확인 → 구현 → `node --test utils/__tests__/*.test.mjs` PASS.**
- [ ] **Step 3: 커밋** — `앱: 행사 API 읽기(promotionsCore·promotions), 데모 모드에는 행사 없음`

---

### Task 7: 앱 — 화면을 API 로, 앱 행사 데이터 지우기

**Files:**
- Modify: `frontend/screens/MainScreen.js` (`MYSHOP_ROWS`·`ALL_BENEFITS`·`benefitStatus` 지우고 `usePromotions()` 로 혜택 탭 목록·검색·필터, `BenefitReport`, '이번 달 혜택 N건', 홈 미리보기, `refreshDailyNotifications` 의 행사, `localAnswer`, `RecommendationLaunchPopup` 의 `promotions`, 로고 `Image source={row.logo}`)
- Modify: `frontend/components/RecommendationLaunchPopup.js` (`selectDailyPromotion` 을 `promotionsCore` 에서)
- Modify: `frontend/components/PromotionOffer.js` (`PROMOTION_BRANDS` 대신 `offer.logo`(uri) — 없으면 그림 칸 없음, 배경 `#F4F7FC`)
- Modify: `frontend/utils/aiRecommendCore.js` (`toPromotionOffer(page, baseUrl)`: `merchant = offer.display_name || offer.brand`, `logo` = `logo_url` 에 서버 주소)·호출하는 곳·`frontend/utils/__tests__/aiRecommendCore.test.mjs`
- Modify: `frontend/screens/RoutineRecommendationScreen.js` (`recommendPromotion` 사용 지움 — 데모 모드 행사 추천 없음)
- Delete: `frontend/data/promotions.js`, `frontend/data/promotionBrands.js`, `frontend/data/myshopLogos.js`, `frontend/assets/promotion-logos/`, `frontend/assets/myshop-logos/`
- Modify: `frontend/docs/AI_연동.md`, 최상위 `README.md` (혜택 탭 = 서버 행사 API, 데모 모드에는 행사 없음)

- [ ] **Step 1: `aiRecommendCore` 테스트 먼저** — `toPromotionOffer` 가 `display_name` 을 쓰고(없으면 `brand`), `logo_url` 에 `baseUrl` 을 붙인다. 실패 확인 → 구현 → PASS.
- [ ] **Step 2: 화면 고치기·파일 지우기** — 혜택 탭: `status==='off'` 면 `PROMO_TEXT.demo`, `loading` 이면 로딩 표시, `failed` 면 `PROMO_TEXT.failed` + `PROMO_TEXT.retry` 버튼(`reload`), `ready` 면 지금 목록 화면 그대로(로고·상태 배지·검색·필터). 홈 미리보기·팝업·알림은 `rows` 가 비면 나오지 않는다.
- [ ] **Step 3: 남은 참조 없음 확인** — `grep -rn "promotionBrands\|myshopLogos\|data/promotions\|MYSHOP_ROWS\|promotion-logos\|myshop-logos" frontend --include=*.js -l` 결과에 `node_modules` 밖 파일이 없어야 한다.
- [ ] **Step 4: 앱 테스트·웹 빌드** — `node --test utils/__tests__/*.test.mjs` PASS, `CI=1 npx expo export --platform web --output-dir <scratchpad>/promo-web` 오류 없음.
- [ ] **Step 5: 커밋** — `앱: 혜택 탭·홈 미리보기·오늘의 프로모션·알림·맞춤 추천 로고를 서버 행사 API 로, 앱 행사 데이터·로고 28장 삭제`

---

### Task 8: 합쳐서 실제로 확인

**Files:** 없음 (고칠 것이 나오면 해당 파일 + 커밋)

- [ ] **Step 1: AI 브랜치를 백엔드·앱 브랜치에 합치기** — `feature/promotions-db` worktree 에서 `git merge --no-ff ai/promotions-db` (`solpay-ai/`·`data/` 만 바뀌어야 함).
- [ ] **Step 2: 확인 서버** — AI: AI worktree 의 `solpay-ai` 에서 `SOLPAY_STORE=db SOLPAY_DATABASE_URL= POSTGRES_DB=solpay_backend OPENAI_API_KEY= SOLPAY_INTERNAL_TOKEN=<backend/.env 의 AI_INTERNAL_TOKEN> .venv/bin/python -m uvicorn engine.api:app --port 8231`;
  백엔드: final worktree `backend` 에서 `SERVER_PORT=8091 AI_BASE_URL=http://127.0.0.1:8231 sh gradlew bootRun`; 앱 웹: `EXPO_PUBLIC_API_URL=http://localhost:8091` 로 빌드한 웹을 미리보기 도구로 연다(8290 방식). 데모 사용자 1 (계정은 `~/Desktop/solpay/카드서비스_DB_1년/테스트_가이드.md`).
- [ ] **Step 3: API 확인** — `GET /api/promotions` 29건·정렬·로고, `GET /brand-logos/mega.png` 200, `POST /api/ai/recommendation-page` 행사에 `display_name`·`logo_url`.
- [ ] **Step 4: 화면 확인** — 혜택 탭 29건·로고(다이소몰·W컨셉·CU·올리브영 포함)·식별불가 없음·'기간 내/종료' 배지, 홈 미리보기, 맞춤 추천 가맹점 탭 로고. 서버 주소 없이 빌드한 웹에서 혜택 탭 안내 문구.
  확인 백엔드(8091)를 잠깐 끈 상태로 혜택 탭을 열어 '행사를 불러오지 못했어요'·'다시 시도'가 나오고, 다시 켠 뒤 '다시 시도'로 목록이 뜨는지 (Review Focus 4). 화면 사진.
- [ ] **Step 5: 서버 끄기, 결과 정리.**

---

### Task 9: 공용 RDS (사용자 실행) 와 마무리

- [ ] **Step 1: 실행 안내** — 사용자에게 `backend/shared-db/add_promotion_display.sql` 을 마스터 계정으로 실행하도록 명령(`docker cp` + `docker exec -it ... psql ... -f`)을 알린다.
- [ ] **Step 2: 실행 뒤 읽기 전용 확인** — `app_ai` 계정으로 새 칸 29건·3번 `display_start` 2026-11-16·`start_date` 그대로.
- [ ] **Step 3: 사용자 요청 때** — `ai/promotions-db` → `ai/placement-engine`, `feature/promotions-db` → `final` 합치기, worktree 정리. 푸시는 따로.

# 가상 소비 데이터 생성기

> **이 데이터는 카드 배치 알고리즘을 만들고 평가할 때 쓰는 사용자의 과거 소비 데이터입니다.**
> 알고리즘은 배치 시각 이전의 결제만 입력으로 쓸 수 있고, 학습과 평가는 시간순으로 나눕니다.
> 생성기 전용 정답 칸(`payments.choice_reason` 등)은 입력으로 쓰지 않습니다.

서비스와 평가에 쓰는 판은 **v2.1** 입니다.

| 항목 | 내용 |
|---|---|
| 카드 | 최종 카드 DB 44장 (신한 18 · KB국민 6 · 하나 6 · BC 5 · NH농협 5 · 롯데 4), 혜택 311개 |
| 사용자 | 배경 1,000명 (직업 10개 × 20~60대 26칸, 칸마다 30명 이상) + 시연 계정 5명 (카드 3~5장) |
| 보유 카드 | 2~5장. 모든 사용자가 신한카드를 1장 이상 가집니다 |
| 업종 | 최종 카드 DB 의 58개 코드, 그중 생활 업종 44개에 결제를 만듭니다 |
| 기간 | 2025-11-01 부터 기준 시각(`as_of`)까지. 2025-11~12월은 이력, 2026-01부터 학습·평가 |
| 개인 루틴 | 배경 사용자 절반에게 직업에 맞는 루틴 1~2개 (출근길 커피·점심 식당·퇴근길 편의점 등) |
| 행사 | 신한 SOL페이 이벤트·마이샵 29건을 데이터 전체 기간 행사로 봅니다 |

사용자는 혜택과 무관한 습관으로 카드를 고르고, 혜택은 그 결제 내역 위에서 계산합니다. 결제는 가상입니다.
카드 혜택·실적 구간·한도는 최종 카드 DB 표(`config/card_db/*.csv`)를 그대로 쓰고, 카드 코드·해외 혜택 제외·브랜드 표기 맞춤은 `config/card_db_map.yml` 에 둡니다.

## 실행

```bash
cd data
uv sync                                                        # 처음 한 번
SOLPAY_DATA_VERSION=v2.1 uv run python -m generate.main        # → out_v2.1/ (parquet·csv)
SOLPAY_DATA_VERSION=v2.1 uv run python -m generate.summary     # 숫자 확인 (직업×나이대 표 포함)
SOLPAY_DATA_VERSION=v2.1 uv run python -m generate.export_db   # → ../카드서비스_DB_1년_v2.1 (팀 DB 23개 표 형식)
uv run pytest                                                  # 검증
```

- 같은 `seed`(config/settings.yml)면 누가 돌려도 같은 결과가 나옵니다. 결과물(`out*/`)은 깃에 올리지 않고 각자 다시 만듭니다.
- 기준 시각은 `config/settings.yml` 의 `as_of`(2026-11-05 10:00)입니다. 배포 DB 의 결제는 `as_of` 를 2026-11-27 00:00 으로 두고 만든 결제로 11-26 까지 늘렸습니다 (11-05 10시 전 결제는 같습니다).

### 판 구성

설정은 판마다 겹쳐 씁니다 (사전은 합치고 목록은 바꿈): 기본 `config/*.yml` → `config/v2/*.yml` → `config/v2.1/*.yml`.

| 판 | `SOLPAY_DATA_VERSION` | 내용 | 결과 |
|---|---|---|---|
| v1 | (없음) | 데모 5 + 배경 300 + 50대 60 = 365명 | `out/` |
| v2 | `v2` | 직업 10개 × 나이대 배경 1,000명 + 데모 5명. 같은 직업 안에서도 나이대마다 업종 비중·건당 금액·차량·학원비가 다름(`age_effects`) | `out_v2/` |
| **v2.1** | `v2.1` | v2 + 개인 루틴 | `out_v2.1/` |

**개인 루틴 (v2.1)**: 루틴은 정해진 시각 ±30분, 해당 요일에 60~90% 확률로 지킵니다. 그날의 같은 종류 결제나 금액이 비슷한 결제를 루틴으로 바꾸고,
없을 때만 새로 만들고 뒤의 날 결제를 빼서 결제 수와 월 지출을 v2 와 비슷하게 둡니다. 루틴은 따로 뽑은 난수로 정해서 루틴이 없는 사용자의 결제는 v2 와 같습니다.
루틴 목록(`user_routines`·`routine_events`)은 생성기 전용이라 팀 DB 에는 넣지 않습니다. 설계: `docs/설계/2026-11-23-data-v2.1-routines-design.md`.

**시연 계정 (v2.1)**

| 계정 | 카드 |
|---|---|
| 1 | 신한카드 Discount Plan+, KB ALL 카드, 신한 모두의카드, 신한카드 SOL트래블 체크 |
| 2 | 신한카드 처음 체크, 신한 모두의카드, KB국민 노리2 체크카드 |
| 3 | SOL메이트 신한카드 SOL Plan 체크, NH농협 올원더풀(할인 PACK), 부자되세요 더 오일카드, HERO 체크카드, 신한카드 Simple Plan |
| 4 | 신한카드 Discount Plan, 신한 모두의카드, HERO 체크카드, KB국민 첵첵 체크카드 |
| 5 | 신한 모두의카드, MOVING카드 ONLINE모드, NH농협 zgm 저장체크카드, 부자되세요 더 오일카드, SOL LINK 신한카드 Point Plan 체크 |

시연 계정은 시연을 위해 규칙적인 패턴을 유지하고, 불규칙 소비는 배경 사용자에게만 넣습니다.

## 설정 파일

| 파일 | 내용 |
|---|---|
| `settings.yml` | 시드, 기간, 기준 시각, 배경 사용자 수 |
| `card_db/*.csv` | 최종 카드 DB 원본 표: 카드 44장, 혜택 311개 × 구간, 대상 업종·브랜드, 그룹·카드 통합 한도, 업종 58개, 브랜드 별칭 (고치지 않음) |
| `card_db_map.yml` | 카드 코드, 카드사 코드, 한 카드의 모드·팩 묶음, 해외 대상 제외, 가맹점 이름 → 카드 DB 브랜드 표기, K-패스 카드, 발급 자격 |
| `categories.yml` | 업종 58개, 결제 경로, 배치 대상 여부, 결제를 만드는 업종 |
| `promotions.yml` | 신한 SOL페이 이벤트·마이샵. 가맹점을 식별할 수 없는 2건을 뺀 29건을 데이터 전체 기간 행사로 보고 엔진 데이터·팀 DB 폴더·결제의 프로모션을 만듭니다 (`generate/promotions.py`). 결제에는 마이샵을 사용자·행사·달마다 30% 만 켰다고 보고 붙입니다. 화면 이름·실제 기간·확인 필요 여부의 원본이기도 합니다 (`uv run python -m generate.promotions --sql` 로 DB 반영 SQL) |
| `personas.yml` | 사용자 유형, 카드 고르는 습관, 시연 계정 |
| `population.yml` | 배경 사용자 생성 규칙, 사용자별 지출 격차, 단골 확률 |
| `distributions.yml` | 하루 결제 건수, 시간대·업종 비율, 금액 분포, 공과금, 심야·대형 결제 |
| `places.yml`, `zones.yml` | 생성기 '종류'(카페·제과·패스트푸드…)와 업종의 연결, 동네 11곳과 동네별 가맹점 수, 온라인 가맹점 |
| `programs.yml` | 교통 결제 방식, K-패스 환급 기준 |
| `v2/`, `v2.1/` | 판별로 겹쳐 쓰는 설정 (직업·나이대, 시연 계정 카드, 개인 루틴) |
| `real_cards/`, `card_rules.yml`, `issuers.yml`, `cards.yml` | 최종 카드 DB 이전의 카드 설정 (참고용, 생성에 쓰지 않음) |
| `crawl.yml`, `crawl_seeds.yml` | 카드 상품 수집기 설정 |

## 제공 데이터 반영 범위

| 항목 | 내용 | 근거 |
|---|---|---|
| 업종별 건당 금액 | 생성 결과의 업종 평균을 맞춤 (`amount`) | 2020년 신한카드 시군구별·온라인소비, 구별 중앙값 |
| 사용자별 지출 격차 | 월 지출 목표 24만 / 107만 / 352만 원 (`spend_level`) | CreDB 카드 이용 내역 (단위는 천 원으로 가정) |
| 공과금 | 전기·도시가스·아파트 관리비, 건당 금액 수준만 참고 | 월납·세금은 강남구·중구 등록지에 몰려 비중은 쓰지 않음 |
| 시연 계정 3번 | 홈쇼핑 비중, 오전 온라인 비중 | 삼성카드 온라인쇼핑 50대 여성 |

대형마트·슈퍼 금액은 장보기 금액을 반영한 가정값입니다 (제공 데이터 평균은 40,100원, 16,500원).
그 밖의 시간대·업종 가중치, 심야 결제, 충동·대형 결제, 단골 확률 범위는 가정값입니다.

## 결과 파일

### 생성기 결과 (`out_v2.1/parquet`, `out_v2.1/csv`)

parquet 에는 전체가, csv 에는 기준 정보와 시연 계정 5명분만 들어갑니다. `payments.choice_reason`(가상 사용자가 카드를 고른 이유)은 생성기 전용이라 csv 에서는 뺍니다.

| 표 | 내용 |
|---|---|
| issuers, merchant_categories, card_catalog | 기준 정보 |
| card_benefits, card_cap_tiers | 카드별 혜택 규칙, 전월 실적 구간별 월 한도 |
| merchants | 동네 가맹점 + 온라인·교통·자동이체 가맹점 |
| users, user_cards, user_category_habits | 사용자·유형·동네·카드 고르는 습관, 보유 카드, 업종별 습관 카드 |
| payments | 결제 내역 |
| card_month_status | 보유 카드별 월 실적, 받은 혜택, 결제 건수 |
| promotions | 이벤트·마이샵 혜택 (브랜드, 기간, 정액·비율, 건당 최소·최대, 확인 필요 여부) |

`card_month_status` 의 `prev_perf` 만 그달 초에 알 수 있는 값입니다. `perf`·`benefit_amount` 는 월말 합계이므로 배치 시각의 당월 실적은 그 시각 이전 `payments` 로 계산합니다.
실적에는 모든 결제가 들어갑니다.

### 팀 DB 형식 (`카드서비스_DB_1년_v2.1/`)

`generate.export_db` 가 생성 결과를 팀 DB 23개 표(`schema.sql`·`load_all.sql`·표마다 CSV)로 내보냅니다. AI 서버의 CSV 저장소와 PostgreSQL 적재(`db/`, `solpay-ai/scripts/setup_local_db.py`)가 이 폴더를 씁니다.

## 카카오 실제 가맹점 위치 (선택)

1. Kakao Developers 에서 앱을 만들고 REST API 키를 받습니다.
2. `.env.example` 을 `.env` 로 복사하고 `KAKAO_REST_API_KEY` 를 채웁니다.
3. `uv run python -m generate.kakao_fetch` → `cache/kakao_places.csv` (`--kinds SALAD,DEPT` 로 일부 종류만 다시 받기)
4. 다시 `generate.main` 을 돌리면 가상 좌표 대신 실제 위치를 씁니다.

`cache/` 는 카카오 이용약관의 저장·재배포 조건 때문에 깃에 올리지 않습니다.

## 카드 상품 수집기 (`collector/`)

카드사 공식 홈페이지의 공개 상품 상세 페이지에서 카드 정보와 혜택을 수집합니다.
카드사별 차이(상품 목록 얻는 법, 카드명 위치, 혜택 영역, 렌더링 필요 여부)는 `config/crawl.yml` 에 모으고 코드는 공통으로 씁니다.

```bash
cd .. && docker compose up -d && cd data   # DB (저장소 루트 .env)
uv run playwright install chromium         # 처음 한 번 (렌더링이 필요한 사이트용)
uv run python -m collector discover        # ① 상품 상세 주소 찾기
uv run python -m collector fetch           # ② 원문 수집 (이미 받은 카드는 건너뜀)
uv run python -m collector parse           # ③ 규칙 파서: 카드명·종류·연회비·출시일·대표 혜택 문구
uv run python -m collector structure       # ④ Gemini 구조화: 업종·할인율·시간대·건당/월 한도·실적 구간
uv run python -m collector load            # ⑤ DB 적재
uv run python -m collector report          # 카드사별 결과 요약
```

`--issuer KB`(카드사 지정), `--limit 5`(시험용), `--force`(다시) 옵션이 있습니다.

**수집 원칙**
- 로그인 없이 공개된 카드사 공식 상품 페이지만 읽습니다.
- robots.txt 가 허용한 주소만 요청합니다. robots.txt 가 응답하지 않으면 막힌 것으로 봅니다.
- 브라우저로 화면을 그릴 때도 robots.txt 가 막은 요청과 카드사 도메인 밖 요청은 차단합니다.
- 접속 차단을 우회하지 않습니다. 막히면 '수집 불가'로 기록합니다.
- 같은 사이트에는 2초 간격으로 한 번에 하나씩 요청합니다.
- 원문은 `cache/crawl/` 에만 두고 깃에 올리지 않습니다. 근거(`evidence.jsonl`)에는 주소·시각·해시만 남깁니다.

**카드사별 수집 방법**

| 카드사 | 상품 목록 | 비고 |
|---|---|---|
| KB국민, 하나, 토스뱅크 | 사이트맵 | |
| 우리 | 우리카드가 공개한 `llms.txt` | 상세는 화면을 그려야 함 |
| 현대 | 카드 목록 페이지를 그려서 | |
| 신한 | 메인 노출분 + 시드 | 목록 요청 경로가 robots.txt 금지 |
| BC, NH농협 | 시드만 | 목록이 보안 프로그램 설치 화면으로 넘어감 |
| 삼성, 카카오뱅크, IBK | 수집 안 함 | robots.txt 불허 |
| 롯데 | 수집 안 함 | 응답 없음·연결 끊김 |

자동으로 목록을 얻을 수 없는 카드사는 `config/crawl_seeds.yml` 에 상세 페이지 주소를 적으면 수집합니다.

## 포함하지 않은 것

- K-패스 정부 환급 계산 (카드사 혜택만 계산)
- 업종 비중·온라인과 배달의 시간대 비중 보정 (금액과 지출 격차만 제공 데이터에 맞춤)
- 행사의 기간 누적 한도와 1인 횟수 제한 (건당 한도만)

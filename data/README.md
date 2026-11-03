# 가상 소비 데이터 생성기

가상 카드 12장을 3~5장씩 가진 사용자 305명(데모 5 + 배경 300)이 2026-08-01부터 2026-11-27 10:00까지 결제한 내역을 만든다.
지금은 **소비 데이터만** 만든다. 카드 혜택·실적·한도는 실제 카드 상품과 프로모션을 확보한 뒤 이 결제 내역에 매칭해서 계산한다.

## 실행

```bash
cd data
uv sync                              # 처음 한 번
uv run python -m generate.main       # 생성 (5초 안팎)
uv run python -m generate.summary    # 숫자 확인
uv run pytest                        # 검증
```

같은 `seed`(config/settings.yml)면 누가 돌려도 같은 결과가 나온다. 결과물(`out/`)은 깃에 올리지 않고 각자 다시 만든다.

## 카카오 실제 가맹점 위치 (선택)

1. Kakao Developers에서 앱을 만들고 REST API 키를 받는다.
2. `.env.example`을 `.env`로 복사하고 `KAKAO_REST_API_KEY`를 채운다.
3. `uv run python -m generate.kakao_fetch` → `cache/kakao_places.csv`
4. 다시 `generate.main`을 돌리면 가상 좌표 대신 실제 위치를 쓴다.

`cache/`는 카카오 이용약관의 저장·재배포 조건을 확인하기 전까지 깃에 올리지 않는다.

## 설정 파일

| 파일 | 내용 |
|---|---|
| settings.yml | 시드, 기간, 기준일, 배경 사용자 수 |
| issuers.yml | 발급사 4곳, 오픈페이 등록 가능 여부 |
| categories.yml | 업종 20개, 결제 경로, 배치 대상 여부 |
| cards.yml | 가상 카드 12장 (가칭). 소비 데이터 생성에는 발급사·종류·태그만 쓰고 혜택 항목은 쓰지 않는다 |
| programs.yml | K-패스 환급 기준(나중에 사용), 교통 결제 방식 |
| zones.yml | 동네 11곳 |
| places.yml | 동네당 업종별 가맹점 수, 카카오 검색 규칙, 온라인 가맹점 |
| personas.yml | 사용자 유형, 카드 고르는 습관, 데모 사용자 5명 |
| population.yml | 배경 사용자 생성 규칙 |
| distributions.yml | 하루 결제 건수, 시간대·업종 비율, 금액 분포 (전부 가정값) |

## 결과 파일 (`out/parquet`, `out/csv`)

parquet에는 전체가, csv에는 기준 정보와 데모 사용자 5명분만 들어간다.
`payments.choice_reason`(가상 사용자가 카드를 고른 이유)은 생성기 전용이라 csv에서는 뺀다.

| 테이블 | 내용 |
|---|---|
| issuers, merchant_categories, card_catalog | 기준 정보 |
| merchants | 오프라인 가맹점 동네당 60곳 + 온라인·교통·자동이체 가맹점 |
| users | 사용자, 유형, 동네, 카드 고르는 습관 |
| user_cards | 보유 카드, 기본 순서, K-패스 등록 카드, 교통 대표 카드, 고지서 카드 |
| user_category_habits | 업종별 습관 카드 (직장인·맞벌이). 카드 매칭할 때 쓴다 |
| payments | 결제 내역 |

## 아직 안 한 것

- 혜택·실적·한도·K-패스 환급 계산 (`generate/benefit.py`에 계산 규칙만 있음)
- 이벤트(프로모션) 데이터
- 시연 장면 주입
- 분포를 공개 통계로 보정
- DB 적재 (스키마 V1이 아직 없음)

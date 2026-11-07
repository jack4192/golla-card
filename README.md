# SOL페이 스마트 카드 배치 에이전트

결제화면의 카드 순서를 AI 가 정하고 결제 확정은 고객이 하는 SOL페이 기능의 저장소다. 신한 교육과정 금융 AI 에이전트 경진대회용이다.

## 구성

| 폴더 | 내용 | 실행 방법 |
|---|---|---|
| `data/` | 가상 소비 데이터 생성기와 카드 상품 수집기 | `data/README.md` |
| `solpay-ai/` | 카드 배치 AI 엔진(FastAPI), 학습·평가 코드 | `solpay-ai/README.md` |
| `db/`, `docker-compose.yml` | 로컬 PostgreSQL(PostGIS) | `docker compose up -d db` |

앱(Expo)과 Spring 서버는 이 저장소에 `frontend/`, `backend/` 로 합칠 예정이다. 앱은 Spring 만 호출하고, Spring 이 `solpay-ai` 의 `POST /internal/rank` 를 부른다. API 계약은 `solpay-ai/openapi.json` 에 있다.

## 처음 실행

```bash
cd data && uv sync && uv run python -m generate.main
cd ../solpay-ai && uv sync && uv run python -m training.build_priors && uv run pytest
```

## 깃에 올리지 않는 것

`.env`(비밀번호·API 키), `data/out`(생성 결과), `data/cache`(카카오 수집 결과), `solpay-ai/artifacts`(학습 결과)는 각자 만든다.
카드 이름과 혜택은 모두 임의로 만든 가정값이다.

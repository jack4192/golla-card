# 가상 POS (로컬 시연용)

가맹점 단말기를 흉내 내는 작은 FastAPI 서버입니다. 앱 결제 화면의 QR·바코드를 찍거나 번호를 넣으면 백엔드에 승인 요청을 보내고, 결과를 화면에 보여 줍니다.

> 실제 카드·결제망과는 연결되지 않습니다.

배포 서버에서는 이 폴더 없이 백엔드가 같은 화면을 `/pos` 로 보여 줍니다 (https://paymate.duckdns.org/pos). 이 폴더는 맥에서 휴대폰으로 시연할 때 씁니다.

```
휴대폰 앱 ── 결제 QR 표시
     │
가상 POS (demo/, 8000) ── 카메라로 QR 읽기, 가맹점·금액 선택
     │  POST /api/v1/pos/payments
     ▼
백엔드 (8080) ── 승인, 결제 내역 저장, 혜택 계산
```

## 실행

보통은 저장소 맨 위의 `run_phone_demo.sh` 가 DB, AI 서버, 백엔드, 가상 POS, 앱 서버를 차례로 켜 줍니다.

```bash
./run_phone_demo.sh --no-dev
```

가상 POS만 따로 켤 때:

```bash
cd demo
python -m venv .venv && .venv/bin/pip install -r requirements.txt
POS_DEMO_TERMINAL_KEY=<백엔드와 같은 값> SOLPAY_BACKEND_URL=http://127.0.0.1:8080 \
  .venv/bin/uvicorn app.main:app --port 8000
```

- 화면: http://localhost:8000/pos
- API 문서: http://localhost:8000/docs

## 설정

| 변수 | 뜻 |
|---|---|
| `POS_DEMO_TERMINAL_KEY` | 백엔드 `backend/.env` 의 같은 이름 값과 똑같이 넣습니다 (16자 이상). 이 키가 있으면 가맹점 660곳 중 아무 곳이나 골라 결제할 수 있습니다 |
| `SOLPAY_BACKEND_URL` | 백엔드 주소 (기본 `http://127.0.0.1:8080`) |
| `SOLPAY_AI_URL`, `SOLPAY_AI_TOKEN` | AI 서버 주소와 내부 토큰 (가맹점별 카드 미리보기에 씀) |

양쪽 키가 다르면 화면에 "양쪽 POS_DEMO_TERMINAL_KEY 가 같은지 확인" 안내가 뜹니다.

특정 가맹점에만 단말기 키를 두고 싶다면 `python -m app.terminals <가맹점 번호>` 로 키를 만들고, 화면에 나온 SQL 을 백엔드 DB에 실행합니다. 키는 `demo/data/terminal_keys.json` 에 저장되고 깃에는 올라가지 않습니다.

## 카메라로 찍기

"카메라로 QR·바코드 찍기"를 누르면 QR과 Code128 바코드를 읽어 번호를 채우고 바로 승인 요청을 보냅니다.

- 카메라는 `localhost` 나 https 주소에서만 켜집니다. 휴대폰으로 맥의 POS를 열 때는 번호를 직접 입력하거나 배포 서버의 `/pos` 를 씁니다.
- 브라우저에 BarcodeDetector 가 없으면 ZXing 을 인터넷에서 불러옵니다.

## 테스트

```bash
cd demo && .venv/bin/python -m pytest
```

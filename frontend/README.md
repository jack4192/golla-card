# Pay·Mate 앱

Expo(React Native)로 만든 앱입니다. 같은 코드로 휴대폰(Expo Go)과 웹에서 돌아갑니다.

## 화면 흐름

1. **회원가입·로그인** → 약관 동의
2. **일정 관리**: 오늘 갈 곳과 시간을 입력합니다
3. **카드 추천**: 입력한 일정으로 받을 수 있는 혜택과 카드를 보여 줍니다
4. **메인 탭**

| 탭 | 내용 |
|---|---|
| 홈 | 지금 결제에 쓸 카드 순서, 오늘 일정과 하루 시간 표시줄(카드가 바뀌는 시각), 최근 이용 내역, 연말 결산, 챗봇 |
| 혜택 | 진행 중인 행사와 내 카드로 받을 수 있는 혜택 |
| 결제 | 결제 QR·바코드, 카드별 예상 혜택, 결제 카드 순서 |
| 오늘의 일정 | 오늘 일정과 일정별 추천 카드, 일정 추가·수정 |
| 카드 | 카드 상품 목록·상세, 내 카드 추가·빼기 |

## 실행

```bash
npm ci
EXPO_PUBLIC_API_URL=http://localhost:8080 npx expo start --go
```

- 휴대폰: 같은 와이파이에서 Expo Go로 QR 코드를 찍습니다. 이때 주소는 `localhost` 대신 PC의 IP로 넣습니다.
- 웹: http://localhost:8081
- Windows는 `.\scripts\start-with-backend.ps1` 이 같은 일을 합니다.
- `EXPO_PUBLIC_API_URL` 을 넣지 않으면 서버 없이 앱 안의 예시 데이터로 동작합니다 (예시 계정 `demo@example.com` / `Demo1234!`).

## 웹 배포 (AWS Amplify)

`main` 브랜치에 올리면 Amplify가 자동으로 빌드해 배포합니다.

- 빌드 결과는 `npx expo export --platform web` 으로 만든 `dist/` 입니다. Amplify 정적 호스팅에서 `_expo` 경로의 JS 를 못 찾을 때는 `node scripts/prepare-amplify.js` 로 경로를 고칩니다.
- 서버 주소는 Amplify 환경 변수 `EXPO_PUBLIC_API_URL=https://paymate.duckdns.org` 로 넣습니다. 빌드할 때 앱에 들어가는 값이라 바꾸면 다시 빌드해야 합니다.
- 아이폰 사파리에서 배포 주소를 열고 공유 → **홈 화면에 추가**를 누르면 주소창 없는 앱처럼 열립니다. 아이콘과 전체 화면 설정은 `public/` (index.html, manifest.json)에 있습니다.
- 아침 알림(웹 푸시)은 홈 화면에 추가한 앱에서 받을 수 있습니다 (`public/sw.js`).
- 개발용 '화면 미리보기' 메뉴는 배포 웹에 나오지 않습니다. 필요하면 빌드할 때 `EXPO_PUBLIC_DEV_MENU=on` 을 넣습니다.

## 폴더

| 폴더 | 내용 |
|---|---|
| `screens/` | 화면 (로그인, 회원가입, 약관, 일정 관리, 카드 추천, 메인, 결제) |
| `components/` | 화면 조각 (카드 지갑, 일정 패널, 결제 시트, 연말 결산, 챗봇 표 등) |
| `utils/` | API 호출(`api.js`), 서버·예시 모드 데이터, 계산 로직. `*Core.js` 는 화면과 떨어진 순수 함수입니다 |
| `data/` | 예시 모드용 카드 목록과 결제 데이터 |
| `assets/` | 카드 이미지, 아이콘 |
| `docs/` | AI 연동 정리(`AI_연동.md`), API 명세서, 새 노트북 설정 |

## 테스트

```bash
node --test utils/__tests__/*.mjs
```

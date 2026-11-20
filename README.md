# SOL·Pay

React Native와 Expo로 만든 모바일·웹 프런트엔드입니다. 회원가입, 간편비밀번호, 오늘의 일정, 카드·프로모션 추천, 카드 지갑, 혜택 및 결제 화면을 제공합니다.

## 로컬에서 실행

```sh
npm ci
npm start -- --go
```

Expo Go에서 터미널의 QR 코드를 스캔하면 모바일에서 열 수 있습니다. 웹만 실행하려면 `npm run web`을 사용하세요. Windows PowerShell에서 실행 정책으로 npm이 차단되면 `npm.cmd`를 사용하세요.

## 웹 빌드

```sh
npx expo export --platform web
```

빌드 결과는 `dist/`에 생성됩니다. Windows에서 AWS Amplify용 ZIP이 필요하면 `웹배포_실행.cmd`를 실행하세요. 이 명령은 `solpay-web-ready.zip`을 생성합니다. Android 개발 빌드 설정은 `eas.json`에 있습니다.

## 데이터와 인증

- 회원가입은 로컬 저장소를 사용합니다. 이메일과 전화번호의 중복 여부는 저장된 가입 기록으로 확인합니다. 웹에서는 같은 탭의 세션에 로그인 데이터가 유지됩니다.
- 백엔드 연동(서버 모드): `.\scripts\start-with-backend.ps1` 로 실행하면 `EXPO_PUBLIC_API_URL`이 설정되어 로그인·회원가입·중복 확인·로그아웃을 Spring 백엔드로 처리합니다. 그냥 `npx expo start`나 Vercel 빌드는 기존 데모 모드로 동작합니다. API 호출 코드는 `utils/api.js`에 있습니다.
- 테스트 로그인은 `demo@example.com`과 `Demo1234!`를 사용합니다. 신규 가입 비밀번호는 영문·숫자·특수문자를 포함한 8자 이상이어야 합니다.
- 카드 조회에는 40종 카탈로그를 사용합니다. 카드 이미지 매칭 기록과 카드사 출처를 확인한 별도 조사 자료는 `data/`에 있습니다.
- 실제 회원 인증, 금융기관 연동, 결제 처리를 위한 백엔드는 연결되어 있지 않습니다. 회원가입 및 결제 확인에는 테스트 정보를 사용하세요.

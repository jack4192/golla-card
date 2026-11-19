SOL페이 발표용 WEB DEMO - 초보자 배포 안내
====================================

이 ZIP은 원본 프로젝트의 App.js / screens / data / assets를 포함한 Expo 웹 시연용 소스코드입니다.
(배포용 dist가 미리 들어 있는 것은 아닙니다. 해당 Windows PC에서 한 번 빌드해야 합니다.)

1. SOLPay_No_AI_Recommendation_v2.zip을 바탕화면에 풀어서 'SOLPay_No_AI_Recommendation_v2' 폴더를 만든다.
2. 해당 폴더에서 '웹배포_실행.cmd'를 더블클릭한다. 인터넷이 필요하다.
3. 'SUCCESS!'가 뜨면 같은 폴더에 solpay-web-ready.zip이 생긴다.
4. AWS Amplify > 기존 solpay-demo 앱 > main > 배포 업데이트 > solpay-web-ready.zip 선택.
5. 배포 후 시크릿 모드에서 사이트 열기.

테스트 계정: demo@example.com / 1234
회원가입: 체험용 계정. 같은 탭에서 로그인 가능, 새로고침하면 사라집니다.
PIN/동의/진행 상태: 웹 세션 스토리지의 시연용 상태만 사용. 탭을 닫으면 제거될 수 있습니다.
결제/QR/바코드/카드: 실제 금융 서비스가 아닌 가상 데모 데이터.

[주의사항]
- 실제 주민등록정보, 생일, 이메일, 은행 계좌, 실사용 비밀번호를 입력하지 마세요.
- 이 버전에는 실사용 로그인 서버, 실제 회원 DB, 금융 API, 결제 API가 없습니다.
- AWS Amplify의 정적 호스팅만 사용하며 EC2 서버를 켤 필요는 없습니다.
- 재배포도 저장/전송량 등에 따라 요금이 발생할 수 있습니다.
- JS 파일 404를 피하려고 빌드 시 _expo 파일의 엔트리 JS를 최상위에 복사합니다.

[먼저 로컬 테스트]
폴더에서 CMD 실행 후: npx expo start --web
브라우저에서 demo@example.com / 1234 -> 이용 동의 -> PIN 등록 -> 일과 등록·추천 -> 홈/결제를 테스트하세요.
테스트가 끝나면 Ctrl+C로 종료하세요.

[프로젝트 파일 위치]
App.js: 앱 흐름
screens/: 로그인, 회원가입, PIN, 마이데이터, 홈, 결제 등
utils/: 웹-모바일 호환 저장/암호화/알림
components/: 결제 폭죽/웹 오류 화면
assets/: 이미지
scripts/prepare-amplify.js: AWS zip 경로 수정

[이번 변경]
- 독립 AI 카드 추천 화면과 진입 버튼을 제거했습니다.
- 마이데이터 분석 후 홈으로 바로 이동합니다.
- SOL 챗봇/카드 데이터는 유지했고 카드 추천 기능은 추후 챗봇에 연동할 예정입니다.
- 기존 웹배포_실행.cmd 로 빌드한 solpay-web-ready.zip을 AWS의 기존 main 브랜치에 업데이트 배포합니다.

[추가 v2 변경] 홈 AI 카드 도우미/자동 카드 선택 규칙 영역도 제거, 챗봇 유지.

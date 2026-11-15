SOL페이 독립 AI 카드 추천 제거 v2 — 적용 방법
=========================================

[이번에 확실하게 제거한 항목]
- AI 카드 추천 단독 화면 및 연결 경로
- 홈 화면의 'SOL AI 카드 도우미' 패널
- 홈 화면의 '내 자동 결제 규칙' 패널
- 분석 완료 후 카드 추천 화면 자동 이동
- 카드/금융 탭의 독립 추천 화면 버튼
- 미사용 screens/CardRecommendationScreen.js 파일

[그대로 유지]
- 테스트 로그인/회원가입/PIN/소비분석 흐름
- 홈 내 지갑/혜택, 하단 홈·혜택·결제·금융·카드
- 카드 터치 → 결제, 카드 변경, QR/바코드, 결제 완료
- 우측 상단 챗봇(나중에 AI 카드 추천 기능 통합 가능)
- data/cards.js, data/paymentBenefits.js의 상품·혜택 데이터

[중요: 이전 프로젝트에 부분 덮어쓰기를 반복하지 마세요]
1) 이 ZIP 압축을 바탕화면에 풀어 'SOLPay_No_AI_Recommendation_v2' 폴더를 만드세요.
2) 폴더의 screens/MainScreen.js를 열고 'SOL PAY · WEB DEMO v2' 문구를 확인하세요.
3) 이 폴더에서 '웹배포_실행.cmd'를 실행하세요.
4) 'SUCCESS!'가 뜨면 새로 만들어진 'solpay-web-ready.zip'을 AWS에 업로드하세요.
5) AWS Amplify > 기존 solpay-demo 앱 > main > 업데이트 배포로 올리세요.
6) 기존 사이트 주소에서 Ctrl+Shift+R, 또는 시크릿 모드로 확인하세요.

[로컬에서 먼저 테스트하려면]
- 해당 폴더 주소창에 cmd 입력 → npx expo start --web
- 정상 로드 시 홈 상단에 'SOL PAY · WEB DEMO v2' 문구가 보이고,
  'SOL AI 카드 도우미'와 '내 자동 결제 규칙' 패널이 없어야 합니다.
- 테스트 뒤 Ctrl+C로 종료하세요.

[주의]
- 원본/기존 정상 작동 폴더는 지우지 말고 보관하세요.
- '전체 프로젝트 ZIP'은 AWS에 직접 올리는 파일이 아닙니다.
- 파일 수정은 App.js/screens/...에서, 배포는 빌드 후 solpay-web-ready.zip에서 합니다.
- 실제 서버·계정·결제 API 없는 발표용 웹 데모이며, 가상정보만 사용하세요.
- AWS 정적 호스팅은 사용량에 따른 비용이 발생할 수 있으며 새 EC2 서버는 필요 없습니다.

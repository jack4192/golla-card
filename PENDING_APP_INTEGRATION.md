# App.js 최종 통합 대기

사용자 요청: App.js 코드는 지금 보내거나 수정하지 않고 마지막에 한 번에 통합.

- 회원가입 화면은 name,birthDate,phone(숫자 11자리),email(소문자),id,password를 onComplete로 전달한다. 현재 App.js는 id/password만 반영한다. 전화/이메일 중복은 SignUpScreen 모듈 메모리의 체험 가입만 비교하며 서버 검증이 아니다.
- AgreementScreen은 myDataAgreed, items:{cardInfo,spendingInfo,recommendation}, morningNotificationAgreed, notificationPermission, notificationPermissionInfo, consentVersion:'solpay-mydata-items-v2', agreedAt, itemAgreedAt를 전달한다.
- 기존 App.js의 handleAgreementNext는 items와 notification 관련 필드를 버린다. 최종 통합 시 기존 동의 키 solpay_demo_consent_v1 안에 전체 페이로드를 저장하고 readConsent 및 최초 가입 게이트를 세부 항목·버전 검사로 바꾸어야 한다. 기존 통합 동의 하나만으로 새 항목에 자동 동의한 것으로 처리하지 않는다.
- 선택한 아침 알림 동의와 OS 알림 권한은 서로 다른 값이다. 필수 동의가 완료되면 알림 거절/미지원/미요청 상태에서도 진행한다.
- 이번 요청은 알림 권한 요청까지다. 실제 아침 시간 선택/매일 로컬 알림 예약/클릭 일정 이동은 아직 구현하지 않았다. Expo Go 로컬 알림과 웹/원격 푸시를 구별한다.
- AccountWithdrawal 컴포넌트는 기존 deleteDemoData('account') 결과 확인 후 전체 재로드하여 로그인 첫 화면으로 돌아간다. scripts/add-account-withdrawal.cjs가 MainScreen 설정 하단에 컴포넌트를 삽입한다. App.js는 변경하지 않는다.

## 가상 마이데이터 기능 준비 완료
- scripts/setup-mydata.py가 최종_DB_1년.zip에서 데모 5명만 추출. 사용자 인증/전화/이메일/비밀번호 해시는 추출하지 않음.
- data/myDataFixture.json: 2026.05~10 소비 분석, 2026.11.05 현재 실적과 적용 혜택 기록 기반 월 한도. 원화/포인트/사용금액/횟수/미확인 단위를 분리.
- utils/myDataService.js: importMyData, restoreMyData, getMyDataSnapshot, subscribeMyData, mergeImportedWallet, clearMyDataMemory, waitForMyDataWrites.
- MyDataLoadingScreen(onNext,userId?): 기본은 수동 선택 데모1. 완료 버튼에서 onNext(snapshot). MyDataScreen(onNext): 저장된 선택 사용자로 실제 집계 화면.
- MainScreen은 구독으로 자동 등록 카드와 카드 상태를 표시하고, utils/wallet.readWallet도 가져온 카드를 병합함. 새로 가져온 카드의 전역 activeCardId 동기화 및 로그인 계정과 DB userId 연결은 최종 App.js 통합 필요. 데모 사용자 선택은 인증이 아님.
- 최종 App.js 흐름: 동의 → PIN → MyDataLoading → MyDataResult → DailyRoutine → RoutineRecommendation → Main. 분석 결과의 '다음'은 finishDemo 대신 DailyRoutine으로 연결. import 성공 후 reloadWallet로 전역 지갑 갱신. 지금은 기존 개발자 메뉴의 MyDataLoading/MyDataResult로 확인.
- utils/privacyData.js는 새 불러오기 선택 키 삭제와 메모리 초기화를 추가하여 회원탈퇴/개인 데이터 삭제 시 잔존하지 않음. 읽기/쓰기 큐 대기 후 삭제.
- csv (1).zip은 원본 DB와 다른 스키마이며 user_category_habits 등 정답성 정보가 있어 추천 입력에 자동 합치지 않음.

## 추천 화면 디자인 변경
- RoutineRecommendationScreen.js 전체 교체: 한 장 중심 추천 + 원본 카드사 이미지 + 이미지 로딩 완료 후 spring/별 파티클 등장 + 모션 줄이기 존중.
- 이 화면의 보유카드 등록/실적/금액 수기 입력 UI 제거. 기존 저장 설정을 삭제하지는 않으며, 추천 시 과거 입력 가정 금액·실적은 사용하지 않음.
- 기존 카드사 이미지22개 HTTP/이미지 응답 확인. CARD_PRODUCTS의 해당 상품 원본 이미지를 contain으로 표시하며 이미지 실패 시 다른 디자인을 대신 생성하지 않음.
- 추천은 기존 일과 기반 엔진. 미보유 우선 최대3개, 한 번에 한 장. 최근4주 문구는 myDataService의 가상 내역 중 기록된 마지막 완료월 말 기준28일을 집계한 때만 표시하며, 확인되지 않은 추가 이익 금액을 생성하지 않음.
- 카드 신청은 공식 상품 URL 열기. 실제 회원/발급 신청 저장이 아님. 괜찮아요는 onNext()만 호출하여 새 카드를 보유 카드로 자동 등록하지 않음.
- 최종 App.js 연결 때 기존 onPreferencesChange/onUseCard props는 이 추천화면에서 사용하지 않으며 보유카드 등록은 지갑에 유지할 것.

## 결제 화면 개편
- screens/PaymentScreen.js: 실제 선택 카드 이미지, 가상 예상 혜택/기존 카드 비교, 실제 QR·Code128 도형, 아래 선정 이유/혜택 상세. 고정 Flea/150원/5초 자동승인 제거.
- 의존성: react-native-svg(Expo 호환 설치), qrcode-generator, jsbarcode.
- 부모 props card/cards/onSelectCard/onClose/navigation 모두 호환, 실제 이미지가 없는 기존 가상상품은 다른 상품 이미지를 대체하지 않고 선택 안내.
- 혜택은 명시된 가상조건(없으면 전월40만원, 잔여한도충분, 상세조건충족) 예시이며 계산 불가/단위다름은 차액 미표시. 실현 절약 아님. 승인도 명시적 '가상 POS 승인 체험' 버튼만.
- 18자리 숫자 문자열(leading zeros 유지), 60초 절대시각 만료, 카드/시나리오 변경 즉시 이전코드 무효화. 배경에서 코드 숨김 및 밝기/캡처 보호 정리. 네트워크 실제 결제/POS 폴링 없음. 가상승인 결과는 현재 화면 로컬만이며 DB/실적 반영은 후속 App/service 통합.

## 결제 배치 재변경
- QR·Code128 패널을 카드 이미지보다 위로 이동.
- realProductCard/realWalletCards는 기존 임의 3상품(shinhan/kb/kpass)을 제외하고, 카드 CSV+카드사 원본 이미지 또는 PDF 대조8종 실제상품 이미지가 있는 보유 항목만 표시.
- 전달된 image/name을 그대로 믿지 않고 매칭 카탈로그의 상품명·이미지로 정규화. 임의 카드번호도 UI에서 제거. 선택 상품이 제외되면 첫 실제상품으로 선택하고 기존 onSelectCard에 동기화.
- 보유 목록에 이미지가 확인된 실제 상품이 하나도 없으면 등록 안내. 미보유 추천 후보를 임의로 지갑에 추가하지 않음.
- App.js는 변경하지 않음.

## 결제 카드 표시 순서
- scripts/add-payment-card-order.cjs: 결제 화면 하단 목록과 위·아래 순서 편집, 저장·취소 및 저장 실패 유지. App.js 변경 없음.
- components/PaymentCardOrder.js: 재정렬은 결제 카드 선택과 분리. 기존 실제 상품 이미지 사용, 편집 저장 버튼 하단 고정.
- solpay_payment_card_order_v1: 기기 데모 저장소 사용. 웹은 sessionStorage라 동일 탭 세션에서 유지. 계정별 서버 동기화 아님. privacyData PERSONAL 목록에 추가하여 삭제·탈퇴 시 제거.


## 상세 일과 설정
- scripts/add-detailed-routine.cjs: DailyRoutineScreen을 기존 질문 + DetailedRoutineScreen 순서로 연결. 기존 질문은 DailyRoutineQuestionsScreen.js에 보존. App.js 변경 없음.
- 펼침 업종 선택13종, 시작·종료 시간 직접 입력, 자정 넘김, 요일 다중 선택, 주/월1~99회, 동일 업종 여러 시간대 및 최대20개.
- routine_profile의 detailedRoutine 배열에 구조화 저장. 기존 일과 삭제·개인정보 삭제 시 함께 삭제. read 실패 시 덮어쓰기 차단, save 실패 시 입력 유지, back 시 양쪽 draft 유지.
- makeSignals에 해당 요일·빈도와 업종별 이유 반영. 현재 혜택 조건 판정은 기존 엔진 사용. 입력 시간은 추천 이유/구조화 정보이며 미래 시간대별 할인액 계산이나 AI 모델 학습·서버 전송은 구현하지 않음.
- 검증: 상세 입력/시간 범위/자정/요일/빈도/저장 실패/기존 답변 보존/삭제/화면 연결 테스트, Expo 웹 export 통과. ESLint·TypeScript 패키지 및 설정 없음. 실기기 시각 검증 미수행.


## 카드사·가맹점 제공 추천 분리
- 사용자 확인: ‘직접 제공한 추천 목록’ 의미이나 API·제공 파일 없음. 데이터를 임의로 생성하거나 앱 계산 추천을 제공처 추천으로 재표시하지 않음.
- scripts/set-provider-recommendations.cjs: 번호탭을 1. 카드사 추천 / 2. 가맹점 추천으로 고정. data/providerRecommendations.js의 issuer/merchant는 빈 배열.
- 기존 화면을 RoutinePatternRecommendationScreen.js에 보존. 참고 추천은 한 장만 표시해 기존 1~3 페이지 버튼 제거. 카드사 탭에서 사용자가 명시적으로 여는 앱 자체 추천으로 구분.
- RoutineRecommendationScreen의 onNext/onBack 및 기존 helper exports 유지. 실제 제공 rows는 출처명·HTTPS URL·실제 카드 코드 등 필드 검사 후 표시. 이는 출처 진위 인증 또는 API 조회가 아님.
- 실제 데이터 수신·계정별 권한·만료 및 API 갱신은 미구현. App.js 변경 없음. 빈 상태/탭/출처 분리/링크 실패/기존 추천 회귀와 웹 export 통과. 실기기 미확인, lint/typecheck 도구 미설치.


## 카드 두 장 추천 및 메인 실행 팝업 (최신)
- scripts/add-two-card-popup.cjs: 사진의 큰 실제 카드 화면 복원. 번호는 1=카드사 추천, 2=가맹점 추천만. 실제 제공 목록은 없어 시연 출처 명시.
- 카드사 슬롯은 기존 일과 순위 한 장, 가맹점 슬롯은 BRAND_ONLY 상품 혜택과 일과 분야를 대조해 한 장. 실제 상품 이미지·등장 효과·공식 신청 주소 유지. 조회/선정 실패 시 임의 데이터로 보충하지 않음.
- MainScreen 홈이며 다른 모달이 닫힌 경우 팝업. App.js 변경 없음. 일반 추천 화면에 7일 숨김 버튼 없음.
- 시작 후 첫 메인, background→active 복귀에 표시. 일반 화면 재진입에는 중복 표시하지 않음. 닫기는 이번 실행, 숨김은 정확히 604800000ms. 웹 localStorage, 네이티브 기존 Store, privacyData 삭제 목록 연동.
- 저장 실패 시 창 유지 및 재시도. 읽기 실패 시 숨김 설정을 무시하지 않고 노출하지 않음. 기기 저장이며 계정별 서버 동기화 아님.
- 두 카드/가맹점 조건/만료 경계/실패 처리/복귀/화면 전환/회귀 테스트와 웹 export 통과. 실기기 UI 미확인. ESLint·TypeScript 미설치.

## 일정 전체 화면 표시
- components/SpecialScheduleModal.js 한 파일 교체. 기존 TodaySchedulePanel props/콜백 연결 유지, App.js 변경 없음.
- opaque fullScreen Modal로 하단 sheet를 전체 화면 페이지 형태로 표시. 별도 URL/라우터 경로는 추가하지 않음. 고정 상단 뒤로가기 및 하단 확인·돌아가기, 본문만 스크롤.
- 기존 visible 전환 동안 작성중 상태 유지. 등록·수정·삭제 후 로컬 목록 업데이트, 쓰기 실패 시 입력/목록 유지. 작성중 날짜 변경을 차단해 다른 날짜로 실수로 이동 저장하는 문제 방지.
- 오늘 날짜에서만 확인 완료 노출. 미저장 입력이 있으면 확인 전 저장·취소 안내, 읽기 실패/읽기 전용에서 쓰기 차단. 실제 모바일 시각검증은 미수행.
- schedule-page-test 및 추천 팝업 회귀 검증, Expo 웹 export 통과. ESLint·TypeScript는 미설치로 실행 불가.


## 메인 지갑 마우스 휠 전환
- 원인: 수평 FlatList에 일반 마우스 세로휠 → 카드 전환 매핑 없음. 기존 카드 터치/결제 및 렌더링 코드를 유지하고 WalletWheelControls로 감쌈.
- scripts/fix-wallet-wheel.cjs 전체 설치 코드. 새 components/WalletWheelControls.js 및 MainScreen의 wallet 렌더 wrapper/import만 연결. App.js 변경 없음.
- 웹은 root DOM에 capture=true/passive=false wheel 리스너. 한 번에 한 장, 트랙패드 누적 및240ms 제한, 처음/끝에서는 페이지 스크롤 허용, Ctrl/Meta 확대 및 취소 불가 이벤트 제외. 네이티브는 DOM 리스너 등록 안 함.
- 이전/다음 버튼과 현재 장수 표시. 선택은 기존 onSelectCard를 통해 동기화, 결제 화면 자동 열기 없음. 원래 카드 클릭 결제·손가락 스와이프·레이아웃 AST 보존 검증.
- 휠/버튼/경계/빈 목록/동적 목록/이벤트 정리/네이티브 분기/회귀 테스트 통과. 실브라우저 마우스 조작과 기기 터치 검증은 미수행. ESLint·TypeScript 미설치.


## 메인 지갑 실제 상품 이미지
- scripts/use-real-wallet-images.cjs: MainScreen의 wallet FlatList renderItem 색상 카드만 WalletProductCard로 교체. 기존 결제 onPress 콜백·pager폭·스와이프·휠 wrapper 유지. App.js 변경 없음.
- WalletProductCard는 CSV 카탈로그의 상품 코드/정확한 이름과 타입, 기존 PDF 이미지 카탈로그로만 대응. 임의 card.image를 실제 상품으로 믿거나 다른 상품 이미지를 대체하지 않음.
- 중앙 정렬 최대 너비440, 이미지 영역 최대360 및 contain. 모바일에서 화면 폭에 맞게 줄어들고 카드 자체 비율 유지. 가짜 칩/와이파이/색상 배경 디자인 제거.
- 기존 임의 시연3상품 등 정확한 이미지가 없는 항목은 삭제하거나 선택을 바꾸지 않고 확인 안내. 네트워크 실패 시 재시도 버튼은 결제 버튼과 별도여서 결제 화면을 열지 않음.
- 이미지22개 HTTP·이미지응답 확인 및 로컬8종 자료 경로 확인. 상품 매칭/가짜이미지 배제/재시도/결제콜백보존/휠/페이징 회귀 테스트 통과. 실기기 및 실제 화면 시각검증 미수행. ESLint·TypeScript 미설치.


## 전체 인터페이스 정리
- scripts/polish-interface.cjs 전체 설치 코드로29개 화면/컴포넌트 스타일을 직접 갱신. 추가 런타임 의존성 없음. App.js SHA256 및 데이터/인증·추천 로직 유지. 질문7개 문구는 승인 대기 상태 그대로.
- 공통 배경/청색/본문/안내색/테두리, 읽기 쉬운 글자·줄간격, 주 버튼54 및 보조 버튼44 이상, 입력창52, 모서리14~24 정리. 메인 본문1040·설정800·가입600·일과720 등 최대너비 적용.
- 메인 지갑은 실제 onLayout 너비를 측정해 pager 크기 계산. WalletWheelControls에 onLayout 전달만 추가. 반복 레이아웃/invalid 측정값 차단, 현재 카드 선택을 바꾸지 않음.
- 백업은 각 파일.before-ui-polish.bak. 두 번 실행해도 중복 상태/핸들러/추가 스타일 누적 없음. 다른 기능 설치 코드를 적용한 뒤 최종 스타일 코드로 다시 실행 가능.
- 로그인/가입중복·동의권한·탈퇴·개발자이동·실제이미지·휠·카드순서·광고7일·추천·일정·상세일과·마이데이터 회귀 및 반응형 레이아웃 로직 테스트 통과. 실제 브라우저/실기기 시각검증 미수행. ESLint·TypeScript 미설치.


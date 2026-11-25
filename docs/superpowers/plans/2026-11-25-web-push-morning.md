# 바탕화면 웹앱 아침 일정 웹 푸시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아이폰 바탕화면 웹앱에 매일 7시·'지금 받기' 웹 푸시를 보내고, 누르면 일정 관리를 열며, 누른 뒤에도 같은 알림을 다시 띄운다.

**Architecture:** 백엔드(Spring)가 구독을 JdbcClient 로 저장하고, JDK 암호화(RFC 8291)+VAPID(jjwt ES256)로 푸시 서비스에 직접 POST 한다. 7시 예약은 `PUSH_MORNING_ENABLED=on` 인 서버에서만. 앱(웹)은 `public/sw.js` 서비스 워커와 설정 화면 토글·버튼으로 구독한다.

**Tech Stack:** Spring Boot 4 / Java 21 (JDK crypto, java.net.http, jjwt 0.13), Expo SDK 58 web (react-native-web), 서비스 워커·Push API.

**Spec:** `docs/superpowers/specs/2026-11-25-web-push-morning-design.md`

## Global Constraints

- 문구(정확히): 제목 `좋은 아침이에요! 오늘은 어디 가세요?` / 본문 `일정을 알려 주시면 가는 곳마다 혜택 큰 카드를 미리 골라 둘게요.`
- 누르면 여는 주소 `/?open=schedule`, 알림 tag `morning-schedule`
- 7시 예약 `cron "0 0 7 * * *"`, zone `Asia/Seoul`, `PUSH_MORNING_ENABLED=on` 일 때만
- '지금 알림 받기'는 5초 뒤 보냄
- 백엔드 새 라이브러리 금지 (JDK + 기존 jjwt). JPA 엔티티를 만들지 않는다(`ddl-auto: validate` 영향 없게)
- 환경 변수: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`(둘 다 base64url, 공개 키는 65바이트 비압축), `VAPID_SUBJECT`, `PUSH_MORNING_ENABLED` — 값은 깃에 올리지 않는다
- 휴대폰 앱(Expo Go) 동작은 그대로, 7시 로컬 알림 문구만 위 문구로
- 커밋은 기능 브랜치(worktree)에만. final 합치기·푸시·EC2·RDS 는 사용자에게 묻는다

## Review Focus

1. 같은 기기에서 다른 계정으로 로그인해 알림을 켜면 → 그 기기는 새 계정 것이 된다(이전 계정 알림이 새 사람에게 가지 않음). Task 3 시험.
2. 알림을 끄면 → 그 기기 구독이 지워져 7시에 가지 않는다. Task 4 시험.
3. 410·404 로 만료된 구독 → 지우고 다시 보내지 않는다. Task 2·4 시험.
4. VAPID 키가 없는 서버(팀원 로컬) → 공개 키 API 는 `enabled:false`, 보내기 API 는 503, 7시 예약은 아무것도 안 함. Task 4 시험.
5. https 가 아닌 endpoint·빈 키로 구독 요청 → 400. Task 4 시험.

---

### Task 1: 웹 푸시 암호화 (RFC 8291)

**Files:**
- Create: `backend/src/main/java/com/paymate/backend/push/WebPushCrypto.java`
- Test: `backend/src/test/java/com/paymate/backend/push/WebPushCryptoTest.java`

**Interfaces:**
- Produces:
  - `static byte[] encrypt(byte[] plaintext, byte[] uaPublic65, byte[] authSecret16)` — 무작위 서버 키·salt
  - `static byte[] encrypt(byte[] plaintext, byte[] uaPublic65, byte[] authSecret16, KeyPair asKeys, byte[] salt16)` — 시험용
  - `static ECPublicKey publicKey(byte[] uncompressed65)`, `static ECPrivateKey privateKey(byte[] d32)`, `static byte[] uncompressed(ECPublicKey)`
  - `static byte[] b64(String base64url)`, `static String b64(byte[])`

- [ ] **Step 1: 실패하는 시험** — `rfc8291AppendixA`: 부록 A 입력(평문 `V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24`, as_public `BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8`, as_private `yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw`, ua_public `BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4`, salt `DGv6ra1nlYgDCS1FRnbzlw`, auth `BTBZMqHH6r4Tts7J_aSIgg`)으로 만든 결과가 `b64(header) ‖ b64(cipher)` 바이트와 같다. header=`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8`, cipher=`8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ`. 그리고 `randomKeysDiffer`: 같은 입력을 두 번 encrypt 하면 결과가 다르고 길이는 86+평문+1+16.
- [ ] **Step 2:** `cd backend && sh ./gradlew test --tests '*WebPushCryptoTest*'` → 컴파일 실패(클래스 없음)
- [ ] **Step 3:** 구현 — ECDH(`KeyAgreement "ECDH"`), HKDF-SHA256(`Mac HmacSHA256`), key_info=`"WebPush: info\0" ‖ ua_public ‖ as_public`, PRK_key=HMAC(auth, ecdh), IKM=HMAC(PRK_key, key_info‖0x01)[0..32], PRK=HMAC(salt, IKM), CEK=HMAC(PRK,"Content-Encoding: aes128gcm\0"‖0x01)[0..16], NONCE=HMAC(PRK,"Content-Encoding: nonce\0"‖0x01)[0..12], AES/GCM/NoPadding(평문‖0x02), header=salt‖rs(4096, 4바이트 big-endian)‖0x41‖as_public. 곡선 매개변수는 `AlgorithmParameters "EC"` + `ECGenParameterSpec("secp256r1")`.
- [ ] **Step 4:** 같은 명령 → PASS
- [ ] **Step 5:** 커밋 `백엔드: 웹 푸시 암호화(RFC 8291)`

### Task 2: VAPID 서명과 보내기

**Files:**
- Create: `backend/src/main/java/com/paymate/backend/push/PushSender.java` (인터페이스), `WebPushSender.java`, `PushSubscription.java`(record), `PushResult.java`(enum)
- Test: `backend/src/test/java/com/paymate/backend/push/WebPushSenderTest.java`

**Interfaces:**
- Consumes: Task 1 `WebPushCrypto`
- Produces:
  - `record PushSubscription(long id, long userId, String endpoint, String p256dh, String auth)`
  - `enum PushResult { SENT, GONE, FAILED }`
  - `interface PushSender { boolean enabled(); String publicKey(); PushResult send(PushSubscription s, String payloadJson); }`
  - `WebPushSender(String publicKeyB64, String privateKeyB64, String subject, HttpClient http)` — 키가 비면 `enabled()==false`, `send` 는 FAILED
  - `String authorization(String endpoint, Instant now)` → `vapid t=<JWT>, k=<publicKey>`

- [ ] **Step 1: 실패하는 시험** (시험용 키는 `KeyPairGenerator "EC" secp256r1` 로 생성, 받는 쪽은 `com.sun.net.httpserver.HttpServer` 127.0.0.1 임의 포트)
  - `sendsEncryptedPayload`: 받은 요청이 POST, `Content-Encoding: aes128gcm`, `TTL` 있음, `Authorization` 이 `vapid t=` 로 시작하고 `k=` 가 공개 키. 본문을 시험 쪽 UA 개인 키로 풀면(RFC 8291 역순, 시험 안 도우미) payload 와 같다. 응답 201 → `SENT`
  - `vapidJwtClaims`: JWT 를 공개 키로 검증 가능, `aud` = endpoint 의 `scheme://host[:port]`, `sub` = subject, `exp` 가 지금+24시간 이내
  - `goneOn410And404`: 410·404 → `GONE`, 500 → `FAILED`
  - `disabledWithoutKeys`: 빈 키로 만들면 `enabled()==false`, `send` → `FAILED` 이고 요청을 보내지 않는다
- [ ] **Step 2:** `sh ./gradlew test --tests '*WebPushSenderTest*'` → 실패
- [ ] **Step 3:** 구현 — JWT 는 jjwt `Jwts.builder()...signWith(privateKey, Jwts.SIG.ES256)`(헤더 typ JWT), exp = now+12h. 헤더 `TTL: 86400`, `Urgency: high`, `Content-Type: application/octet-stream`. 시간 제한 10초.
- [ ] **Step 4:** → PASS
- [ ] **Step 5:** 커밋 `백엔드: VAPID 서명·웹 푸시 보내기`

### Task 3: 구독 저장소와 표

**Files:**
- Create: `backend/src/main/java/com/paymate/backend/push/PushSubscriptionStore.java` (인터페이스), `JdbcPushSubscriptionStore.java`
- Create: `backend/shared-db/add_push_subscriptions.sql`; Modify: `backend/local-db/backend_additions.sql` (끝에 같은 문)
- Test: `backend/src/test/java/com/paymate/backend/push/InMemoryPushSubscriptionStore.java`(시험용 가짜), 실제 SQL 은 Task 6 에서 사본 DB 로 확인

**Interfaces:**
- Produces: `interface PushSubscriptionStore { void upsert(long userId, String endpoint, String p256dh, String auth); int delete(long userId, String endpoint); void deleteEndpoint(String endpoint); List<PushSubscription> forUser(long userId); List<PushSubscription> forMorning(); void markSent(long id); }`
- 표: `public.push_subscriptions(push_subscription_id bigint generated by default as identity primary key, user_id bigint not null references users(user_id) on delete cascade, endpoint text not null unique, p256dh text not null, auth text not null, created_at timestamptz not null default now(), last_sent_at timestamptz)` + `create index on push_subscriptions(user_id)`. `IF NOT EXISTS` 로 여러 번 실행해도 되게.
- `upsert` = `insert ... on conflict (endpoint) do update set user_id, p256dh, auth` (Review Focus 1: 다른 계정이 같은 기기를 켜면 그 계정 것으로). `forMorning` = `join users u ... where u.notification_agreed = true`.

- [ ] **Step 1:** 시험용 가짜 저장소를 같은 규칙(endpoint 고유, upsert 시 user 바뀜)으로 만들고 `PushSubscriptionStoreRulesTest`: 같은 endpoint 를 user 1 → user 2 로 upsert 하면 `forUser(1)` 비고 `forUser(2)` 1개
- [ ] **Step 2:** 실행 → 실패(클래스 없음)
- [ ] **Step 3:** 가짜·JdbcClient 구현과 SQL 두 파일 작성 (`JdbcClient` 는 spring-jdbc 에 있음, 새 의존성 아님)
- [ ] **Step 4:** → PASS
- [ ] **Step 5:** 커밋 `백엔드: 웹 푸시 구독 저장소와 표 SQL`

### Task 4: 서비스·API·7시 예약

**Files:**
- Create: `backend/src/main/java/com/paymate/backend/push/PushService.java`, `PushController.java`, `PushSubscribeRequest.java`, `PushErrorCode.java`(공통 오류 형식 따름), `PushConfig.java`(`@EnableScheduling`, `WebPushSender`·`TaskScheduler` 빈)
- Modify: `backend/src/main/java/com/paymate/backend/config/SecurityConfig.java` (`GET /api/push/public-key` permitAll), `backend/src/main/resources/application.yml` (`app.push.vapid-public-key: ${VAPID_PUBLIC_KEY:}` 등 4개)
- Test: `backend/src/test/java/com/paymate/backend/push/PushServiceTest.java`

**Interfaces:**
- Consumes: Task 2 `PushSender`, Task 3 `PushSubscriptionStore`
- Produces (API):
  - `GET /api/push/public-key` → `{ "enabled": bool, "publicKey": string|null }`
  - `POST /api/push/subscriptions` `{ endpoint, keys:{ p256dh, auth } }` → 204. endpoint 가 `https://` 아님·키 비면 400 `INVALID_SUBSCRIPTION`, 꺼져 있으면 503 `PUSH_DISABLED`
  - `DELETE /api/push/subscriptions` `{ endpoint }` → 204
  - `POST /api/push/test` → 202 `{ "delaySeconds": 5 }`, 기기 없으면 409 `NO_SUBSCRIPTION`, 꺼져 있으면 503
  - `PushService.MORNING_PAYLOAD` = `{"title":<제목>,"body":<본문>,"url":"/?open=schedule","tag":"morning-schedule"}`
  - `void sendMorning()` (`@Scheduled(cron="0 0 7 * * *", zone="Asia/Seoul")`, 꺼져 있으면 즉시 끝)

- [ ] **Step 1: 실패하는 시험** (가짜 저장소 + 기록하는 가짜 sender + 지연을 기록하는 가짜 스케줄러)
  - `morningSendsToAgreedOnly`: `forMorning()` 결과에만 보내고 payload 가 MORNING_PAYLOAD
  - `morningSkippedWhenDisabled`: `PUSH_MORNING_ENABLED` off → sender 호출 0
  - `goneSubscriptionIsDeleted`: sender 가 GONE → `deleteEndpoint` 호출, 다음 `forUser` 에 없음
  - `testPushScheduledAfterFiveSeconds`: 지연 5초로 예약, 실행하면 그 사용자 기기에만 보냄
  - `testPushWithoutDeviceIs409`, `disabledSenderIs503`(구독·test 모두), `invalidSubscriptionIs400`(http endpoint, 빈 p256dh)
  - `unsubscribeRemovesDevice`: delete 뒤 `forMorning` 에서 빠짐
- [ ] **Step 2:** `sh ./gradlew test --tests '*PushServiceTest*'` → 실패
- [ ] **Step 3:** 구현. 컨트롤러는 `@AuthenticationPrincipal AuthUser` 로 사용자 번호를 받는다. `TaskScheduler.schedule(task, Instant.now().plusSeconds(5))`.
- [ ] **Step 4:** 전체 백엔드 시험 `sh ./gradlew test -q` → 모두 통과 (기존 시험 수 + 새 시험)
- [ ] **Step 5:** 커밋 `백엔드: 웹 푸시 API·지금 받기·매일 7시 예약`

### Task 5: 앱 — 서비스 워커와 웹 푸시 연결

**Files:**
- Create: `frontend/public/sw.js`, `frontend/utils/webPushCore.js`, `frontend/utils/webPush.js`
- Modify: `frontend/utils/api.js` (4개 함수)
- Test: `frontend/utils/__tests__/webPushCore.test.mjs`

**Interfaces:**
- Produces:
  - `webPushCore.js`: `urlBase64ToUint8Array(s) → Uint8Array`, `opensSchedule(search: string) → boolean` (`open=schedule` 이면 true), `webPushState({ hasServiceWorker, hasPushManager, hasNotification, standalone, isIOS }) → 'ready'|'install'|'unsupported'` (아이폰인데 홈 화면 앱이 아니면 'install'), `SW_OPEN_MESSAGE = 'open-schedule'`
  - `webPush.js`: `registerServiceWorker()`, `currentWebPushState()`, `isWebPushOn() → Promise<boolean>`, `enableWebPush() → Promise<void>`(권한 거절이면 `Error('denied')`), `disableWebPush()`, `sendTestPush()`, `addWebPushOpenListener(onOpen) → unsubscribe`(주소 `?open=schedule` 이면 한 번 부르고 주소에서 지움, 서비스 워커 메시지 `open-schedule` 도)
  - `api.js`: `pushPublicKey()`, `savePushSubscription(json)`, `deletePushSubscription(endpoint)`, `sendTestPush()`
  - `sw.js`: `push` → `showNotification(title, { body, tag, icon:'/icon-192.png', badge:'/icon-192.png', data:{url} })`. `notificationclick` → 같은 출처 창이 있으면 focus + `postMessage({type:'open-schedule'})`, 없으면 `openWindow(url)`, 그리고 **같은 제목·본문·tag 로 `showNotification` 을 다시** 부른다 (`event.waitUntil` 안에서, 시연용).
- [ ] **Step 1:** `webPushCore.test.mjs` — `urlBase64ToUint8Array('AQID') ` → `[1,2,3]`, 패딩 없는 base64url 처리; `opensSchedule('?open=schedule')` true, `'?x=1'` false; `webPushState` 아이폰+standalone false → `'install'`, 다 있음 → `'ready'`, PushManager 없음 → `'unsupported'`
- [ ] **Step 2:** `cd frontend && node --test utils/__tests__/webPushCore.test.mjs` → 실패
- [ ] **Step 3:** 구현 (`webPush.js` 는 `Platform.OS === 'web'` 이 아니면 아무것도 안 하는 함수들)
- [ ] **Step 4:** → PASS, `node --test utils/__tests__/*.test.mjs` 전체 통과
- [ ] **Step 5:** 커밋 `앱(웹): 서비스 워커·웹 푸시 구독`

### Task 6: 앱 화면 연결 + 로컬 끝까지 확인

**Files:**
- Modify: `frontend/App.js` (웹: 시작 때 `registerServiceWorker()`, `addWebPushOpenListener(() => setMorningSchedulePending(true))`), `frontend/screens/MainScreen.js` (설정 '서비스·이용 동의' 묶음), `frontend/utils/notifications.js` (휴대폰 앱 7시 문구를 Global Constraints 문구로)

**Interfaces:**
- Consumes: Task 5 `webPush.js`
- 설정 화면(웹):
  - `ready`: 토글 `폰 알림 받기 (알림 수신 동의)` / `매일 오전 7시 일정 입력 안내`. 켜기 = `enableWebPush()` → `api.saveNotificationAgreement(true)` → 기기 동의 저장. 끄기 = `disableWebPush()` → 동의 false. 권한 거절 → `Alert('알림 권한 필요', '아이폰 설정 > 알림 > Pay·Mate 에서 알림을 허용한 뒤 다시 켜 주세요.')`
  - 켜져 있으면 그 아래 항목 `지금 알림 받기` / `5초 뒤 알림이 와요. 홈 화면으로 나가 보세요` → `sendTestPush()`, 성공 시 같은 안내 Alert
  - `install`: 항목 `폰 알림 받기` / `홈 화면에 추가한 Pay·Mate 앱에서 켤 수 있어요`
  - `unsupported`: 지금처럼 `알림 수신 동의` 값 표시

- [ ] **Step 1:** 앱 시험 전체 통과 확인, 웹·iOS 묶음 만들기 (`npx expo export --platform web`, `--platform ios`) → 성공, 웹 묶음 `dist/sw.js` 있음
- [ ] **Step 2:** 로컬 끝까지: VAPID 키를 node `crypto.generateKeyPairSync('ec',{namedCurve:'P-256'})` 로 만들어(파일·깃에 안 남김) 사본 DB `v21_append_test` 에 표 SQL 실행 → 백엔드 8191(사본 DB, 키 환경 변수, `PUSH_MORNING_ENABLED` off) → curl 로 public-key·잘못된 구독 400·test 409 확인, 데모 웹 8187 에서 설정 화면 상태 확인
- [ ] **Step 3:** 커밋 `앱(웹): 설정에서 폰 알림 켜기·지금 알림 받기, 알림 누르면 일정 관리`

### Task 7: 배포 (각 단계 사용자 확인)

- [ ] 로컬 final 합치기 → GitHub 푸시 (사용자 확인)
- [ ] 공용 RDS 에 `backend/shared-db/add_push_subscriptions.sql` 실행 — 사용자
- [ ] EC2: `.env` 에 VAPID 키 4개 값 추가, 최신 final 받아 백엔드만 다시 빌드 (사용자 허락 뒤 SSH)
- [ ] Amplify 배포 확인 + `curl -I https://<웹앱>/sw.js` 가 `javascript`
- [ ] 아이폰 확인 안내 (사용자)

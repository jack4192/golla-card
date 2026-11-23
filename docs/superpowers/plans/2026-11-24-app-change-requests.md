# 앱 수정사항 4가지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수정사항 문서의 4가지를 반영한다: 카드 상세 '카드 신청', 자동 배치 ON/OFF(스위치·'자동 배치 적용'·확인 창·안내 문구), '일정 다시 확인' 돌아가기.

**Architecture:**
- 자동 배치 상태는 한 모듈(`utils/autoPlacement.js`)이 앱 저장소에 두고, 홈과 결제 화면이 같은 훅으로 읽는다.
- 판단 로직(저장값 해석, 신청 링크, 목록 동기화 동작)은 순수 함수(`utils/autoPlacementCore.js`)로 빼서 `node --test` 로 시험한다.
- 화면은 `PaymentCardOrder`·`TodaySchedulePanel`·`MainScreen`·`PaymentScreen`·`App.js` 를 고친다.

**Tech Stack:** Expo React Native (web 확인), node --test

**Spec:** `/Users/jinwoo/Desktop/solpay-final/docs/superpowers/specs/2026-11-24-app-change-requests-design.md`

## Global Constraints

**화면 문구 (그대로)**

| 자리 | 문구 |
|---|---|
| 끄기 확인 창 | 제목 `자동 배치를 끌까요?` / 본문 `끄시면 할인과 프로모션 혜택을 못 받으실 수 있어요!` / 버튼 `취소`·`확인` |
| 순서 바꾸기 확인 창 | 제목 `정말로 카드 순서를 바꾸시겠습니까?` / 본문 `바꾸면 AI 자동 배치가 꺼지고 정한 순서대로 써요. '자동 배치 적용'으로 언제든 되돌릴 수 있어요.` / 버튼 `취소`·`바꾸기` |
| 내 카드 버튼 | `자동 배치 적용` |
| 내 지갑 스위치 | `자동 배치` |
| 홈 맨 아래 안내 | `본 시스템은 AI를 활용한 카드 자동 배치 및 추천으로 부정확한 안내가 포함될 수 있습니다. 평소 소비가 아주 적은 편이거나 불규칙적이신 분께는 일부 오안내가 섞일 수 있습니다.` |
| 카드 상세 버튼 | `카드 신청`(파랑)·`닫기`(흰색) |

**동작 규칙**
- 자동 배치 기본값은 ON 이다. 저장 키는 `solpay_auto_placement_v1`, 값은 `'on'`/`'off'` 이고 그 밖의 값은 ON 으로 본다.
- OFF 의 범위는 카드 순서뿐이다.
  - 홈 '내 카드'와 결제 화면 목록은 AI 순서를 쓰지 않고, 결제 화면은 AI 1순위를 자동으로 고르지 않는다.
  - AI 추천 상자, 홈 일정 카드, 시간 표시줄, 팝업은 그대로 둔다.
- 순서 확인 창은 ON 일 때만 띄운다. 누르기·끌기·화살표 키 모두 해당한다.
- '보유 카드로 등록'은 없앤다(대신 만들 곳 없음).
- 다른 세션의 커밋 안 한 파일(`MainScreen.js` 결산 문구 2줄, `api.js`, `YearEndReport.js`, 백엔드)은 worktree 에서만 작업하고 건드리지 않는다.
- 시험: `cd frontend && node --test utils/__tests__/*.test.mjs`. 커밋 메시지 끝은 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 이다.

## Review Focus

1. **AI 순서가 시간대가 바뀌어 달라질 때:** ON 이면 결제 카드가 새 1순위로 따라가야 하고, 저장된 내 순서는 바뀌지 않아야 한다. `syncAction` 시험으로 확인한다.
2. **결제 화면·QR 창에서 다른 카드를 골랐다가 홈에 돌아올 때:** ON 이면 홈은 AI 1순위로 되돌리고(그 결제에만 쓴 선택), 자동 배치를 끄지 않는다. `syncAction` 시험으로 확인한다.
3. **AI 순서가 없을 때(데모 모드·AI 실패):** ON 이어도 지금처럼 '선택한 카드를 맨 위로' 동작을 지킨다. `syncAction` 시험으로 확인한다.
4. **끌기 도중 확인 창에서 취소:** 원래 순서로 돌아가고 아무것도 저장하지 않는다. Task 3 화면 확인으로 본다.
5. **스위치로 끌 때:** 보이던 AI 순서가 내 순서로 저장되어 목록이 바뀌지 않아야 한다. Task 3 화면 확인으로 본다.

---

### Task 1: 순수 함수

**Files:**
- Create: `frontend/utils/autoPlacementCore.js`
- Test: `frontend/utils/__tests__/autoPlacementCore.test.mjs`

**Interfaces — Produces:**
- `AUTO_PLACEMENT_KEY = 'solpay_auto_placement_v1'`
- `parseAutoPlacement(raw) -> boolean`: `'off'` 만 false 이고, 나머지(null 포함)는 true 다.
- `serializeAutoPlacement(on) -> 'on' | 'off'`
- `applyUrl(product) -> string | null`: `product.sourcePage` 가 `https://` 로 시작하면 그 값, 아니면 null.
- `syncAction({ autoOn, usingAi, firstId, selectedId, lastSelectedId, selectedIndex }) -> 'none' | 'selectTop' | 'moveSelectedToTop'`
  - 맨 위 카드가 없거나 이미 결제 카드면 `'none'` 이다.
  - `autoOn && usingAi` 면 언제나 `'selectTop'` 이다 (AI 1순위를 결제 카드로).
  - 그 밖은 지금 로직 그대로다: 결제 카드가 다른 곳에서 바뀌었고(`selectedId !== lastSelectedId`) 목록 안 1번째 뒤에 있으면 `'moveSelectedToTop'`, 아니면 `'selectTop'`.

- [ ] **Step 1: 실패하는 시험 작성**
  - parse: `null→true`, `'on'→true`, `'off'→false`, `'x'→true`.
  - serialize: `true→'on'`, `false→'off'`.
  - applyUrl: `https://www.shinhancard.com/...`→그대로, `http://a`→null, `{}`→null, `null`→null.
  - syncAction:
    - `{autoOn:true, usingAi:true, firstId:'A', selectedId:'B', lastSelectedId:'B', selectedIndex:2}` → `'selectTop'`
    - 같은데 `lastSelectedId:'C'` 여도 → `'selectTop'` (다른 곳에서 골랐어도 ON+AI 면 1순위로)
    - `{autoOn:true, usingAi:false, firstId:'A', selectedId:'B', lastSelectedId:'C', selectedIndex:2}` → `'moveSelectedToTop'`
    - `{autoOn:false, usingAi:false, firstId:'A', selectedId:'B', lastSelectedId:'B', selectedIndex:2}` → `'selectTop'`
    - `firstId === selectedId` → `'none'`, `firstId == null` → `'none'`
- [ ] **Step 2: 실패 확인** — `node --test utils/__tests__/autoPlacementCore.test.mjs`. Expected: 모듈 없음으로 FAIL.
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 앱 전체 node 시험이 59 + 새 시험으로 모두 통과해야 한다.
- [ ] **Step 5: 커밋** — `앱: 자동 배치 판단 순수 함수 (저장값·신청 링크·목록 동기화)`

### Task 2: 자동 배치 상태 저장·훅

**Files:** Create `frontend/utils/autoPlacement.js`

**Interfaces — Produces:** `useAutoPlacement() -> { on: boolean, ready: boolean, setOn(on: boolean): Promise<void> }`
- 모듈 수준 값과 구독자 목록을 두어 홈과 결제 화면이 같은 값을 본다.
- 처음 읽을 때 `Store.getItemAsync(AUTO_PLACEMENT_KEY)` 를 `parseAutoPlacement` 로 해석한다.
- `setOn` 은 값을 바로 바꾸고 구독자에게 알린 뒤 저장한다. 저장에 실패해도 값은 유지한다.

- [ ] **Step 1: 구현** (저장소는 `./demoStore` 를 `* as Store` 로 가져온다. api.js 와 같다)
- [ ] **Step 2: 앱 시험 통과 확인 후 커밋** — `앱: 자동 배치 상태를 기기에 저장하고 화면끼리 같이 쓰기`

### Task 3: 내 카드 목록 (`PaymentCardOrder`)

**Files:** Modify `frontend/components/PaymentCardOrder.js`

**Interfaces**
- **Consumes:** Task 1 `syncAction`.
- **Produces — props:**
  - `autoOn?: boolean`: 정의되면 홈 모드다. 버튼과 확인 창을 쓴다.
  - `onAutoChange?: (on: boolean) => void`

- [ ] **Step 1: 머리 버튼**
  - `autoOn !== undefined` 면 '내 카드 · N장' 오른쪽에 `자동 배치 적용` 알약 버튼을 둔다.
  - 켜짐은 파란 바탕·흰 글자, 꺼짐은 테두리·회색 글자다. `accessibilityState={{ selected: autoOn }}` 를 준다.
  - 꺼짐에서 누르면 `onAutoChange(true)` 를 부른다.
  - 홈 모드에서는 `usingAi = autoOn && aiOrder?.length > 0` 이다. 결제 화면(autoOn 없음)은 지금 `manual` 로직 그대로다.
  - 홈 모드에서 기존 'AI가 지금 결제에 맞춰 정한 순서예요.' 줄은 숨긴다(버튼이 대신한다).
- [ ] **Step 2: 확인 창**
  - 사용자 이동(누르기 `saveMove(ordered, index, 0)`, 끌기 `finishDrag` 의 저장, 화살표 `moveWithArrow`)을 `requestMove(cards, from, to)` 로 감싼다.
  - 홈 모드이고 `autoOn` 이면 `pendingMove` 에 담고 `Modal` 확인 창(Global Constraints 문구)을 연다. 아니면 바로 `saveMove` 한다.
  - `바꾸기`: `skipAutoOffSave` 표시 → `saveMove(...)` → `onAutoChange(false)`.
  - `취소`: `pendingMove` 를 비운다. 끌기는 `setDraggedId(null)` 뒤 기존 레이아웃 효과가 위치를 0 으로 돌려 원래 순서가 보인다.
- [ ] **Step 3: 동기화 효과** — 기존 `useEffect`(firstId/selectedId)를 `syncAction` 으로 바꾼다.
  - `'selectTop'` 이면 `onSelect(firstId)`, `'moveSelectedToTop'` 이면 `saveMove(ordered, selectedIndex, 0)`.
  - `lastSynced` 갱신은 그대로다.
- [ ] **Step 4: 스위치로 끌 때 순서 보존**
  - 이전 `autoOn` 을 ref 로 둔다. true→false 로 바뀌었고 직전에 `usingAi` 였으며 `skipAutoOffSave` 가 아니면, 그때 보이던 순서(ref)를 `setSavedIds` 와 `persistCardOrder` 로 저장한다.
  - 표시는 한 번 쓰면 지운다.
- [ ] **Step 5: 앱 시험 통과 후 커밋** — `앱: 내 카드 자동 배치 적용 버튼과 순서 변경 확인 창`

### Task 4: 홈 (`TodaySchedulePanel`·`MainScreen`)

**Files:** Modify `frontend/components/TodaySchedulePanel.js`, `frontend/screens/MainScreen.js`. Create `frontend/components/AutoPlacementSwitch.js`.

**Interfaces**
- **Consumes:** Task 2 `useAutoPlacement`, Task 3 props, `loadPlacementPreview(walletCards)`(utils/aiPlacement).
- **Produces:**
  - `TodaySchedulePanel` 새 prop `headerRight`(React 요소, 홈 '내 지갑' 제목 오른쪽).
  - `AutoPlacementSwitch({ on, onChange })`

- [ ] **Step 1: `AutoPlacementSwitch`**
  - 글자 `자동 배치`와 RN `Switch` 를 둔다.
  - ON→OFF 로 바꾸면 끄기 확인 창(`Modal`)을 띄우고, `확인` 이면 `onChange(false)`, `취소` 면 그대로 둔다.
  - OFF→ON 은 바로 `onChange(true)` 다.
- [ ] **Step 2: 제목 줄** — `TodaySchedulePanel` 홈 분기의 '내 지갑' 제목을 `flexDirection:'row'` 줄로 감싸고 오른쪽에 `headerRight` 를 둔다.
- [ ] **Step 3: `MainScreen`**
  - `const auto = useAutoPlacement()` 를 둔다.
  - 홈 AI 순서: `SERVER_MODE && auto.on && tab === 'home'` 일 때 `loadPlacementPreview(homeWalletCards)` 를 부른다.
    - `result.fallback` 이면 null, 아니면 `result.order` 를 쓴다.
    - 열쇠는 `[auto.on, tab, homeWalletCards ids, 지금 시(hour), aiRefresh]` 다. 시는 1분마다 도는 시계에서 계산한다.
    - 실패하면 null 이다.
  - `PaymentCardOrder` 에 `aiOrder={auto.on ? homeAiOrder : null} autoOn={auto.on} onAutoChange={auto.setOn}` 를 넘긴다.
  - `renderSchedule(true)` 에 `headerRight={<AutoPlacementSwitch on={auto.on} onChange={auto.setOn} />}` 를 넘긴다.
  - 홈 맨 아래(`renderHomeHighlights()` 다음)에 안내 문구 `Text` 를 둔다(11~12px, 회색, 가운데).
- [ ] **Step 4: 앱 시험 통과 후 커밋** — `앱: 홈 내 지갑 옆 자동 배치 스위치와 AI 안내 문구`

### Task 5: 결제 화면 OFF

**Files:** Modify `frontend/screens/PaymentScreen.js`

- [ ] **Step 1:** `useAutoPlacement()` 를 쓴다. OFF 면 `follow` 판단과 상관없이 `setSelectedId(result.topId)` 를 하지 않는다. 목록 `aiOrder` 는 `auto.on && !ai?.fallback ? ai?.order : null` 이다. AI 추천 상자와 '이 카드로 바꾸기'는 그대로다.
- [ ] **Step 2: 앱 시험 통과 후 커밋** — `앱: 자동 배치를 끄면 결제 화면도 내 순서·내 카드`

### Task 6: 카드 상세 '카드 신청'

**Files:** Modify `frontend/screens/MainScreen.js`(카드 상품 상세 `Modal`)

- [ ] **Step 1: 등록 버튼 지우기**
  - '보유 카드로 등록' 버튼과 `registerCard`·`registeringCard`(다른 곳에서 안 쓰면)를 지운다.
  - 보유 카드면 '지갑에 등록된 카드' 줄은 남긴다.
- [ ] **Step 2: 아래 버튼**
  - 미보유이고 `applyUrl(selectedCatalog)` 가 있으면 한 줄에 `닫기`(흰 바탕·파란 테두리·파란 글자, flex 1)와 `카드 신청`(파랑, flex 2)을 둔다.
    - `카드 신청`은 `Linking.openURL(url)` 로 열고, 실패하면 `Alert.alert('카드 신청', '브라우저에서 카드사 신청 페이지를 열어주세요.')` 를 띄운다.
  - 그 밖은 지금 파란 `닫기` 하나다.
- [ ] **Step 3: 앱 시험 통과 후 커밋** — `앱: 카드 상세에서 보유 카드 등록 대신 카드 신청`

### Task 7: '일정 다시 확인' 돌아가기

**Files:** Modify `frontend/App.js`, `frontend/screens/MainScreen.js`(prop `initialTab`)

- [ ] **Step 1: `App.js`**
  - `const [recommendBack, setRecommendBack] = useState('DailyRoutine')` 와 `const [mainTab, setMainTab] = useState('home')` 를 둔다.
  - Main 의 `onViewBenefits` 에서 `setRecommendBack('MainSchedule')` 를 하고, 그 밖에 RoutineRecommendation 으로 가는 곳은 `'DailyRoutine'` 으로 둔다.
  - RoutineRecommendation `onBack`: `'MainSchedule'` 이면 `setMainTab('schedule'); navigate('Main')`, 아니면 지금처럼 `navigate('DailyRoutine')`.
  - Main 이 아닌 화면으로 갈 때는 `mainTab` 을 'home' 으로 되돌린다.
- [ ] **Step 2: `MainScreen`** — `initialTab` prop 을 받아 `useState(initialTab || 'home')` 으로 쓴다.
- [ ] **Step 3: 앱 시험 통과 후 커밋** — `앱: 일정 맞춤 추천의 '일정 다시 확인'은 오늘의 일정으로`

### Task 8: 화면 확인·합치기 준비

- [ ] **Step 1: 데모 모드 확인** — 확인용 앱 19007, 데모 모드 화면 미리보기에서 본다.
  - 카드 탭 미보유 카드 상세의 두 버튼과 등록 버튼이 없는지.
  - 홈 스위치 끄기 확인 창(취소·확인), 안내 문구.
  - 내 카드 버튼 켜짐/꺼짐, 순서 바꾸기 확인 창(ON 일 때만, 취소 시 원래대로).
  - 오늘의 일정 → 혜택 찾기 → '일정 다시 확인' → 오늘의 일정 탭.
- [ ] **Step 2: 서버 모드** — 로그인 화면 확인은 사용자 로그인이 필요하므로, 요청이 있을 때만 한다. AI 순서 반영은 순수 함수 시험과 코드로 확인한다.
- [ ] **Step 3:** 앱 시험 전체를 다시 돌린다. final 에 합치는 것은 다른 세션 커밋 뒤, 사용자 확인 후에 한다.

# 챗봇 고도화 3단계 설계 (2026-11-24)

검토 문서 6절의 3단계 (앱·AI 같이). 사용자 승인 "이대로 진행". 백엔드는 바꾸지 않는다 (일정 POST /api/schedules, 규칙 GET·PUT /api/ai/rules 가 이미 있다).

## 일정 초안 (draft_schedule)

- AI 는 초안만 만든다. 화면 요소 `schedule_draft.input` 은 앱 `saveEvent`(utils/routineData.js) 가 받는 모양 그대로다.
  상황: `{date, types:[event_type], start?, end?, title?(other)}`, 장소: `{date, category, start, end, title}`.
- 날짜: day(today·tomorrow·day_after_tomorrow) 또는 date, 오늘부터 30일 안. 지난 날짜·먼 날짜는 오류.
- 종류: 앱 EVENT_OPTIONS 12가지, 장소 INDUSTRIES 14가지와 같은 id.
- 시간: 장소 일정은 시작·끝이 모두 필요하고, 사용자 문장에 시각 표현이 두 개 미만이면 끝 시간을 되묻는다 (지어내지 않게). 상황 일정은 둘 다 없으면 하루 종일, 하나만 있으면 되묻기.
- 따옴표 속 문장에만 일정 요청이 있으면 만들지 않는다 (가맹점 이름 속 지시 방지, 규칙 초안과 같은 방식).
- 앱: '일정에 추가' → saveEvent(input) (서버 저장 + 기기 목록), '취소'.

## 규칙 지우기 초안 (draft_rule_delete)

- query 의 낱말이 모두 들어 있는 저장된 규칙을 고른다 (요약·조건·원래 문장·종류에서). 여러 개면 candidates, 없으면 오류, 저장된 규칙이 없으면 count 0. all=true 면 모두.
- 화면 요소 `rule_delete_draft.rules = [{rule_id, summary, rule}]`. 앱: '지우기' → GET /api/ai/rules 를 다시 읽어 rule_id(없으면 규칙 내용)가 같은 것만 빼고 PUT.

## '자세히' 버튼

- 앱이 `screen.detail_button: true` 를 보내면 AI 는 "'자세히'라고 입력해 주세요" 안내 문장을 붙이지 않는다. 앱은 도구를 쓴 답(log.tools)이고 자세히 답(log.detail)이 아니면 말풍선 아래 '자세히' 버튼을 둔다.

## 그 밖

- 숫자 검사기의 저장 주장 낱말에 '추가했·넣었·삭제했·지웠'을 더하고, '아래 카드에서' 안내 검사는 규칙·일정·지우기 초안 중 하나라도 있으면 통과.
- 평가 89문항 (일정 3, 규칙 지우기 2 — 지우기 문항은 저장된 규칙을 미리 넣는다).

## 바뀐 것 (2026-11-24)

- 사용자 결정 "자세히 별로다, 전부 빼기": '자세히' 버튼과 screen.detail_button 을 뺐다. 일정·규칙 지우기 초안은 그대로. 평가는 '자세히' 6문항을 빼고 83문항.

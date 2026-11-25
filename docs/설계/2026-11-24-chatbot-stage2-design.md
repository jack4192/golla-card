# 챗봇 고도화 2단계 설계 (2026-11-24)

검토 문서 `~/Downloads/신한커리어넥스트/SOLPay_챗봇_고도화_검토_2026-11-24.md` 4·6절의 2단계. 팀 확인 "이대로 진행".

## 왜

엔진에 데이터와 계산 함수가 있는데 도구가 없어 "확인할 수 없어요"라고 답하던 질문(결제 내역, 지난 결제, 지난달·올해 혜택, 다른 시각의 카드, 카드 지정 비교, 저장된 규칙)을 답하게 한다.

## 새 도구 6개 (9 → 15)

| 도구 | 인자 | 돌려주는 것 | 화면 요소 |
|---|---|---|---|
| get_spending | period(today·yesterday·this_week·last_7_days·this_month·last_month·this_year), category_name, card_name | 합계·건수, 업종별·카드별·브랜드별, 직전 같은 길이 기간과 비교, 최근 5건 | spending_summary |
| review_payments | period, category_name, merchant_name, only_missed | 결제마다 낸 카드·받은 혜택·가장 많이 받았을 카드·차이 (처음부터 다시 계산, 카드 혜택만) | payment_review |
| get_benefit_summary | period(last_month·this_year) | 지난달: 월간 리포트 숫자와 엔진 효과 문장 / 올해: 달별 받은 혜택, 카드별, 놓친 혜택 상위 카드 | benefit_summary |
| get_day_plan | hour | 하루 시간대별 1순위 카드(홈 시간 표시줄과 같은 계산), 오늘 일정의 업종·시간 | day_plan |
| compare_cards | card_names(2~4), months | 카드마다 "최근 결제를 이 카드 한 장으로" 월 혜택·연회비·순혜택, 1월부터 그 카드였다면 더 받았을 금액 | new_card_list (title 붙임) |
| list_my_rules | — | 저장된 규칙 요약·종류·조건·원래 문장 | rule_list |

## 정한 것

- OpenAI 에는 업종·금액·날짜·카드 이름·카드사 목록 브랜드(brand_code)만. 가맹점 원문(merchant.name)·일정 원문은 보내지 않는다.
- 지난 결제 비교는 그 결제 하나만 본 값이다. 실적 구간을 채우려고 기본 카드로 낸 결제는 덜 받은 것처럼 보일 수 있다고 도구 결과 note 와 지시문에 적는다. 프로모션은 빼고 카드 혜택만 비교한다.
- 올해 받은 혜택은 엔진이 결제를 다시 계산한 값(state.apply)이라 앱 '올해 카드 결산'(결제 기록 합)과 조금 다를 수 있다고 note 에 적는다.
- compare_cards 는 새 카드 추천(recommend_new_cards)의 계산을 지정한 카드로 돌린다 (`cards=` 인자 추가). 1월부터 더 받았을 금액은 `missed_benefit(only=...)`.
- 앱: chatBlocks.js 에 5종류 view 추가, new_card_list 는 block.title 이 있으면 그 제목.

## 확인

- 시험: 도구마다 실제 데이터로 숫자 맞춤 (합계 = 결제 기록 합, 다시 계산한 받은 혜택 = 엔진 apply 합, 최선 ≥ 받은 혜택 등), 화면 요소, 요약 문장의 숫자 검사, 앱 view.
- 평가: 도구마다 2~3문항(14개) 더해 84문항. 기존 70문항 정답률이 떨어지지 않는지 함께 본다.

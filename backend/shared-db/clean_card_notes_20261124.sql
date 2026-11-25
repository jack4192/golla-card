-- 카드 혜택·부가서비스 설명에 남은 내부용 문구를 지운다 (2026-11-24 팀 결정).
--
-- 왜: 설명(description)이 앱 카드 상세와 챗봇에 그대로 보이는데, 'DB에서 제한하지 않음'·'충족으로 가정'·
--      '기본값으로 등록'·'계산에 반영하지 않음' 처럼 우리 계산 방식을 적은 말이 섞여 있었다.
-- 무엇: benefits 288·300·302·311, card_perks 18·19·20·23 의 설명 글자만 바꾼다 (혜택 값·한도는 그대로).
--       같은 내용을 로컬 DB 와 data/config/card_db/*.csv, 앱 frontend/data/cardCatalog40.json 에도 반영했다.
--
-- 누가: 표 주인인 마스터 계정(postgres)으로 실행한다. app_ai 계정은 읽기 전용이라 실행할 수 없다.
-- 여러 번 실행해도 안전하다 (바꿀 문구가 남아 있는 행만 바꾼다). 끝에 바뀐 설명 8줄을 보여 준다.
-- 실행 뒤 AI 서버를 다시 켠다 (챗봇이 부가서비스 설명을 켤 때 읽어 둔다). 백엔드는 요청마다 읽으므로 그대로 둬도 된다.
--
-- 실행 예 (로컬 도커의 psql 을 빌려 쓴다. 비밀번호는 실행할 때 묻는다):
--   docker cp backend/shared-db/clean_card_notes_20261124.sql solpay-db:/tmp/clean_card_notes.sql
--   docker exec -it solpay-db psql "host=<RDS 주소> port=5432 dbname=solpay user=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/clean_card_notes.sql
--
-- 되돌리기: 아래 UPDATE 의 replace 두 인자를 서로 바꿔 실행한다.

BEGIN;

UPDATE benefits SET description = replace(description, '결제계좌 잔액 조건(잔액 조건은 충족으로 가정), 월 2천P', '결제계좌 잔액 조건 충족 시, 월 2천P')
  WHERE benefit_id = 288 AND position('결제계좌 잔액 조건(잔액 조건은 충족으로 가정), 월 2천P' in description) > 0;
UPDATE benefits SET description = replace(description, '연(1~12월) 2회 (연 횟수는 DB에서 제한하지 않음), 1회', '연(1~12월) 2회, 1회')
  WHERE benefit_id = 300 AND position('연(1~12월) 2회 (연 횟수는 DB에서 제한하지 않음), 1회' in description) > 0;
UPDATE benefits SET description = replace(description, '연(1~12월) 2회 (연 횟수는 DB에서 제한하지 않음). 전월', '연(1~12월) 2회. 전월')
  WHERE benefit_id = 302 AND position('연(1~12월) 2회 (연 횟수는 DB에서 제한하지 않음). 전월' in description) > 0;
UPDATE benefits SET description = replace(description, '정유사 미선택 시 GS칼텍스(기본값으로 등록).', '정유사 미선택 시 GS칼텍스.')
  WHERE benefit_id = 311 AND position('정유사 미선택 시 GS칼텍스(기본값으로 등록).' in description) > 0;
UPDATE card_perks SET description = replace(description, '(영역별 한도 내, 실제 계산에는 반영하지 않음)', '(영역별 한도 내)')
  WHERE perk_id = 18 AND position('(영역별 한도 내, 실제 계산에는 반영하지 않음)' in description) > 0;
UPDATE card_perks SET description = replace(description, '적립률 2배 (실제 계산에는 반영하지 않음)', '적립률 2배')
  WHERE perk_id = 19 AND position('적립률 2배 (실제 계산에는 반영하지 않음)' in description) > 0;
UPDATE card_perks SET description = replace(description, '적립률 2배 (실제 계산에는 반영하지 않음)', '적립률 2배')
  WHERE perk_id = 20 AND position('적립률 2배 (실제 계산에는 반영하지 않음)' in description) > 0;
UPDATE card_perks SET description = replace(description, '공휴일은 계산에 반영하지 않음 (토·일만 반영)', '주말·공휴일 이용 시 추가 적립')
  WHERE perk_id = 23 AND position('공휴일은 계산에 반영하지 않음 (토·일만 반영)' in description) > 0;

COMMIT;

SELECT 'benefits' AS t, benefit_id AS id, description FROM benefits WHERE benefit_id IN (288, 300, 302, 311)
UNION ALL
SELECT 'card_perks', perk_id, description FROM card_perks WHERE perk_id IN (18, 19, 20, 23)
ORDER BY 1, 2;

-- 최종 카드 DB 로 옮기며 빠졌던 카드 혜택 6줄을 되살린다 (2026-11-23 사용자 결정, 설계서 docs/superpowers/specs/2026-11-23-recommend-fixes-design.md).
--
-- 무엇: 혜택 284~289 (① 나라사랑 CGV 관람권 ② 나라사랑 테마파크 ③ Discount Plan 테마파크 ④ Discount Plan+ 테마파크
--       ⑤ SOL메이트 담을수록 OTT·멤버십 100% 적립 ⑥ SOL LINK SOL페이 0.1% 추가), 구간 674~694, 대상 662~674,
--       그리고 혜택으로 옮긴 나라사랑 테마파크 부가서비스(card_perks 14번)를 지운다.
--       값은 원본 data/config/card_db/*.csv 와 같다 (이 파일은 그 CSV 에서 만들었다).
--
-- 누가: 표 주인인 마스터 계정(postgres)으로 실행한다. app_ai 계정은 읽기 전용이라 실행할 수 없다.
-- 여러 번 실행해도 안전하다 (이 파일과 같은 행이 이미 있으면 건너뛰고, 자동 번호는 최댓값에 맞춘다).
-- 같은 번호에 다른 혜택·구간·대상이 이미 있으면 오류로 멈추고 아무것도 바꾸지 않는다 (먼저 그 번호를 확인할 것).
-- 실행 뒤 AI 서버를 다시 켠다: AI 는 켤 때만 카드 혜택을 읽는다 (안 켜면 카드 탭에는 보이고 AI 계산에는 빠진다).
--
-- 실행 예 (로컬 도커의 psql 을 빌려 쓴다. 비밀번호는 실행할 때 묻는다):
--   docker cp backend/shared-db/restore_card_benefits_20261123.sql solpay-db:/tmp/restore_benefits.sql
--   docker exec -it solpay-db psql "host=<RDS 주소> port=5432 dbname=solpay user=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/restore_benefits.sql
--   또는 IntelliJ·DBeaver 의 DB 콘솔에 이 파일 내용을 붙여 넣어 실행한다.

BEGIN;


-- 앞 검사: 이 파일이 쓰는 번호에 다른 내용이 이미 있으면 멈춘다 (조용히 남의 혜택에 구간·대상이 붙지 않게)
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg('혜택 ' || b.benefit_id, ', ') INTO bad FROM public.benefits b
    JOIN (VALUES (284, 11, 'CGV 관람권 6천원 정액 (2D, 동반 1인)'), (285, 11, '테마파크 50% 할인'), (286, 1, '테마파크 50% 할인'), (287, 2, '테마파크 50% 할인'), (288, 13, '담을수록 SOLSOL OTT·멤버십 100% 적립'), (289, 14, '신한 SOL페이 추가 0.1% 적립')) AS v(id, card, name) ON b.benefit_id = v.id
   WHERE b.card_id <> v.card OR b.benefit_name <> v.name;
  IF bad IS NULL THEN
    SELECT string_agg('구간 ' || t.benefit_tier_id, ', ') INTO bad FROM public.benefit_tiers t
      JOIN (VALUES (674, 284, 34), (675, 284, 35), (676, 284, 36), (677, 284, 37), (678, 284, 38), (679, 285, 36), (680, 285, 37), (681, 285, 38), (682, 286, 2), (683, 286, 3), (684, 286, 4), (685, 287, 6), (686, 287, 7), (687, 287, 8), (688, 287, 9), (689, 287, 10), (690, 288, 43), (691, 289, 44), (692, 289, 45), (693, 289, 46), (694, 289, 47)) AS v(id, bid, tier) ON t.benefit_tier_id = v.id
     WHERE t.benefit_id <> v.bid OR t.tier_id <> v.tier;
  END IF;
  IF bad IS NULL THEN
    SELECT string_agg('대상 ' || g.target_id, ', ') INTO bad FROM public.benefit_targets g
      JOIN (VALUES (662, 284, 'MOVIE', 'CGV'), (663, 285, 'AMUSEMENT_PARK', '에버랜드'), (664, 285, 'AMUSEMENT_PARK', '롯데월드'), (665, 286, 'AMUSEMENT_PARK', '에버랜드'), (666, 286, 'AMUSEMENT_PARK', '롯데월드'), (667, 287, 'AMUSEMENT_PARK', '에버랜드'), (668, 287, 'AMUSEMENT_PARK', '롯데월드'), (669, 288, 'DIGITAL_SUBSCRIPTION', '넷플릭스'), (670, 288, 'DIGITAL_SUBSCRIPTION', '유튜브 프리미엄'), (671, 288, 'DIGITAL_SUBSCRIPTION', '티빙'), (672, 288, 'DIGITAL_SUBSCRIPTION', '디즈니플러스'), (673, 288, 'MEMBERSHIP', '네이버플러스 멤버십'), (674, 288, 'MEMBERSHIP', '쿠팡 로켓와우')) AS v(id, bid, cat, merchant) ON g.target_id = v.id
     WHERE g.benefit_id <> v.bid OR g.category <> v.cat OR coalesce(g.merchant_name, '') <> v.merchant;
  END IF;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '이미 다른 내용이 같은 번호를 쓰고 있습니다 (%). 아무것도 바꾸지 않았습니다.', bad;
  END IF;
END $$;

INSERT INTO public.benefits (benefit_id, card_id, group_id, benefit_name, benefit_kind, value_type, limit_basis, pay_type, min_pay_amount, time_from, time_to, days, daily_count, description) OVERRIDING SYSTEM VALUE VALUES
  (284, 11, NULL, 'CGV 관람권 6천원 정액 (2D, 동반 1인)', 'DISCOUNT', 'FIXED', 'BENEFIT', NULL, 6000, NULL, NULL, NULL, NULL, 'CGV 2D 관람권을 6천원에(본인·동반 1인, 월 1회). 영화 결제 중앙값 11,100원 기준 약 5천원 할인으로 계산'),
  (285, 11, NULL, '테마파크 50% 할인', 'DISCOUNT', 'RATE', 'BENEFIT', NULL, NULL, NULL, NULL, NULL, NULL, '에버랜드·롯데월드·서울랜드 자유이용권 50% (테마파크별 일 1회·연 3회, 본인 이용권). 전월 30만원 조건은 50만원 구간부터'),
  (286, 1, NULL, '테마파크 50% 할인', 'DISCOUNT', 'RATE', 'BENEFIT', NULL, NULL, NULL, NULL, NULL, NULL, '에버랜드·롯데월드 50%, 캐리비안베이 30% (테마파크별 일 1회·연 3회, 본인 이용권). 전월 30만원 조건은 40만원 구간부터'),
  (287, 2, NULL, '테마파크 50% 할인', 'DISCOUNT', 'RATE', 'BENEFIT', NULL, NULL, NULL, NULL, NULL, NULL, '에버랜드·롯데월드 50%, 캐리비안베이 30% (테마파크별 일 1회·연 3회, 본인 이용권). 전월 30만원 조건은 40만원 구간부터'),
  (288, 13, NULL, '담을수록 SOLSOL OTT·멤버십 100% 적립', 'POINT', 'RATE', 'BENEFIT', NULL, NULL, NULL, NULL, NULL, NULL, '공식 홈페이지 정기결제. 카드 전월 60만원 이상 + 결제계좌 잔액 조건(잔액 조건은 충족으로 가정), 월 2천P'),
  (289, 14, NULL, '신한 SOL페이 추가 0.1% 적립', 'POINT', 'RATE', 'BENEFIT', 'PAY', NULL, NULL, NULL, NULL, NULL, 'SOL페이 결제 시 기본 적립에 0.1% 추가')
ON CONFLICT (benefit_id) DO NOTHING;

INSERT INTO public.benefit_tiers (benefit_tier_id, benefit_id, tier_id, value, monthly_limit, monthly_count, per_payment_limit) OVERRIDING SYSTEM VALUE VALUES
  (674, 284, 34, 5000, NULL, 1, NULL),
  (675, 284, 35, 5000, NULL, 1, NULL),
  (676, 284, 36, 5000, NULL, 1, NULL),
  (677, 284, 37, 5000, NULL, 1, NULL),
  (678, 284, 38, 5000, NULL, 1, NULL),
  (679, 285, 36, 50, NULL, 1, 30000),
  (680, 285, 37, 50, NULL, 1, 30000),
  (681, 285, 38, 50, NULL, 1, 30000),
  (682, 286, 2, 50, NULL, 1, 30000),
  (683, 286, 3, 50, NULL, 1, 30000),
  (684, 286, 4, 50, NULL, 1, 30000),
  (685, 287, 6, 50, NULL, 1, 30000),
  (686, 287, 7, 50, NULL, 1, 30000),
  (687, 287, 8, 50, NULL, 1, 30000),
  (688, 287, 9, 50, NULL, 1, 30000),
  (689, 287, 10, 50, NULL, 1, 30000),
  (690, 288, 43, 100, 2000, NULL, NULL),
  (691, 289, 44, 0.1, NULL, NULL, NULL),
  (692, 289, 45, 0.1, NULL, NULL, NULL),
  (693, 289, 46, 0.1, NULL, NULL, NULL),
  (694, 289, 47, 0.1, NULL, NULL, NULL)
ON CONFLICT (benefit_tier_id) DO NOTHING;

INSERT INTO public.benefit_targets (target_id, benefit_id, category, merchant_name) OVERRIDING SYSTEM VALUE VALUES
  (662, 284, 'MOVIE', 'CGV'),
  (663, 285, 'AMUSEMENT_PARK', '에버랜드'),
  (664, 285, 'AMUSEMENT_PARK', '롯데월드'),
  (665, 286, 'AMUSEMENT_PARK', '에버랜드'),
  (666, 286, 'AMUSEMENT_PARK', '롯데월드'),
  (667, 287, 'AMUSEMENT_PARK', '에버랜드'),
  (668, 287, 'AMUSEMENT_PARK', '롯데월드'),
  (669, 288, 'DIGITAL_SUBSCRIPTION', '넷플릭스'),
  (670, 288, 'DIGITAL_SUBSCRIPTION', '유튜브 프리미엄'),
  (671, 288, 'DIGITAL_SUBSCRIPTION', '티빙'),
  (672, 288, 'DIGITAL_SUBSCRIPTION', '디즈니플러스'),
  (673, 288, 'MEMBERSHIP', '네이버플러스 멤버십'),
  (674, 288, 'MEMBERSHIP', '쿠팡 로켓와우')
ON CONFLICT (target_id) DO NOTHING;

-- 나라사랑 테마파크는 혜택(285번)으로 옮겼으므로 부가서비스 줄을 지운다 (번호·카드·이름이 모두 맞을 때만)
DELETE FROM public.card_perks WHERE perk_id = 14 AND card_id = 11 AND perk_name = '테마파크 할인';

-- 자동 번호를 최댓값에 맞춘다 (다음에 넣는 행이 번호가 겹치지 않게)
SELECT setval(pg_get_serial_sequence('public.benefits', 'benefit_id'), (SELECT max(benefit_id) FROM public.benefits));
SELECT setval(pg_get_serial_sequence('public.benefit_tiers', 'benefit_tier_id'), (SELECT max(benefit_tier_id) FROM public.benefit_tiers));
SELECT setval(pg_get_serial_sequence('public.benefit_targets', 'target_id'), (SELECT max(target_id) FROM public.benefit_targets));
SELECT setval(pg_get_serial_sequence('public.card_perks', 'perk_id'), (SELECT max(perk_id) FROM public.card_perks));

-- 뒤 검사: 이 파일의 행이 정확히 있는지 (혜택 6·구간 21·대상 13, 부가서비스 14번 없음)
DO $$
BEGIN
  IF (SELECT count(*) FROM public.benefits b JOIN (VALUES (284, 11, 'CGV 관람권 6천원 정액 (2D, 동반 1인)'), (285, 11, '테마파크 50% 할인'), (286, 1, '테마파크 50% 할인'), (287, 2, '테마파크 50% 할인'), (288, 13, '담을수록 SOLSOL OTT·멤버십 100% 적립'), (289, 14, '신한 SOL페이 추가 0.1% 적립')) AS v(id, card, name)
        ON b.benefit_id = v.id AND b.card_id = v.card AND b.benefit_name = v.name) <> 6
     OR (SELECT count(*) FROM public.benefit_tiers t JOIN (VALUES (674, 284, 34), (675, 284, 35), (676, 284, 36), (677, 284, 37), (678, 284, 38), (679, 285, 36), (680, 285, 37), (681, 285, 38), (682, 286, 2), (683, 286, 3), (684, 286, 4), (685, 287, 6), (686, 287, 7), (687, 287, 8), (688, 287, 9), (689, 287, 10), (690, 288, 43), (691, 289, 44), (692, 289, 45), (693, 289, 46), (694, 289, 47)) AS v(id, bid, tier)
        ON t.benefit_tier_id = v.id AND t.benefit_id = v.bid AND t.tier_id = v.tier) <> 21
     OR (SELECT count(*) FROM public.benefit_targets g JOIN (VALUES (662, 284, 'MOVIE', 'CGV'), (663, 285, 'AMUSEMENT_PARK', '에버랜드'), (664, 285, 'AMUSEMENT_PARK', '롯데월드'), (665, 286, 'AMUSEMENT_PARK', '에버랜드'), (666, 286, 'AMUSEMENT_PARK', '롯데월드'), (667, 287, 'AMUSEMENT_PARK', '에버랜드'), (668, 287, 'AMUSEMENT_PARK', '롯데월드'), (669, 288, 'DIGITAL_SUBSCRIPTION', '넷플릭스'), (670, 288, 'DIGITAL_SUBSCRIPTION', '유튜브 프리미엄'), (671, 288, 'DIGITAL_SUBSCRIPTION', '티빙'), (672, 288, 'DIGITAL_SUBSCRIPTION', '디즈니플러스'), (673, 288, 'MEMBERSHIP', '네이버플러스 멤버십'), (674, 288, 'MEMBERSHIP', '쿠팡 로켓와우')) AS v(id, bid, cat, merchant)
        ON g.target_id = v.id AND g.benefit_id = v.bid AND g.category = v.cat AND coalesce(g.merchant_name, '') = v.merchant) <> 13
     OR EXISTS (SELECT 1 FROM public.card_perks WHERE perk_id = 14 AND card_id = 11 AND perk_name = '테마파크 할인') THEN
    RAISE EXCEPTION '넣은 결과가 예상과 다릅니다. 아무것도 바꾸지 않았습니다.';
  END IF;
END $$;

COMMIT;

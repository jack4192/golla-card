-- 공용 RDS(solpay DB)의 promotions 표에 행사 화면용 칸 10개를 더하고 29건을 채운다 (2026-11-23).
--
-- 왜: 앱 혜택 탭·AI 챗봇·추천이 같은 행사 목록을 쓰도록, 앱에 박혀 있던 화면 정보(화면 이름·혜택 문구·실제 기간·지급일·
--     결제 방법·유의사항·확인 필요·로고 주소)를 DB 로 옮긴다. 백엔드 GET /api/promotions 와 AI 엔진이 이 칸을 읽는다.
-- 무엇을 바꾸나: 칸 추가 + promotion_id 로 UPDATE 29건. 행을 새로 넣지 않고, 기존 칸(start_date 등)·결제 데이터는 그대로다.
-- 누가: 표 주인인 마스터 계정(postgres)으로 실행한다. 여러 번 실행해도 안전하다.
-- 원본: AI 저장소 data/config/promotions.yml → `cd data && uv run python -m generate.promotions --sql` 로 만든 내용 (아래).
--
-- 실행 예 (비밀번호는 실행할 때 묻는다):
--   docker cp backend/shared-db/add_promotion_display.sql solpay-db:/tmp/rds_promo.sql
--   docker exec -it solpay-db psql "host=<RDS 주소> port=5432 dbname=solpay user=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/rds_promo.sql
--   또는 IntelliJ·DBeaver 의 DB 콘솔에 이 파일 내용을 붙여 넣어 실행한다.
-- 확인: 맨 끝 결과가 filled 29, total 29 이면 끝.

-- 행사 화면용 칸 (2026-11-23). 생성: data/generate/promotions.py --sql (원본 data/config/promotions.yml)
-- 기존 칸·기간(start_date)과 결제 데이터는 바꾸지 않는다. 행을 넣지 않고 promotion_id 로 UPDATE 만 한다.
BEGIN;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS display_name varchar(100);
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS benefit_type varchar(10);
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS benefit_text varchar(60);
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS display_start date;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS display_end date;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS payout varchar(40);
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS pay_method varchar(60);
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS note varchar(200);
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS needs_check boolean NOT NULL DEFAULT false;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS logo_url varchar(200);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotions_benefit_type_check') THEN
        ALTER TABLE public.promotions ADD CONSTRAINT promotions_benefit_type_check
            CHECK (benefit_type IS NULL OR benefit_type IN ('point', 'cashback', 'discount'));
    END IF;
END $$;
UPDATE public.promotions SET display_name = '메가MGC커피', benefit_type = 'point', benefit_text = '500 마이신한포인트 적립', display_start = '2026-11-01', display_end = '2026-11-30', payout = '2026-12-13', pay_method = '신한 슈퍼SOL/SOL페이 바코드 결제', note = '키오스크에서 바코드 스캔 필요', needs_check = false, logo_url = '/brand-logos/mega.png' WHERE promotion_id = 1;
UPDATE public.promotions SET display_name = '온라인 다이소몰', benefit_type = 'point', benefit_text = '1,000 마이신한포인트 적립', display_start = '2026-11-01', display_end = '2026-11-30', payout = '2026-12-10', pay_method = '신한 슈퍼SOL/SOL페이 결제', note = '3만 원 이상 결제', needs_check = false, logo_url = '/brand-logos/daiso.png' WHERE promotion_id = 2;
UPDATE public.promotions SET display_name = '온라인 다이소몰', benefit_type = 'point', benefit_text = '500 마이신한포인트 추가 적립', display_start = '2026-11-16', display_end = '2026-11-30', payout = '2026-12-10', pay_method = '신한 슈퍼SOL/SOL페이 결제', note = '다이소데이 11월 16일 오픈. 기존 행사와 별도이며 중복 적용 여부는 확인 필요', needs_check = false, logo_url = '/brand-logos/daiso.png' WHERE promotion_id = 3;
UPDATE public.promotions SET display_name = 'W컨셉(앱/웹)', benefit_type = 'point', benefit_text = '10,000 마이신한포인트 적립', display_start = '2026-11-01', display_end = '2026-11-30', payout = '2026-12-16', pay_method = '신한 슈퍼SOL/SOL페이 결제', note = '20만 원 이상 결제', needs_check = false, logo_url = '/brand-logos/wconcept.png' WHERE promotion_id = 4;
UPDATE public.promotions SET display_name = '해피오더', benefit_type = 'discount', benefit_text = '2,000원 즉시 할인', display_start = '2026-11-11', display_end = '2026-12-25', payout = '즉시 할인', pay_method = '신한 슈퍼SOL/SOL페이 결제', note = 'X-MAS 사전예약 제품 대상. 매일 오전 10:30부터 선착순', needs_check = true, logo_url = '/brand-logos/happyorder.png' WHERE promotion_id = 5;
UPDATE public.promotions SET display_name = '유튜브 프리미엄', benefit_type = 'cashback', benefit_text = '5,000원 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '2027년 1월 중', pay_method = '이벤트 응모 후 신규 정기 결제', note = '2026.05.01~10.31 결제 이력이 없는 고객 대상', needs_check = true, logo_url = '/brand-logos/youtube-premium.png' WHERE promotion_id = 6;
UPDATE public.promotions SET display_name = '살롱드마샬', benefit_type = 'discount', benefit_text = '최대 20% 할인', display_start = '2026-11-20', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/marshall.png' WHERE promotion_id = 7;
UPDATE public.promotions SET display_name = '11번가', benefit_type = 'cashback', benefit_text = '3,000원 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/11st.png' WHERE promotion_id = 8;
UPDATE public.promotions SET display_name = 'CU', benefit_type = 'cashback', benefit_text = '500원 캐시백', display_start = '2026-11-01', display_end = '2026-11-15', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/cu.png' WHERE promotion_id = 9;
UPDATE public.promotions SET display_name = '마켓컬리', benefit_type = 'cashback', benefit_text = '20% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/kurly.png' WHERE promotion_id = 10;
UPDATE public.promotions SET display_name = '에이치몰', benefit_type = 'cashback', benefit_text = '5% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/hmall.png' WHERE promotion_id = 11;
UPDATE public.promotions SET display_name = '알리익스프레스', benefit_type = 'cashback', benefit_text = '10% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/ali.png' WHERE promotion_id = 12;
UPDATE public.promotions SET display_name = '신라아이파크면세점', benefit_type = 'cashback', benefit_text = '10% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/shilla-ipark.png' WHERE promotion_id = 13;
UPDATE public.promotions SET display_name = '동원몰', benefit_type = 'cashback', benefit_text = '7% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/dongwon.png' WHERE promotion_id = 14;
UPDATE public.promotions SET display_name = '할리스', benefit_type = 'cashback', benefit_text = '10% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/hollys.png' WHERE promotion_id = 15;
UPDATE public.promotions SET display_name = '신세계면세점', benefit_type = 'cashback', benefit_text = '11% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/ssg-dutyfree.png' WHERE promotion_id = 16;
UPDATE public.promotions SET display_name = '닥터자르트', benefit_type = 'cashback', benefit_text = '12% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/drjart.png' WHERE promotion_id = 17;
UPDATE public.promotions SET display_name = '현대백화점', benefit_type = 'cashback', benefit_text = '15% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/hyundai.png' WHERE promotion_id = 18;
UPDATE public.promotions SET display_name = 'SSG닷컴', benefit_type = 'cashback', benefit_text = '10% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/ssg.png' WHERE promotion_id = 19;
UPDATE public.promotions SET display_name = '이마트몰', benefit_type = 'cashback', benefit_text = '10% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/emart.png' WHERE promotion_id = 20;
UPDATE public.promotions SET display_name = '차앤박(CNP)', benefit_type = 'cashback', benefit_text = '12% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/cnp.png' WHERE promotion_id = 21;
UPDATE public.promotions SET display_name = '오설록', benefit_type = 'cashback', benefit_text = '10% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/osulloc.png' WHERE promotion_id = 22;
UPDATE public.promotions SET display_name = '레드캡투어', benefit_type = 'cashback', benefit_text = '12% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/redcap.png' WHERE promotion_id = 23;
UPDATE public.promotions SET display_name = '야놀자', benefit_type = 'cashback', benefit_text = '8% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/yanolja.png' WHERE promotion_id = 24;
UPDATE public.promotions SET display_name = '교보문고', benefit_type = 'cashback', benefit_text = '10% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/kyobo.png' WHERE promotion_id = 25;
UPDATE public.promotions SET display_name = '위메프', benefit_type = 'cashback', benefit_text = '20% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/wemakeprice.png' WHERE promotion_id = 26;
UPDATE public.promotions SET display_name = '올리브영', benefit_type = 'cashback', benefit_text = '25% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/oliveyoung.png' WHERE promotion_id = 27;
UPDATE public.promotions SET display_name = '파리바게뜨', benefit_type = 'cashback', benefit_text = '12% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/paris.png' WHERE promotion_id = 28;
UPDATE public.promotions SET display_name = '유니클로', benefit_type = 'cashback', benefit_text = '16% 캐시백', display_start = '2026-11-01', display_end = '2026-11-30', payout = '결제일에 따라 다름', pay_method = '마이샵 혜택 ON 설정 후 신한카드 결제', note = NULL, needs_check = false, logo_url = '/brand-logos/uniqlo.png' WHERE promotion_id = 29;
COMMIT;
-- 확인: 29 가 나와야 한다
SELECT count(*) FILTER (WHERE display_name IS NOT NULL) AS filled, count(*) AS total FROM public.promotions;

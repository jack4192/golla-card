-- users 에 알림 수신 동의 칸 notification_agreed 를 더한다 (2026-11-24).
--
-- 왜: 알림 수신 동의(선택)도 서버에 저장하기로 했다 (사용자 결정). User 엔티티가 이 칸을 쓰는데
--     백엔드는 ddl-auto: validate 라 **이 칸이 없으면 백엔드가 켜지지 않는다.** 새 코드를 RDS 에 붙이기 전에 먼저 실행한다.
--
-- 값: null = 아직 응답 안 함 (기존 회원 전부). true/false 는 앱의 동의 화면·설정 '폰 알림 받기'에서 저장한다.
--     location_agreed(위치 동의) 칸은 그대로 둔다 (쓰지 않지만 지우지 않는다).
-- 여러 번 실행해도 안전하다 (IF NOT EXISTS). 기존 데이터는 바꾸지 않는다.
--
-- 누가: 공용 RDS 는 표 주인인 마스터 계정(postgres)으로 실행한다. 로컬 DB(solpay_v21)에는 2026-11-24 에 적용했다.
--
-- 실행 예 (로컬 도커의 psql 을 빌려 쓴다. 비밀번호는 실행할 때 묻는다):
--   docker cp backend/shared-db/add_users_notification_agreed.sql solpay-db:/tmp/rds_notify.sql
--   docker exec -it solpay-db psql "host=<RDS 주소> port=5432 dbname=solpay user=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/rds_notify.sql

BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notification_agreed boolean;

COMMENT ON COLUMN public.users.notification_agreed IS '알림 수신 동의(선택). null = 아직 응답 안 함';

COMMIT;

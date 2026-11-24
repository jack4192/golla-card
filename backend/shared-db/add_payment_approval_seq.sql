-- 결제 승인번호 시퀀스 approval_no_seq 를 만든다 (2026-11-24, PR #6 결제 API).
--
-- 왜: 가상 POS 결제(PosPaymentService)가 승인할 때 승인번호를 'A' + 7자리(nextval('approval_no_seq'))로 만든다.
--     이 시퀀스가 없으면 승인할 때마다 500 오류가 난다. 표·칸은 이미 있어서(payments.approval_no) 이것만 더한다.
--     백엔드가 켜지는 데는 필요 없다 (시퀀스는 ddl-auto: validate 검사 대상이 아님).
--
-- 시작 번호: 이미 쓰인 승인번호(가상 결제 A0000001~A0534767) 다음부터. 승인번호가 하나도 없으면 1부터.
-- 여러 번 실행해도 안전하다. 기존 데이터는 바꾸지 않는다.
--
-- 누가: 공용 RDS 는 표 주인인 마스터 계정(postgres)으로 실행한다. 로컬 DB(solpay_v21)에는 2026-11-24 에 적용했다.
--   백엔드가 다른 계정으로 접속한다면 그 계정에 권한을 준다:
--   GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.approval_no_seq TO <백엔드 계정>;
--
-- 실행 예 (로컬 도커의 psql 을 빌려 쓴다. 비밀번호는 실행할 때 묻는다):
--   docker cp backend/shared-db/add_payment_approval_seq.sql solpay-db:/tmp/rds_seq.sql
--   docker exec -it solpay-db psql "host=<RDS 주소> port=5432 dbname=solpay user=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/rds_seq.sql

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.approval_no_seq AS bigint MINVALUE 1 START WITH 1;

SELECT setval('public.approval_no_seq',
              GREATEST(COALESCE(MAX(CAST(SUBSTRING(approval_no FROM 2) AS bigint)), 0), 1),
              COUNT(*) > 0)
  FROM public.payments
 WHERE approval_no ~ '^A[0-9]+$';

COMMIT;

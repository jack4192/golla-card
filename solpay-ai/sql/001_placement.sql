-- 카드 배치 엔진용 테이블. 수집기의 card_catalog 와 섞이지 않게 placement 스키마를 쓴다.
-- 시스템을 합칠 때 Spring 쪽 테이블로 옮기면 pg_store.py 의 스키마 이름만 바꾸면 된다.
create schema if not exists placement;

create table if not exists placement.merchant_categories (
    category_code text primary key,
    category_name text not null
);

create table if not exists placement.card_catalog (
    card_id bigint primary key,
    card_code text not null unique,
    issuer_code text not null,
    card_name text not null,
    card_type text not null,
    tags text,
    annual_fee integer not null default 0
);

-- 실제 카드(신한 16·KB 6) 혜택 규칙. 원본 card_benefit 표에서 계산에 넣는 행만 담는다 (data/config/card_rules.yml).
create table if not exists placement.card_benefits (
    benefit_id bigint primary key,              -- 원본 card_benefit_id
    card_id bigint not null references placement.card_catalog,
    category_code text not null,                -- ALL 은 전 업종
    benefit_type text not null,                 -- discount / cashback / point
    rate numeric(6, 4),
    amount integer,                             -- 정액
    per_liter integer,                          -- ℓ당 할인
    min_amount integer not null default 0,      -- 건당 최소 결제액
    min_prev_perf integer not null default 0,   -- 이 행의 전월 실적 하한
    max_per_tx integer,                         -- 건당 최대 혜택
    monthly_count integer,
    daily_count integer,
    cap_group text,                             -- 한도를 함께 쓰는 묶음 (없으면 묶음 한도 없음)
    cap_unit text not null default 'krw',       -- krw: 혜택액 한도, usage: 이용금액 한도
    row_cap integer,                            -- 이 행만의 월 한도
    days text,                                  -- mon,tue,... (요일 조건)
    month_days text,                            -- 1,10 (매월 날짜 조건)
    hour_start integer,
    hour_end integer,
    brands text,                                -- 브랜드 한정 혜택의 브랜드 코드 (쉼표 구분)
    plan_day integer,                           -- Plan Day: 이 날 묶음 첫 할인 거래의 할인율 배율
    plan_mult numeric(4, 2),
    also_categories text,                       -- 이 세부 업종에도 붙는다 (동물병원·골프연습장 등, 쉼표 구분)
    targets text,                               -- 최종 카드 DB 대상 [[업종, 브랜드|null], ...] (JSON). 비면 국내 전 업종
    max_prev_perf integer,                      -- 이 행의 전월 실적 상한 (다음 구간 하한, 없으면 끝 구간)
    basis text not null default 'benefit',      -- benefit: 한도가 혜택액 / usage: 이용금액
    pay_type text,                              -- PAY / NOPAY / SOLPAY / KBPAY / SAMSUNGPAY / NHPAY
    source_benefit_id bigint,                   -- 최종 카드 DB benefits.benefit_id (행은 혜택 × 구간)
    benefit_name text
);

create table if not exists placement.card_cap_tiers (
    card_id bigint not null references placement.card_catalog,
    cap_group text not null,
    min_prev_perf integer not null,
    monthly_cap integer,
    cap_unit text not null default 'krw',
    primary key (card_id, cap_group, min_prev_perf)
);

-- 카드 월 통합 한도 (최종 카드 DB card_tiers.total_limit). total_limit 이 비면 한도 없음
create table if not exists placement.card_total_caps (
    card_id bigint not null references placement.card_catalog,
    min_prev_perf integer not null,
    total_limit integer,
    primary key (card_id, min_prev_perf)
);

-- 결제와 무관하게 전월 실적만 보고 주는 월 리워드 (실적 기여 가치에만 들어간다)
create table if not exists placement.card_rewards (
    card_id bigint not null references placement.card_catalog,
    min_prev_perf integer not null,
    amount integer not null,
    primary key (card_id, min_prev_perf)
);

create table if not exists placement.merchants (
    merchant_id bigint primary key,
    place_name text not null,
    category_code text not null,
    lat double precision,
    lng double precision,
    is_online boolean not null default false,
    zone_code text,
    brand text,
    brand_code text                             -- 혜택 계산용 실제 브랜드 코드 (STARBUCKS, CU …)
);
create index if not exists merchants_location on placement.merchants (lat, lng);

create table if not exists placement.users (
    user_id bigint primary key
);

create table if not exists placement.user_cards (
    user_card_id bigint primary key,
    user_id bigint not null references placement.users,
    card_id bigint not null references placement.card_catalog,
    issuer_code text not null,
    display_order integer not null,
    exclude_from_placement boolean not null default false
);
create index if not exists user_cards_user on placement.user_cards (user_id);

create table if not exists placement.payments (
    payment_id bigint primary key,
    user_id bigint not null references placement.users,
    user_card_id bigint not null references placement.user_cards,
    merchant_id bigint,
    category_code text not null,
    channel text not null,
    card_select_mode text not null,
    amount integer not null,
    paid_at timestamptz not null,
    synced_at timestamptz
);
create index if not exists payments_user_time on placement.payments (user_id, paid_at);

create table if not exists placement.user_rules (
    rule_id bigserial primary key,
    user_id bigint not null references placement.users,
    rule jsonb not null,
    created_seq integer not null default 0,
    active boolean not null default true,
    created_at timestamptz not null default now()
);
create index if not exists user_rules_user on placement.user_rules (user_id) where active;

create table if not exists placement.user_weights (
    user_id bigint primary key references placement.users,
    w1 double precision,
    w2 double precision,
    switch_threshold integer,
    base_order text
);

create table if not exists placement.promotions (
    promotion_id bigint primary key,
    kind text not null default 'event',          -- event / myshop
    brand text not null,
    match_brand text,                            -- 가맹점 브랜드명과 맞출 때 쓰는 이름
    category_code text,                          -- 브랜드가 없으면 이 업종 전체 (최종 카드 DB 프로모션)
    title text not null default '',
    issuer_code text,                            -- 없으면 모든 카드사
    card_id bigint references placement.card_catalog,
    benefit_type text,
    amount integer,
    rate numeric(6, 4),
    min_amount integer not null default 0,
    max_amount integer,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    payout text,
    note text,
    needs_check boolean not null default false
);

create table if not exists placement.recommendation_logs (
    recommendation_id bigserial primary key,
    user_id bigint not null references placement.users,
    recommended_at timestamptz not null,
    version text not null,                   -- schedule (일정으로 정함) / pattern (소비 패턴으로 정함)
    scenario_mode text not null,
    base_card bigint not null,
    scenarios jsonb not null,
    scores jsonb not null,
    ranking jsonb not null,
    display_count integer not null,
    reason_code text not null,
    used_card bigint,                        -- 결제 후 Spring 이 채운다
    best_card bigint                         -- 결제 후 Spring 이 채운다
);
create index if not exists recommendation_logs_user on placement.recommendation_logs (user_id, recommendation_id desc);

-- 하루 일정 (2026-11-14). 최소 수집: 시간·업종·예상 금액만, 장소·메모 없음.
-- 내용은 암호문(engine/crypto.py, 키는 KMS)으로만 저장하고 지난 날은 엔진이 지운다.
create table if not exists placement.schedules (
    user_id bigint not null references placement.users,
    day date not null,
    payload bytea not null,                  -- 암호문: {"items": [{start, end, category, amount}, ...]}
    created_at timestamptz not null default now(),
    primary key (user_id, day)
);

-- 신규 카드 추천 기록 (같은 카드를 자주 추천하지 않게)
create table if not exists placement.card_recommendations (
    user_id bigint not null references placement.users,
    recommended_at timestamptz not null,
    card_id bigint not null references placement.card_catalog,
    trigger text not null,                   -- regular / repeat / special_visit / schedule
    gain integer not null,                   -- 추천 근거 금액 (원)
    primary key (user_id, recommended_at)
);

-- 가상 카드 시절(2026-11-13 이전)에 만든 데이터베이스를 실제 카드 구조로 맞춘다. 새로 만든 데이터베이스에서는 아무 일도 하지 않는다.
alter table placement.card_benefits drop column if exists rate_by_tier;
alter table placement.card_benefits add column if not exists targets text;
alter table placement.card_benefits add column if not exists max_prev_perf integer;
alter table placement.card_benefits add column if not exists basis text not null default 'benefit';
alter table placement.card_benefits add column if not exists pay_type text;
alter table placement.card_benefits add column if not exists source_benefit_id bigint;
alter table placement.promotions add column if not exists category_code text;
alter table placement.card_benefits alter column cap_group drop not null;
alter table placement.card_benefits add column if not exists per_liter integer;
alter table placement.card_benefits add column if not exists min_prev_perf integer not null default 0;
alter table placement.card_benefits add column if not exists max_per_tx integer;
alter table placement.card_benefits add column if not exists daily_count integer;
alter table placement.card_benefits add column if not exists cap_unit text not null default 'krw';
alter table placement.card_benefits add column if not exists row_cap integer;
alter table placement.card_benefits add column if not exists month_days text;
alter table placement.card_benefits add column if not exists brands text;
alter table placement.card_benefits add column if not exists plan_day integer;
alter table placement.card_benefits add column if not exists plan_mult numeric(4, 2);
alter table placement.card_benefits add column if not exists benefit_name text;
alter table placement.card_benefits add column if not exists also_categories text;
alter table placement.card_cap_tiers add column if not exists cap_unit text not null default 'krw';
alter table placement.merchants add column if not exists brand_code text;

-- GPS 제거 (2026-11-14): 위치 동의 값과 위치 기록 컬럼을 지운다.
alter table placement.users drop column if exists loc_consent;
alter table placement.users drop column if exists loc_feature_on;
alter table placement.recommendation_logs drop column if exists lat;
alter table placement.recommendation_logs drop column if exists lng;
alter table placement.recommendation_logs drop column if exists chips;

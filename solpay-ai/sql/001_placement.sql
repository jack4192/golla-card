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

create table if not exists placement.card_benefits (
    benefit_id bigint primary key,
    card_id bigint not null references placement.card_catalog,
    category_code text not null,
    benefit_type text not null,
    rate numeric(6, 4),
    rate_by_tier text,
    amount integer,
    min_amount integer not null default 0,
    monthly_count integer,
    cap_group text not null,
    days text,
    hour_start integer,
    hour_end integer
);

create table if not exists placement.card_cap_tiers (
    card_id bigint not null references placement.card_catalog,
    cap_group text not null,
    min_prev_perf integer not null,
    monthly_cap integer,
    primary key (card_id, cap_group, min_prev_perf)
);

create table if not exists placement.merchants (
    merchant_id bigint primary key,
    place_name text not null,
    category_code text not null,
    lat double precision,
    lng double precision,
    is_online boolean not null default false,
    zone_code text
);
create index if not exists merchants_location on placement.merchants (lat, lng);

create table if not exists placement.users (
    user_id bigint primary key,
    loc_consent boolean not null default false,
    loc_feature_on boolean not null default false
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
    promotion_id bigserial primary key,
    merchant_id bigint not null references placement.merchants,
    card_id bigint references placement.card_catalog,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    amount integer,
    rate numeric(6, 4),
    min_amount integer not null default 0,
    title text not null default ''
);

create table if not exists placement.recommendation_logs (
    recommendation_id bigserial primary key,
    user_id bigint not null references placement.users,
    recommended_at timestamptz not null,
    lat double precision,                    -- 위치 동의 사용자만 저장
    lng double precision,
    version text not null,
    scenario_mode text not null,
    base_card bigint not null,
    chips jsonb not null,
    scenarios jsonb not null,
    scores jsonb not null,
    ranking jsonb not null,
    display_count integer not null,
    reason_code text not null,
    used_card bigint,                        -- 결제 후 Spring 이 채운다
    best_card bigint                         -- 결제 후 Spring 이 채운다
);
create index if not exists recommendation_logs_user on placement.recommendation_logs (user_id, recommendation_id desc);

-- 카드 상품·혜택 테이블. data/collector 의 load 단계가 실행할 때마다 적용한다 (IF NOT EXISTS).
-- 나중에 Spring 레포의 Flyway 마이그레이션으로 옮긴다.

CREATE TABLE IF NOT EXISTS card_issuers (
    issuer_code   text PRIMARY KEY,           -- SHINHAN, KB, HANA, WOORI, HYUNDAI, BC, NH, TOSS ...
    issuer_name   text NOT NULL,
    crawl_status  text NOT NULL,              -- collected / excluded
    crawl_note    text                        -- 제외 이유 등
);

-- 카드 상품. 카드사 공식 상품 상세 페이지에서 수집
CREATE TABLE IF NOT EXISTS card_products (
    card_id            bigserial PRIMARY KEY,
    issuer_code        text NOT NULL REFERENCES card_issuers(issuer_code),
    source_id          text NOT NULL,         -- 카드사 사이트의 상품 id
    product_url        text NOT NULL,
    card_name          text,
    card_type          text CHECK (card_type IN ('credit', 'check')),
    card_type_guessed  boolean NOT NULL DEFAULT false,   -- 주소가 아니라 카드명으로 추정했는지
    annual_fee_krw     integer,
    annual_fee_note    text,
    launch_date        date,
    discontinued       boolean NOT NULL DEFAULT false,   -- 원문에 판매 종료·신규 발급 중단 표시
    headline_benefits  text[] NOT NULL DEFAULT '{}',     -- 규칙 파서가 뽑은 대표 혜택 문구
    retrieved_at       timestamptz NOT NULL,             -- 원문 수집 시각
    content_sha256     text,                             -- 받은 원문의 해시
    parse_warnings     text[] NOT NULL DEFAULT '{}',
    structured_model   text,                             -- AI 구조화 모델 (안 했으면 null)
    structured_at      timestamptz,
    structure_warnings text[] NOT NULL DEFAULT '{}',
    review_status      text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'reviewed')),
    demo_slot          text UNIQUE,                      -- 가상 소비 데이터의 카드 코드 (시연용으로 고른 카드만)
    UNIQUE (issuer_code, source_id)
);

-- AI 구조화 혜택
CREATE TABLE IF NOT EXISTS card_benefits (
    benefit_id                   bigserial PRIMARY KEY,
    card_id                      bigint NOT NULL REFERENCES card_products(card_id) ON DELETE CASCADE,
    seq                          integer NOT NULL,
    title                        text NOT NULL,
    categories                   text[] NOT NULL,         -- 업종 코드 21개 + ALL / OVERSEAS / OTHER
    tags                         text[] NOT NULL DEFAULT '{}',
    merchants                    text[] NOT NULL DEFAULT '{}',
    benefit_type                 text NOT NULL,
    rate                         numeric,                 -- 0~1
    amount                       integer,
    time_start                   time,
    time_end                     time,
    weekdays                     text[],
    channel                      text NOT NULL DEFAULT 'any',
    pay_apps                     text[] NOT NULL DEFAULT '{}',
    min_txn_amount               integer,
    max_eligible_amount_per_txn  integer,
    max_benefit_per_txn          integer,
    daily_count                  integer,
    monthly_count                integer,
    requires_prev_spend          integer,
    cap_group                    text,
    excludes                     text[] NOT NULL DEFAULT '{}',
    notes                        text,
    quote                        text,                    -- 근거 원문
    needs_review                 boolean NOT NULL,
    UNIQUE (card_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_card_benefits_categories ON card_benefits USING gin (categories);

-- 전월 실적 구간별 한도
CREATE TABLE IF NOT EXISTS card_cap_tiers (
    card_id      bigint NOT NULL REFERENCES card_products(card_id) ON DELETE CASCADE,
    cap_group    text NOT NULL,
    description  text,
    tier_min     integer NOT NULL,
    tier_max     integer,
    cap_amount   integer,
    count_limit  integer,
    PRIMARY KEY (card_id, cap_group, tier_min)
);

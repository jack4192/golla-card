// 실행: node --test utils/__tests__/chatBlocks.test.mjs
// 챗봇 답 아래 표 (2026-11-24 사용자 결정 '앱에서 표 그리기'). 픽스처는 AI 서버 도구가 데모 1번에게 실제로 돌려준 blocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatBlockViews } from '../chatBlocks.js';

const demo = JSON.parse(readFileSync(new URL('./fixtures/chatBlocks.demo1.json', import.meta.url), 'utf8'));
// 지갑 카드 id → 서버 userCardId (utils/serverCards.js serverCardLinks 모양). 데모 1번: 1 Discount Plan+, 2 SOL트래블, 3 KB ALL
const links = { SH_DISCOUNT_PLAN_PLUS: 1, SH_SOL_TRAVEL_CHECK: 2, KB_ALL: 3 };

test('결제 추천: 카드 비교표에 추천 카드를 강조하고, 결제 버튼은 지갑 카드로 잇는다', () => {
  const [compare, pay] = chatBlockViews(demo.recommend_for_payment, links);
  assert.equal(compare.kind, 'compare');
  assert.equal(compare.title, '스타벅스 6,000원 · 카드 비교');
  assert.deepEqual(compare.rows.map(r => [r.name, r.amount, r.highlight]), [
    ['신한카드 Discount Plan+', '600원', true], ['KB ALL 카드', '60원', false], ['신한카드 SOL트래블 체크', '0원', false],
  ]);
  assert.deepEqual(pay, { kind: 'pay', name: '신한카드 Discount Plan+', walletId: 'SH_DISCOUNT_PLAN_PLUS' });
});

test('지갑에 이어진 카드가 없으면 결제 버튼은 빼고, 추천 카드가 없는 비교는 가장 큰 카드를 강조한다', () => {
  assert.deepEqual(chatBlockViews(demo.recommend_for_payment, {}).map(v => v.kind), ['compare']);
  const [compare] = chatBlockViews(demo.simulate_payment, links);
  const top = compare.rows.find(r => r.highlight);
  assert.equal(compare.rows.filter(r => r.highlight).length, 1);
  assert.equal(top.name, '신한카드 Discount Plan+');
  assert.match(compare.title, /카드 비교$/);
});

test('옛 AI 서버(비교표에 recommended 없음)는 결제 버튼의 카드를 추천 카드로 본다', () => {
  const old = demo.recommend_for_payment.map(block => {
    const { recommended, ...rest } = block;
    return rest;
  });
  const [compare] = chatBlockViews(old, links);
  assert.equal(compare.rows.find(r => r.highlight).name, '신한카드 Discount Plan+');
});

test('카드 순서 이유: 1~3순위와 예상 혜택, 기본 카드 표시', () => {
  const [rank] = chatBlockViews(demo.explain_ranking, links);
  assert.equal(rank.kind, 'rank');
  assert.ok(rank.rows.length >= 1 && rank.rows.length <= 3);
  assert.deepEqual(rank.rows[0].rank, 1);
  assert.equal(rank.rows[0].amount, '680원');
  const base = demo.explain_ranking[0].base_card;
  const baseRow = demo.explain_ranking[0].rows.find(r => r.user_card_id === base);
  assert.ok(rank.rows.find(r => r.name === baseRow.name).tags.includes('기본 카드'));
});

test('실적 현황: 이번 달 실적, 다음 구간까지 진행 막대와 남은 금액', () => {
  const [status] = chatBlockViews(demo.get_card_status, links);
  assert.equal(status.kind, 'status');
  assert.equal(status.title, '2026-11 실적 · 다음 구간까지');
  const dp = status.rows.find(r => r.name === '신한카드 Discount Plan+');
  assert.deepEqual([dp.perf, dp.goal, dp.left], ['48,440원', '400,000원', '351,560원 남음']);
  assert.ok(dp.ratio > 0.1 && dp.ratio < 0.15);
  assert.ok(status.rows.every(r => r.ratio >= 0 && r.ratio <= 1));
});

test('카드 혜택: 연회비와 혜택 몇 줄', () => {
  const [card] = chatBlockViews(demo.get_card_benefits, links);
  assert.equal(card.kind, 'benefits');
  assert.match(card.title, /SOL트래블/);
  assert.match(card.sub, /연회비/);
  assert.ok(card.rows.length >= 1 && card.rows.length <= 5);
  assert.ok(card.rows.every(r => r.name && r.value));
});

test('새 카드 추천: 3장, 연회비를 뺀 월 순혜택', () => {
  const [cards] = chatBlockViews(demo.recommend_new_card, links);
  assert.equal(cards.kind, 'newCards');
  assert.equal(cards.rows.length, demo.recommend_new_card[0].cards.length);
  assert.match(cards.rows[0].amount, /^월 [\d,]+원$/);
  assert.match(cards.rows[0].sub, /연회비/);
});

test('프로모션: 다섯 개까지, 끝나는 날은 월/일', () => {
  const [promos] = chatBlockViews(demo.list_promotions, links);
  const all = demo.list_promotions[0].promotions;
  assert.equal(promos.kind, 'promotions');
  assert.equal(promos.rows.length, Math.min(5, all.length));
  assert.equal(promos.more, Math.max(0, all.length - 5));
  assert.equal(promos.rows[0].until, `${Number(all[0].end.slice(5, 7))}/${Number(all[0].end.slice(8, 10))}까지`);
  assert.ok(promos.rows.every(r => r.brand && r.benefit && r.kind));
});

test('규칙 카드·모르는 표·빈 값은 그리지 않는다', () => {
  assert.deepEqual(chatBlockViews(undefined, links), []);
  assert.deepEqual(chatBlockViews([{ type: 'rule_card', summary: 'x' }, { type: 'new_thing' }], links), []);
  assert.deepEqual(chatBlockViews([{ type: 'card_compare', basis: 'x', rows: [] }], links), []);
});

// ---------- 고도화 2단계 표 (2026-11-24) ----------

test('결제 요약: 합계·건수·기간, 업종별 막대, 직전 같은 기간', () => {
  const [v] = chatBlockViews(demo.get_spending, links);
  const b = demo.get_spending[0];
  assert.equal(v.kind, 'spending');
  assert.equal(v.title, '이번 달 결제');
  assert.equal(v.total, Number(b.total).toLocaleString('ko-KR') + '원');
  assert.match(v.sub, /11\/1~11\/5 · \d+건/);
  assert.match(v.previous, /^직전 같은 기간 [\d,]+원$/);
  assert.equal(v.rows.length, b.by_category.length);
  assert.equal(v.rows[0].ratio, 1);
  assert.ok(v.rows.every(r => r.ratio > 0 && r.ratio <= 1 && /원$/.test(r.amount)));
});

test('지난 결제 다시 보기: 낸 카드와 가장 많이 받았을 카드, 그 결제만 본 값이라고 밝힘', () => {
  const [v] = chatBlockViews(demo.review_payments, links);
  const row = demo.review_payments[0].rows[0];
  assert.equal(v.kind, 'review');
  assert.match(v.sub, /그 결제만 보면/);
  assert.equal(v.rows[0].label, `11/3 ${row.brand}`);
  assert.equal(v.rows[0].used, `${row.used_card} ${row.got.toLocaleString('ko-KR')}원`);
  assert.match(v.rows[0].best, /\+[\d,]+원\)$/);
});

test('받은 혜택: 합계, 카드별, 올해는 달별 막대와 놓친 혜택 문장', () => {
  const [last] = chatBlockViews(demo.get_benefit_summary_last_month, links);
  assert.equal(last.kind, 'benefitSummary');
  assert.deepEqual(last.months, []);
  assert.ok(last.rows.length >= 1 && last.lines.length >= 0);
  const [year] = chatBlockViews(demo.get_benefit_summary_this_year, links);
  assert.equal(year.title, '2026년 받은 혜택');
  assert.ok(year.months.length >= 1 && year.months.every(m => m.ratio >= 0 && m.ratio <= 1));
  assert.ok(year.months.some(m => m.ratio === 1));
});

test('하루 카드 계획과 규칙 목록', () => {
  const [day] = chatBlockViews(demo.get_day_plan, links);
  assert.equal(day.kind, 'dayPlan');
  assert.deepEqual(day.rows[0], { time: '00:00~24:00', card: '신한카드 Discount Plan+' });
  const [rules] = chatBlockViews(demo.list_my_rules, links);
  assert.equal(rules.kind, 'rules');
  assert.deepEqual(rules.rows[0], { summary: '주말에는 KB ALL 카드를 먼저 보여 드려요', sub: '먼저 보여 주기 · 주말, 하루 종일' });
  const [none] = chatBlockViews([{ type: 'rule_list', rules: [] }], links);
  assert.equal(none.title, '저장된 규칙이 없어요');
});

test('카드 지정 비교는 새 카드 목록 표를 다시 쓰고 제목을 바꾼다', () => {
  const [v] = chatBlockViews(demo.compare_cards, links);
  assert.equal(v.kind, 'newCards');
  assert.equal(v.title, demo.compare_cards[0].title);
  assert.equal(v.rows.length, 2);
});

// 챗봇 답 아래 표 (2026-11-24 팀 결정 '앱에서 표 그리기').
//
// AI 서버(/internal/chat)는 답 문장(reply)과 함께 표 데이터(blocks)를 보낸다. 백엔드는 그대로 넘긴다.
// 여기서는 blocks 를 화면에 그리기 좋은 모양(view)으로만 바꾼다. 그리는 일은 components/ChatBlocks.js.
// 테스트: node --test utils/__tests__/chatBlocks.test.mjs

const won = value => Math.round(Number(value) || 0).toLocaleString('ko-KR') + '원';
const md = day => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const monthDay = day => `${md(day)}까지`;
const ratioOf = (value, max) => (max > 0 ? Math.max(0, Math.min(1, (Number(value) || 0) / max)) : 0);

/**
 * blocks → view 목록. 모르는 표, 규칙 카드(이미 초안 카드로 보여 줌), 빈 표는 뺀다.
 * links: 지갑 카드 id → 서버 userCardId (utils/serverCards.js serverCardLinks). 결제 버튼을 지갑 카드로 잇는 데 쓴다.
 */
export function chatBlockViews(blocks, links = {}) {
  const walletIdOf = new Map(Object.entries(links || {}).map(([walletId, userCardId]) => [String(userCardId), walletId]));
  const list = Array.isArray(blocks) ? blocks : [];
  // 옛 AI 서버는 비교표에 추천 카드(recommended)를 넣지 않는다. 결제 버튼의 카드가 추천 카드다
  const payName = list.find(block => block?.type === 'pay_button')?.name;
  const views = [];
  for (const block of list) {
    const view = toView(block?.type === 'card_compare' && !block.recommended && payName ? { ...block, recommended: payName } : block,
      walletIdOf);
    if (view) views.push(view);
  }
  return views;
}

function toView(block, walletIdOf) {
  switch (block?.type) {
    case 'card_compare': return compareView(block);
    case 'pay_button': {
      const walletId = walletIdOf.get(String(block.user_card_id));
      return walletId ? { kind: 'pay', name: block.name, walletId } : null;
    }
    case 'score_table': return rankView(block);
    case 'card_status': return statusView(block);
    case 'benefit_list': return benefitsView(block);
    case 'new_card_list': return newCardsView(block);
    case 'promotion_list': return promotionsView(block);
    case 'spending_summary': return spendingView(block);
    case 'payment_review': return reviewView(block);
    case 'benefit_summary': return benefitSummaryView(block);
    case 'day_plan': return dayPlanView(block);
    case 'rule_list': return rulesView(block);
    case 'schedule_draft': return block.input ? { kind: 'scheduleDraft', summary: block.summary, input: block.input } : null;
    case 'rule_delete_draft': return block.rules?.length ? { kind: 'ruleDelete', summary: block.summary, rules: block.rules } : null;
    default: return null;
  }
}

function compareView(block) {
  const rows = (block.rows || []).map(row => ({
    name: row.name,
    total: row.total ?? (row.benefit || 0) + (row.promotion || 0),
    promotion: row.promotion || 0,
  }));
  if (!rows.length) return null;
  // 결제 추천은 추천 카드(실적을 지키는 기본 카드일 수 있음), 가정 비교는 혜택이 가장 큰 카드를 강조한다
  const pick = rows.find(row => row.name === block.recommended) || rows.reduce((a, b) => (b.total > a.total ? b : a));
  return {
    kind: 'compare',
    title: `${block.basis} · 카드 비교`,
    rows: rows.map(row => ({
      name: row.name,
      amount: won(row.total),
      sub: row.promotion > 0 ? `프로모션 ${won(row.promotion)} 포함` : null,
      highlight: row === pick,
    })),
  };
}

function rankView(block) {
  const rows = (block.rows || []).slice(0, 3).map(row => ({
    rank: row.rank,
    name: row.name,
    amount: won(row.expected_total),
    sub: row.promotion > 0 ? `프로모션 ${won(row.promotion)} 포함` : null,
    tags: row.user_card_id === block.base_card ? ['기본 카드'] : [],
  }));
  return rows.length ? { kind: 'rank', title: '결제 화면 카드 순서 · 예상 혜택', rows } : null;
}

function statusView(block) {
  const rows = (block.rows || []).map(row => {
    const goal = row.next_tier_min;
    return {
      name: row.name,
      perf: won(row.this_month_perf),
      goal: goal ? won(goal) : null,
      ratio: goal ? Math.max(0, Math.min(1, (row.this_month_perf || 0) / goal)) : 1,
      left: goal ? `${won(row.remaining_to_next_tier)} 남음` : '가장 높은 구간',
      benefit: `이번 달 받은 혜택 ${won(row.benefit_this_month)}`,
    };
  });
  return rows.length ? { kind: 'status', title: `${block.month} 실적 · 다음 구간까지`, rows } : null;
}

function benefitsView(block) {
  const rows = (block.benefits || []).slice(0, 5).map(item => {
    const tiers = item.by_prev_month_perf || [];
    const values = [...new Set(tiers.map(tier => tier.value).filter(Boolean))];
    const maxPer = tiers.find(tier => tier.max_per_payment)?.max_per_payment;
    return {
      name: item.name,
      where: (item.where || []).slice(0, 3).join(', '),
      value: values.join(' · ') + (values.length > 1 ? ' (전월 실적별)' : '') + (maxPer ? ` · 건당 최대 ${won(maxPer)}` : ''),
    };
  }).filter(row => row.name && row.value);
  const fee = block.annual_fee == null ? null : `연회비 ${won(block.annual_fee)}`;
  return {
    kind: 'benefits',
    title: block.name,
    sub: [block.issuer, block.card_type, fee].filter(Boolean).join(' · '),
    rows,
  };
}

function newCardsView(block) {
  const rows = (block.cards || []).map(card => ({
    name: card.name,
    amount: `월 ${won(card.net_benefit)}`,
    sub: [`연회비 ${won(card.annual_fee)}`, ...(card.top_categories || []).slice(0, 2).map(c => c.category_name)].join(' · '),
  }));
  return rows.length ? { kind: 'newCards', title: block.title || '내 소비로 다시 계산한 신한카드 · 연회비 뺀 월 혜택', rows } : null;
}

function promotionsView(block) {
  const all = block.promotions || [];
  return {
    kind: 'promotions',
    title: all.length ? '지금 받을 수 있는 프로모션' : '지금 받을 수 있는 프로모션이 없어요',
    rows: all.slice(0, 5).map(p => ({ brand: p.brand, kind: p.kind, benefit: p.benefit, until: monthDay(p.end) })),
    more: Math.max(0, all.length - 5),
  };
}

// ---------- 고도화 2단계 표 (2026-11-24) ----------

function spendingView(block) {
  const cats = block.by_category || [];
  const max = Math.max(0, ...cats.map(c => c.amount));
  return {
    kind: 'spending',
    title: block.title,
    total: won(block.total),
    sub: `${md(block.from)}~${md(block.to)} · ${block.count}건`,
    previous: block.previous_total == null ? null : `직전 같은 기간 ${won(block.previous_total)}`,
    rows: cats.map(c => ({ name: c.category_name, amount: won(c.amount), count: c.count, ratio: ratioOf(c.amount, max) })),
  };
}

function reviewView(block) {
  return {
    kind: 'review',
    title: block.title,
    sub: block.count
      ? `${block.count}건 중 ${block.best_card_count}건은 가장 많이 받는 카드 · 그 결제만 보면 더 받을 수 있던 금액 ${won(block.missed_total)}`
      : '비교할 결제가 없어요',
    rows: (block.rows || []).map(r => ({
      label: `${md(r.date)} ${r.brand || r.category_name}`,
      amount: won(r.amount),
      used: `${r.used_card} ${won(r.got)}`,
      best: r.missed > 0 ? `${r.best_card} ${won(r.best_got)} (+${won(r.missed)})` : '가장 많이 받는 카드로 냈어요',
    })),
  };
}

function benefitSummaryView(block) {
  const months = block.by_month || [];
  const max = Math.max(0, ...months.map(m => m.benefit));
  return {
    kind: 'benefitSummary',
    title: block.title,
    total: won(block.total),
    rows: (block.rows || []).map(r => ({ name: r.name, amount: won(r.benefit) })),
    months: months.map(m => ({ label: m.month, amount: won(m.benefit), ratio: ratioOf(m.benefit, max) })),
    lines: block.lines || [],
  };
}

function dayPlanView(block) {
  const rows = (block.rows || []).map(r => ({ time: `${r.start}~${r.end}`, card: r.card }));
  if (!rows.length) return null;
  return {
    kind: 'dayPlan',
    title: '오늘 시간대별 결제 화면 1순위 카드',
    rows,
    schedules: (block.schedules || []).map(s => ({ time: `${s.start}~${s.end}`, label: s.category_name })),
  };
}

function rulesView(block) {
  const rows = (block.rules || []).map(r => ({ summary: r.summary, sub: [r.kind, r.condition].filter(Boolean).join(' · ') }));
  return { kind: 'rules', title: rows.length ? '저장된 규칙' : '저장된 규칙이 없어요', rows };
}

// ---------- 고도화 3단계: 규칙 지우기 (2026-11-24) ----------

const RULE_FIELDS = ['rule_type', 'condition', 'target', 'settings'];
const sameContent = (a, b) => RULE_FIELDS.every(field => JSON.stringify(a?.[field] ?? {}) === JSON.stringify(b?.[field] ?? {}));

/**
 * 지금 저장된 규칙(current, GET /api/ai/rules)에서 지우기 초안의 규칙(drafts: [{rule_id, rule}])을 뺀 목록.
 * rule_id 가 둘 다 있으면 번호로, 없으면 규칙 내용(종류·조건·대상·설정)으로 찾는다. 저장할 때 rule_id 는 뗀다 (PUT 은 목록을 통째로 바꾼다).
 */
export function withoutRules(current, drafts) {
  const list = Array.isArray(current) ? current : [];
  const gone = new Set();
  for (const draft of drafts || []) {
    const index = list.findIndex((rule, i) => !gone.has(i) && (
      draft.rule_id != null && rule.rule_id != null ? rule.rule_id === draft.rule_id : sameContent(rule, draft.rule)));
    if (index >= 0) gone.add(index);
  }
  return list.filter((_, i) => !gone.has(i)).map(({ rule_id, ...rule }) => rule);
}

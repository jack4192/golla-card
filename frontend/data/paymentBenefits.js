// 출처: 사용자가 제공한 '통합.pdf'.
// 실제 거래내역/카드별 전월실적/잔여 월 한도를 읽는 API는 없음.
// 카드명과 ID가 PDF 상품과 일치할 때만 아래 추정을 수행.

export const PAYMENT_SCENARIOS = [
  { id: 'cu', label: 'CU 간편식', amount: 10000, note: 'CU 현장/포켓CU에서 간편식 구매' },
  { id: 'gs', label: 'GS25', amount: 12000, note: 'GS25 일반 구매, 실물카드 또는 GS Pay' },
  { id: 'coffee', label: '스타벅스', amount: 15000, note: '국내 스타벅스 매장 또는 사이렌 오더' },
  { id: 'yogi', label: '요기요', amount: 25000, note: '요기요 공식 앱에서 직접 결제' },
  { id: 'naver', label: '네이버쇼핑', amount: 35000, note: '네이버쇼핑 또는 네이버페이 온라인 가맹점' },
  { id: 'kakao', label: '카카오페이', amount: 20000, note: '카카오페이로 해당 체크카드 간편결제' },
  { id: 'transit', label: '버스·지하철', amount: 20000, note: '후불교통 RF 터치 이용금액(기간 합산 예시)' },
  { id: 'general', label: '일반 가맹점', amount: 30000, note: '기본 적립 대상 일반 구매' },
];

export const PREVIOUS_SPEND_CHOICES = [
  { value: null, label: '미입력' },
  { value: 0, label: '0원' },
  { value: 200000, label: '20만' },
  { value: 300000, label: '30만' },
  { value: 500000, label: '50만' },
  { value: 600000, label: '60만' },
  { value: 700000, label: '70만' },
  { value: 800000, label: '80만' },
  { value: 1000000, label: '100만' },
];

export const formatMoney = (number) =>
  `${Math.max(0, Number(number) || 0).toLocaleString('ko-KR')}원`;

const percent = (amount, rate) => Math.floor(amount * rate);
const spendMissing = (spend) => !Number.isFinite(spend);

// 원화 할인, 캐시백, 서로 다른 포인트, 스타벅스 별은 교환가치가 같지 않음.
// '원'으로 포인트/별을 환산하거나, 서로 다른 단위를 합산하지 않음.
const result = (card, scenario, fields) => ({
  cardId: card.id,
  name: card.name,
  scenario,
  source: card.source || '사용자 제공 PDF',
  status: 'eligible',
  label: '',
  value: null,
  unit: null,
  detail: '',
  rule: '',
  ...fields,
});

const unknown = (card, scenario, text, source = '') => result(card, scenario, {
  status: 'unknown',
  label: '혜택 계산 불가',
  detail: text,
  source: source || card.source || '해당 상품 PDF 없음',
});

const notApplicable = (card, scenario, text) => result(card, scenario, {
  status: 'notApplicable',
  label: '해당 업종 혜택 미확인',
  detail: text,
});

const requiresSpend = (card, scenario, threshold, spend, title) => {
  if (spendMissing(spend)) {
    return result(card, scenario, {
      status: 'needSpend',
      label: '카드별 전월 실적을 입력해주세요',
      detail: `${title} · 전월 ${formatMoney(threshold)} 이상 조건`,
    });
  }
  if (spend < threshold) {
    return result(card, scenario, {
      status: 'belowSpend',
      label: '전월 실적 조건 미달',
      detail: `${title} · 전월 ${formatMoney(threshold)} 이상 필요 (현재 가정 ${formatMoney(spend)})`,
    });
  }
  return null;
};

const eligible = (card, scenario, value, unit, label, detail, rule) =>
  result(card, scenario, { value, unit, label, detail, rule });

export function evaluatePdfCard(card, scenario, paymentAmount, previousSpend) {
  if (!card?.id || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return unknown(card || { id: 'none', name: '카드 없음' }, scenario, '결제금액을 입력해주세요.');
  }

  const amount = Math.floor(paymentAmount);
  const spend = previousSpend;

  // 사용자 PDF에 없는 기존 3개 데모 카드 등은 임의로 할인율을 만들지 않음.
  if (!['focus','gsall','solmate','naver','starbucks','yogi','chunsik','ryan'].includes(card.id)) {
    return unknown(card, scenario, '카드 상품명과 일치하는 PDF 상품 혜택이 없어 계산하지 않습니다.');
  }

  if (card.id === 'focus') {
    if (scenario === 'cu') {
      // 안내장 6쪽: 간편식 5% 즉시할인, 10원 단위 올림, 1회 2천원.
      const instant = Math.min(2000, Math.ceil((amount * 0.05) / 10) * 10);
      const cashbackLimit = spendMissing(spend) ? 0
        : spend >= 1000000 ? 17000
        : spend >= 700000 ? 12000
        : spend >= 300000 ? 7000 : 0;
      const cashback = cashbackLimit ? Math.min(percent(amount, 0.10), cashbackLimit) : 0;
      const total = instant + cashback;
      const extra = spendMissing(spend)
        ? 'CU 10% 캐시백은 전월 실적을 입력하면 추가 추정할 수 있습니다.'
        : cashbackLimit
          ? 'CU 10% 캐시백은 잔여 월 한도가 있다는 가정하에 합산했습니다.'
          : '전월 30만 원 미만은 CU 10% 캐시백이 제외됩니다.';
      return eligible(card, scenario, total, '원',
        cashback > 0 ? '간편식 5% 즉시할인 + CU 10% 캐시백' : '간편식 5% 즉시할인',
        `즉시할인 ${formatMoney(instant)}${cashback > 0 ? ` + 캐시백 최대 ${formatMoney(cashback)}` : ''}. ${extra}`,
        '통합.pdf 6쪽 · CU 현장/포켓CU 간편식 대상. 1회 즉시할인 한도 2천원. 일부 매장/상품 제외.'
      );
    }
    if (scenario === 'transit') {
      const issue = requiresSpend(card, scenario, 300000, spend, '후불교통 10% 캐시백');
      if (issue) return issue;
      return eligible(card, scenario, Math.min(percent(amount, 0.10), 1000), '원',
        '후불교통 10% 캐시백', '월 캐시백 한도 1,000원 이내 상한 추정입니다.',
        '통합.pdf 6쪽 · 후불교통 RF 터치 결제. 일부 버스/공항철도 제외. 남은 월 한도 확인 필요.');
    }
  }

  if (card.id === 'gsall') {
    if (scenario === 'gs') {
      const issue = requiresSpend(card, scenario, 200000, spend, 'GS25 10% GS ALL 포인트');
      if (issue) return issue;
      return eligible(card, scenario, Math.min(percent(amount, 0.10), 5000), 'GS ALL P',
        'GS25 10% GS ALL 포인트', '월 특별적립 5,000P 한도 내 최대 추정.',
        '통합.pdf 10쪽 · GS25/GS리테일 공식 매장·결제. 일부 입점매장/간편결제 제외.');
    }
    if (scenario === 'general') {
      const issue = requiresSpend(card, scenario, 200000, spend, '일반 가맹점 0.2% GS ALL 포인트');
      if (issue) return issue;
      return eligible(card, scenario, percent(amount, 0.002), 'GS ALL P',
        '일반 가맹점 0.2% 적립', 'GS리테일 외 일반 결제 대상 기본 적립입니다.',
        '통합.pdf 10쪽 · 전월 20만원 이상. 제외 거래 확인 필요.');
    }
  }

  if (card.id === 'solmate') {
    if (scenario === 'coffee' || scenario === 'general') {
      const issue = requiresSpend(card, scenario, 200000, spend, 'SOL포인트 적립');
      if (issue) return issue;
      const special = scenario === 'coffee';
      const rate = special
        ? (spend >= 600000 ? 0.02 : 0.01)
        : (spend >= 600000 ? 0.004 : 0.002);
      const estimated = percent(Math.min(amount, special ? 300000 : amount), rate);
      return eligible(card, scenario, Math.min(estimated, 30000), 'SOL P',
        `${special ? '카페 특별' : '일반 기본'} ${(rate * 100).toFixed(1)}% 적립`,
        '기본/특별 적립은 중복되지 않습니다. 월 통합 한도와 이미 이용한 금액은 미반영.',
        '통합.pdf 24쪽 · 카페는 대상 업종 오프라인/사이렌 오더. 영역별 월 30만원, 통합 월 3만P 한도.');
    }
  }

  if (card.id === 'naver') {
    if (scenario === 'naver') {
      if (spendMissing(spend)) {
        return result(card, scenario, {
          status: 'needSpend',
          label: '네이버 적립률 1~2% · 전월 실적 입력 필요',
          detail: '전월 30만원 미만 1%, 30만~60만원 미만 1.5%, 60만원 이상 2%.',
          rule: '통합.pdf 32쪽 · 네이버쇼핑/네이버페이 온라인 대상, 월 1만P 한도.',
        });
      }
      const rate = spend >= 600000 ? 0.02 : spend >= 300000 ? 0.015 : 0.01;
      return eligible(card, scenario, Math.min(percent(amount, rate), 10000), '네이버페이 P',
        `네이버 결제 ${(rate * 100).toFixed(1)}% 적립`,
        '월 10,000P 한도 내 최대 추정입니다.',
        '통합.pdf 32쪽 · 네이버쇼핑/네이버페이 온라인 해당 거래. 월 적립 잔여 한도 확인 필요.');
    }
    if (scenario === 'general') {
      return eligible(card, scenario, percent(amount, 0.001), '네이버페이 P',
        '네이버 외 일반 결제 0.1% 적립', '전월 실적 조건 및 적립 한도 제한 없음.',
        '통합.pdf 32쪽 · 네이버 외 일반 가맹점. 적립 제외 거래 확인 필요.');
    }
  }

  if (card.id === 'starbucks' && scenario === 'coffee') {
    const issue = requiresSpend(card, scenario, 200000, spend, '스타벅스 별 리워드');
    if (issue) return issue;
    return result(card, scenario, {
      status: 'nonMonetary',
      label: spend >= 300000 ? '당월 누적 1만원당 별 2개' : '당월 누적 1만원당 별 1개',
      detail: spend >= 300000 ? '월 최대 10개' : '월 최대 3개',
      rule: '통합.pdf 54쪽 · 실제 별 개수는 당월 스타벅스 누적 실적과 이미 적립한 별에 따라 달라져 별도 계산이 필요합니다.',
    });
  }

  if (card.id === 'yogi' && scenario === 'yogi') {
    const issue = requiresSpend(card, scenario, 300000, spend, '요기요 건당 1,000원 캐시백');
    if (issue) return issue;
    if (amount < 20000) {
      return result(card, scenario, {
        status: 'minimum',
        label: '건당 결제금액 2만원 미달',
        detail: `현재 ${formatMoney(amount)} · 2만원 이상 결제 시 1,000원 캐시백`,
        rule: '통합.pdf 116쪽 · 요기요 공식 앱/사이트 직접 결제, 일 1회·월 3회.',
      });
    }
    return eligible(card, scenario, 1000, '원', '요기요 건당 1,000원 캐시백',
      '일 1회·월 3회, 특화서비스 월 통합한도 3~6천원(전월 실적 구간별).',
      '통합.pdf 116쪽 · 공식 앱/사이트 직접 결제. 잔여 사용 횟수·한도 확인 필요.');
  }

  if (card.id === 'chunsik') {
    if (scenario === 'cu' || scenario === 'gs') {
      const issue = requiresSpend(card, scenario, 300000, spend, '편의점 5% 카카오페이포인트');
      if (issue) return issue;
      return eligible(card, scenario, Math.min(percent(amount, 0.05), 1000), '카카오페이 P',
        '편의점 5% 적립', '통합 일 1회, 월 3회, 건당 1,000P 한도.',
        '통합.pdf 133쪽 · 4대 편의점 오프라인, 일부 입점/온라인 거래 제외.');
    }
  }

  if (card.id === 'ryan') {
    if (scenario === 'coffee' || scenario === 'transit') {
      const issue = requiresSpend(card, scenario, 300000, spend,
        scenario === 'coffee' ? '커피 5% 카카오페이포인트' : '대중교통 5% 카카오페이포인트');
      if (issue) return issue;
      const cap = scenario === 'coffee' ? 1000 : 3000;
      return eligible(card, scenario, Math.min(percent(amount, 0.05), cap), '카카오페이 P',
        `${scenario === 'coffee' ? '커피전문점' : '후불교통'} 5% 적립`,
        scenario === 'coffee' ? '건당 1,000P, 일 1회·월 3회 조건.' : '월 3,000P 한도 내 상한 추정.',
        '통합.pdf 133쪽 · 커피는 신한카드 업종 분류, 교통은 RF 터치 결제 대상.');
    }
  }

  if ((card.id === 'chunsik' || card.id === 'ryan') && scenario === 'kakao') {
    const issue = requiresSpend(card, scenario, 300000, spend, '카카오페이 결제 2% 카카오페이포인트');
    if (issue) return issue;
    return eligible(card, scenario, Math.min(percent(amount, 0.02), 10000), '카카오페이 P',
      '카카오페이 간편결제 2% 적립', '월 10,000P 한도 내 최대 추정입니다.',
      '통합.pdf 133쪽 · 카카오페이(pay) 간편결제 확인 필수. 일부 중복 적립 제외.');
  }

  return notApplicable(card, scenario, '해당 결제 상황에서 이 카드의 계산 가능한 혜택이 PDF에 명시되지 않았습니다.');
}

export function compareOwnedCards(cards, scenario, amount, spendByCard) {
  const rows = cards.map((card) =>
    evaluatePdfCard(card, scenario, amount, spendByCard?.[card.id])
  );
  const confirmed = rows.filter((item) => item.status === 'eligible');

  // 포인트를 현금으로 바꾸지 않는다. 동일 단위의 최대 수치만 비교한다.
  const bestByUnit = {};
  for (const item of confirmed) {
    if (!item.unit) continue;
    if (!bestByUnit[item.unit] || item.value > bestByUnit[item.unit].value) {
      bestByUnit[item.unit] = item;
    }
  }

  const order = {
    eligible: 0,
    nonMonetary: 1,
    needSpend: 2,
    belowSpend: 3,
    minimum: 4,
    notApplicable: 5,
    unknown: 6,
  };
  rows.sort((a, b) =>
    (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
    (a.unit === b.unit && a.unit != null ? (b.value || 0) - (a.value || 0) : 0)
  );

  return { rows, bestByUnit };
}

const generalDomestic = /^(?:국내(?:외)? (?:모든 |전체 )?가맹점|국내외 결제일 할인|기본 .*국내|국내 .*기본)/;
const unsupported = /리터|마일리지|마일 적립|추가 (?:할인|적립)|배 적립|웰컴|구독|자동납부/;
const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const numeric = value => Number(value.replace(/,/g, ''));
const won = value => value.toLocaleString('ko-KR') + '원';
const normalizeMerchant = name => name.trim().toLowerCase().replace(/\s/g, '').replace(/^씨유$/, 'cu');

export function matchesCatalogPaymentBenefit(benefit, scenario) {
  const { name } = benefit;
  if (generalDomestic.test(name)) return true;
  if (/^해외/.test(name)) return false;
  if (scenario.schedule) return scenario.matches(name);
  return scenario.category.test(name) || (scenario.id !== 'general' && scenario.brand.test(name));
}

function readTier(line) {
  const [minimum, reward, ...caps] = line.split(' · ');
  const spend = /^전월 ([\d,]+)원 이상$/.exec(minimum);
  const value = /^(\d+(?:\.\d+)?|[\d,]+)(%|원|P)$/.exec(reward || '');
  if (!spend || !value) return null;

  const row = { threshold: numeric(spend[1]), amount: numeric(value[1]), kind: value[2], caps: [] };
  if (row.kind === '%' && row.amount > 100) return null;
  for (const cap of caps) {
    const limit = /^(건당 한도|월 혜택 한도|월 대상 이용액) ([\d,]+)(원|P)$/.exec(cap);
    const count = /^월 (\d+)회$/.exec(cap);
    if (limit) row.caps.push({ type: limit[1], value: numeric(limit[2]), unit: limit[3] });
    else if (count) row.maxCount = Number(count[1]);
    else return null;
  }
  return row;
}

export function estimateCatalogBenefit(benefit, scenario, { spend, assume, now }) {
  const { name, note, type } = benefit;
  const out = (reason, value = null, unit = 'KRW') => ({ name, reason, value, unit, condition: note });
  if (!assume) return out('비교 조건을 선택하면 예상 혜택을 계산할 수 있어요.');
  if (unsupported.test(name)) return out('결제 방식이나 별도 적립 조건을 확인해주세요.');

  const lines = (note || '').split('\n').map(line => line.trim()).filter(Boolean);
  const thresholds = lines.filter(line => line.startsWith('전월 ')).map(readTier);
  if (!thresholds.length || thresholds.some(tier => !tier)) return out('상품 안내에서 실적 구간과 혜택 한도를 확인해주세요.');

  for (const line of lines) {
    if (line.startsWith('전월 ')) continue;
    if (line.startsWith('대상 ')) {
      const merchants = line.slice(3).split(',').map(normalizeMerchant);
      if (!scenario.namedMerchant) return out('혜택 대상 가맹점 확인이 필요해요.');
      if (!merchants.includes(normalizeMerchant(scenario.merchant))) return out('이 거래의 가맹점에 적용되는지 확인해주세요.');
      continue;
    }
    const minimum = /^최소 결제 ([\d,]+)원$/.exec(line);
    if (minimum) {
      if (scenario.amount < numeric(minimum[1])) return out('건당 ' + won(numeric(minimum[1])) + ' 이상 결제가 필요해요.');
      continue;
    }
    if (line === '온·오프라인 국내 가맹점. 실적·한도 제한 없음') continue;
    if (line.startsWith('혜택 그룹 ')) return out('다른 혜택과 함께 사용하는 통합 한도를 확인해주세요.');
    if (/현장 결제|오프라인|온라인|앱 |자동|간편결제/.test(line)) return out('결제 방법과 대상 매장 조건을 확인해주세요.');
    const days = /^적용 요일 ([A-Z]{3}(?:,\s*[A-Z]{3})*)$/.exec(line);
    if (days) {
      if (!days[1].split(/,\s*/).includes(weekdays[now.getDay()])) return out('선택한 날짜에 적용되는 혜택인지 확인해주세요.');
      continue;
    }
    return out('상품 안내의 추가 적용 조건을 확인해주세요.');
  }

  const tiers = thresholds.sort((a, b) => b.threshold - a.threshold);
  const tier = tiers.find(item => item.threshold <= (spend ?? 0));
  if (!tier) {
    return out(spend == null
      ? '전월 실적 확인이 필요해요.'
      : '전월 실적 ' + won(tiers[tiers.length - 1].threshold) + ' 이상이 필요해요.');
  }

  // Treat ambiguous data as conditional, even when the title includes a rate.
  if (/[만천]?\s*원\s*미만/.test(name)) return out('혜택이 적용되는 결제 금액 구간을 확인해주세요.');
  const points = tier.kind === 'P' || tier.caps.some(cap => cap.unit === 'P') || /포인트/.test(name);
  if ((type === '적립' && (!points || tier.kind === '원')) || (type !== '적립' && points)) return out('적립 단위를 확인해주세요.');
  const unit = points ? 'POINT' : 'KRW';
  const usageCap = tier.caps.find(cap => cap.type === '월 대상 이용액');
  if (usageCap && (usageCap.unit !== '원' || tier.kind !== '%')) return out('혜택 대상 이용액의 적용 방식을 확인해주세요.');
  const eligibleAmount = Math.min(scenario.amount, usageCap?.value ?? Infinity);
  const limits = tier.caps.filter(cap => cap !== usageCap);
  if (limits.some(cap => cap.unit !== (points ? 'P' : '원'))) return out('혜택 한도 단위를 확인해주세요.');
  const raw = tier.kind === '%' ? Math.floor(eligibleAmount * tier.amount / 100) : tier.amount;
  const capped = Math.min(raw, points ? Infinity : scenario.amount, ...limits.map(cap => cap.value));
  const value = tier.maxCount === 0 ? 0 : capped;
  return out('상품 안내의 실적 구간 적용 · 월 한도와 횟수 미사용 가정', value, unit);
}

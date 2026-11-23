import { CATEGORIES } from './routineData';
import { PAYMENT_SCENARIOS } from '../data/paymentBenefits';

// These amounts are used only for the payment simulation.
const examples = {
  cafe: ['카페', 15000],
  restaurant: ['음식점', 30000],
  pcroom: ['PC방', 10000],
  travel: ['여행·숙박', 100000],
  train: ['철도', 30000],
  intercity: ['시외·고속버스', 20000],
  transport: ['교통·이동', 5000],
  taxi: ['택시', 15000],
  convenience: ['편의점', 10000],
  delivery: ['배달', 30000],
  fuel: ['주유·충전', 50000],
  shopping: ['쇼핑 가맹점', 30000],
  medical: ['병원·약국', 20000],
};

const onlineShopping = /온라인\s*(?:몰|쇼핑|장보기)|쿠팡|네이버쇼핑|11번가|g마켓|SSG|롯데ON/i;
const grocery = /대형마트|할인마트|이마트|롯데마트|하나로마트|홈플러스|코스트코|트레이더스|장보기|(?:^|[^가-힣])마트/;

export function matchesScheduleBenefit(name, category) {
  const title = name.toLowerCase();
  if (category === 'transport') {
    return /대중\s*교통|지하철|버스/.test(title.replace(/(?:고속|시외)\s*버스/g, ''));
  }
  if (category === 'shopping' && (onlineShopping.test(title) || grocery.test(title))) return true;
  return CATEGORIES[category]?.words.some(word => (
    /^[a-z0-9]+$/i.test(word)
      ? new RegExp('\\b' + word + '\\b', 'i').test(title)
      : word !== '마트' && title.includes(word.toLowerCase())
  )) ?? false;
}

export function isScheduleBenefitAt(benefit, date) {
  if (!date) return true;
  const period = /(?:^|\n)적용 시간 (\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/.exec(benefit.note || '');
  const start = benefit.timeStart || period?.[1];
  const end = benefit.timeEnd || period?.[2];
  if (!start || !end) return true;
  const time = date.toTimeString().slice(0, 5);
  return start < end ? time >= start && time < end : time >= start || time < end;
}

export function makeSchedulePaymentScenario(schedule) {
  const example = examples[schedule?.category];
  if (!example) return null;

  const [label, amount] = example;
  const pdfExample = PAYMENT_SCENARIOS.find(scenario => scenario.id === schedule.pdfScenario);
  const shoppingType = schedule.category === 'shopping'
    ? onlineShopping.test(schedule.benefitName) ? onlineShopping
      : grocery.test(schedule.benefitName) ? grocery : null
    : null;

  return {
    id: 'schedule',
    schedule,
    merchant: pdfExample?.label || (shoppingType === grocery ? '마트' : shoppingType === onlineShopping ? '온라인몰' : label),
    amount: pdfExample?.amount ?? amount,
    matches: name => shoppingType ? shoppingType.test(name) : matchesScheduleBenefit(name, schedule.category),
  };
}

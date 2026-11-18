export const INDUSTRIES = [
  ['cafe','☕ 카페'], ['restaurant','🍽 음식점'], ['pcroom','🎮 PC방'],
  ['travel','✈️ 여행·숙박'], ['train','🚆 기차'], ['intercity','🚌 시외·고속버스'],
  ['transport','🚇 버스·지하철'], ['taxi','🚕 택시'], ['convenience','🏪 편의점'],
  ['delivery','🛵 배달'], ['fuel','⛽ 주유·충전'], ['shopping','🛍 쇼핑'], ['medical','🏥 병원·약국'],
];
export const DAYS = ['일','월','화','수','목','금','토'];
export const DETAIL_CATEGORIES = {
  pcroom: {label:'PC방', words:['PC방','pc방','피시방']},
  travel: {label:'여행·숙박', words:['여행','항공','숙박','호텔']},
  train: {label:'기차', words:['기차','철도','KTX','SRT']},
  intercity: {label:'시외·고속버스', words:['시외버스','고속버스']},
  taxi: {label:'택시', words:['택시']},
};
export function normalizeTime(value) {
  const match = String(value).trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!match || +match[1] > 23 || +match[2] > 59) return null;
  return match[1].padStart(2,'0') + ':' + match[2];
}
export function validateDetails(rows) {
  if (!Array.isArray(rows) || rows.length > 20) throw Error('상세 일과는 최대 20개까지 등록할 수 있습니다.');
  const ids = new Set();
  return rows.map((row,index) => {
    const fail = text => { throw Error((index+1) + '번째 일과: ' + text); };
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) fail('일과 식별자를 확인해주세요.');
    ids.add(row.id);
    if (!INDUSTRIES.some(([id])=>id===row.category)) fail('업종을 선택해주세요.');
    const start = normalizeTime(row.start), end = normalizeTime(row.end);
    if (!start || !end) fail('시간을 00:00~23:59로 입력해주세요. 예: 09:30');
    const minutes = time => +time.slice(0,2)*60 + +time.slice(3);
    const duration = minutes(end)-minutes(start)+(row.nextDay===true?1440:0);
    if (duration <= 0 || duration >= 1440) fail('종료 시간을 확인해주세요. 자정을 넘으면 ‘다음 날 종료’를 선택하세요.');
    if (!Array.isArray(row.days) || !row.days.length || row.days.some(day=>!Number.isInteger(day)||day<0||day>6)) fail('이용 요일을 선택해주세요.');
    if (!['week','month'].includes(row.unit) || !/^[1-9]\d?$/.test(String(row.count))) fail('이용 횟수를 1~99회로 입력해주세요.');
    return {id:row.id, category:row.category, start, end, nextDay:row.nextDay===true,
      days:[...new Set(row.days)].sort((a,b)=>a-b), unit:row.unit, count:Number(row.count)};
  });
}
export function detailSignals(rows, day) {
  let valid;
  try { valid=validateDetails(rows || []); } catch { return []; }
  const weekday = new Date(day+'T12:00:00').getDay();
  return valid.filter(row=>row.days.includes(weekday)).map(row => {
    const label = INDUSTRIES.find(([id])=>id===row.category)[1];
    const weekly = row.unit==='week'?row.count:row.count*7/30;
    return {id:row.category,weight:Math.min(4,1+Math.floor(weekly/2)),
      reason:'직접 설정: '+label+' '+row.start+'~'+(row.nextDay?'다음 날 ':'')+row.end+' · '+(row.unit==='week'?'주':'월')+' '+row.count+'회'};
  });
}

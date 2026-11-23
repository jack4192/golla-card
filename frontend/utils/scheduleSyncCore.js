// 기기의 일정을 서버 일정(/api/schedules)으로 바꾸는 순수 함수들 (서버 호출은 scheduleSync.js).
// 테스트: node --test utils/__tests__/scheduleSyncCore.test.mjs

// 앱의 장소 일정 업종(routineDetails.INDUSTRIES) → 서버 업종 코드(DB categories).
// 서버에 맞는 업종이 없는 PC방·기타는 OTHER 로 보낸다 (OTHER 는 AI 엔진에 넘어가지 않는다).
export const SERVER_CATEGORY = {
  cafe: 'CAFE',
  restaurant: 'RESTAURANT',
  pcroom: 'OTHER',
  travel: 'TRAVEL_AGENCY',
  train: 'INTERCITY_TRANSIT',
  intercity: 'INTERCITY_TRANSIT',
  transport: 'TRANSIT',
  taxi: 'TAXI',
  convenience: 'CONVENIENCE',
  delivery: 'DELIVERY',
  fuel: 'FUEL',
  shopping: 'ONLINE_SHOPPING',
  medical: 'HOSPITAL',
  other: 'OTHER',
};

// OTHER 로 보낼 때 서버가 이름을 요구한다.
const OTHER_TITLES = { pcroom: 'PC방' };

const clean = (value, limit) => String(value || '').trim().slice(0, limit);

// 올린 내용이 바뀌었는지 비교할 때 쓰는 값. 일정 내용 자체를 기기에 한 번 더 남기지 않으려고 해시로 둔다.
export function signatureOf(body) {
  const text = JSON.stringify(body);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36) + ':' + text.length;
}

// 기기 일정 하나 → 서버 요청 본문. 보낼 수 없는 일정이면 null.
//   장소 일정: { date, category, (title), start, end, (memo) }
//   상황 일정: { date, types, (start, end), (memo) }
export function toServerSchedule(event) {
  if (!event?.date) return null;
  const body = { date: event.date };

  if (event.category) {
    const category = SERVER_CATEGORY[event.category];
    if (!category || !event.start || !event.end) return null;
    body.category = category;
    if (category === 'OTHER') {
      const title = clean(event.title, 40) || OTHER_TITLES[event.category] || '';
      if (!title) return null;
      body.title = title;
    }
    body.start = event.start;
    body.end = event.end;
    const memo = clean(event.memo, 80);
    if (memo) body.memo = memo;
    return body;
  }

  const types = Array.isArray(event.types) ? event.types.filter(Boolean) : [];
  if (!types.length) return null;
  body.types = types;
  if (event.start && event.end) {
    body.start = event.start;
    body.end = event.end;
  }
  // 상황 일정의 직접 입력 이름은 서버에 둘 칸이 없어, 메모가 비어 있으면 메모로 보낸다.
  const memo = clean(event.memo, 80) || clean(event.title, 80);
  if (memo) body.memo = memo;
  return body;
}

// 서버와 맞추기 위해 할 일을 정한다.
//   links: { [기기 일정 id]: { serverId, signature, (rejected) } }  signature: 마지막으로 올린 내용, rejected: 서버가 거절한 내용
//          아직 한 번도 올리지 못했으면 serverId 가 null 이다
//   today: 'YYYY-MM-DD'. 새 일정은 오늘 이후 것만 올린다.
// 반환: { create: [{ id, body, signature }], update: [{ id, serverId, body, signature }], remove: [{ id, serverId }] }
export function planSync(events, links, today) {
  const plan = { create: [], update: [], remove: [] };
  const known = links || {};
  const ids = new Set();

  for (const event of events || []) {
    if (!event?.id) continue;
    ids.add(event.id);
    const body = toServerSchedule(event);
    if (!body) continue;
    const signature = signatureOf(body);
    const link = known[event.id];
    if (link?.rejected === signature) continue;          // 서버가 거절한 내용 그대로면 다시 보내지 않는다
    if (link?.serverId != null) {
      if (link.signature !== signature) plan.update.push({ id: event.id, serverId: link.serverId, body, signature });
      continue;
    }
    if (event.date >= today) plan.create.push({ id: event.id, body, signature });
  }

  for (const [id, link] of Object.entries(known)) {
    if (!ids.has(id) && link?.serverId != null) plan.remove.push({ id, serverId: link.serverId });
  }
  return plan;
}

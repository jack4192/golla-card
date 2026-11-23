// 기기의 일정을 서버(/api/schedules)에 올린다 (서버 모드 전용).
//
// 일정은 기기에 저장하는 것이 기준이고, 서버에는 그 사본을 맞춰 둔다. 백엔드가 일정을 AI 엔진에 넘기므로
// 여기서 올리면 결제 화면의 카드 배치가 일정을 반영한다.
//
//   - 일정을 저장·삭제할 때마다, 그리고 결제 화면을 열 때 한 번씩 맞춘다
//   - 실패해도 기기 저장은 그대로다. 올리지 못한 것은 다음 기회에 다시 올린다
//   - 어떤 기기 일정이 서버의 몇 번 일정인지는 SCHEDULE_LINKS_KEY 에 기억한다 (일정 내용은 넣지 않는다)
import * as Store from './demoStore';
import { SERVER_MODE, api } from './api';
import { planSync } from './scheduleSyncCore';

export const SCHEDULE_LINKS_KEY = 'solpay_schedule_server_links_v1';

let running = Promise.resolve();

async function readLinks() {
  try {
    const value = JSON.parse(await Store.getItemAsync(SCHEDULE_LINKS_KEY));
    return value?.version === 1 && value.links && typeof value.links === 'object' ? value.links : {};
  } catch {
    return {};
  }
}

const writeLinks = links => Store.setItemAsync(SCHEDULE_LINKS_KEY, JSON.stringify({ version: 1, links }));

// 서버가 내용을 거절한 것(400)만 '거절됨'으로 기억한다. 연결 실패·로그인 만료 등은 다음에 다시 시도한다.
const rejected = problem => problem?.status === 400;
const missing = problem => problem?.status === 404;

async function syncOnce(readEvents, today) {
  const links = await readLinks();
  const plan = planSync(await readEvents(), links, today);
  if (!plan.create.length && !plan.update.length && !plan.remove.length) return;

  for (const item of plan.remove) {
    try {
      await api.deleteSchedule(item.serverId);
      delete links[item.id];
    } catch (problem) {
      if (missing(problem)) delete links[item.id];        // 서버에 이미 없다
    }
  }

  const create = [...plan.create];
  for (const item of plan.update) {
    try {
      await api.updateSchedule(item.serverId, item.body);
      links[item.id] = { serverId: item.serverId, signature: item.signature };
    } catch (problem) {
      if (missing(problem)) {
        delete links[item.id];                            // 서버에서 사라졌으면 새로 올린다
        create.push(item);
      } else if (rejected(problem)) {
        links[item.id] = { ...links[item.id], rejected: item.signature };
      }
    }
  }

  for (const item of create) {
    try {
      const saved = await api.createSchedule(item.body);
      if (saved?.scheduleId != null) links[item.id] = { serverId: saved.scheduleId, signature: item.signature };
    } catch (problem) {
      if (rejected(problem)) links[item.id] = { serverId: null, rejected: item.signature };
    }
  }

  await writeLinks(links);
}

// 기기 일정과 서버 일정을 맞춘다. 앞선 작업이 끝난 뒤 차례로 실행하고, 실패해도 예외를 내지 않는다.
//   readEvents: 기기 일정을 읽는 함수 (routineData.readEvents), today: 'YYYY-MM-DD'
export function requestScheduleSync(readEvents, today) {
  if (!SERVER_MODE) return Promise.resolve();
  running = running
    .catch(() => {})
    .then(() => syncOnce(readEvents, today))
    .catch(problem => {
      console.warn('일정을 서버에 올리지 못했어요:', problem?.message);
    });
  return running;
}

// 진행 중인 올리기가 끝나기를 기다린다 (최대 limitMs). 결제 화면이 AI 에 순서를 묻기 전에 쓴다.
export function waitForScheduleSync(limitMs = 3000) {
  return Promise.race([
    running.catch(() => {}),
    new Promise(resolve => setTimeout(resolve, limitMs)),
  ]);
}

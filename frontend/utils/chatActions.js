// 챗봇 초안 카드의 버튼이 하는 일 (2026-11-24 챗봇 고도화 3단계). 서버 호출이 있어 순수 함수(chatBlocks.js)와 나눈다.
import { api } from './api';
import { withoutRules } from './chatBlocks';
import { saveEvent } from './routineData';

// '일정에 추가': 일정 화면과 같은 saveEvent 로 저장한다 (서버 저장 + 기기 목록, 검사도 같다)
export function addScheduleFromChat(input) {
  return saveEvent(input);
}

// '지우기': 지금 저장된 규칙을 다시 읽어 초안의 규칙만 빼고 통째로 저장한다
export async function deleteRulesFromChat(drafts) {
  const current = await api.aiRules();
  const keep = withoutRules(current, drafts);
  if (keep.length === (current || []).length) throw Error('이미 지워진 규칙이에요.');
  await api.aiSaveRules(keep);
}

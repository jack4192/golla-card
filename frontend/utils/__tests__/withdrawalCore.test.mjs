// 실행: node --test utils/__tests__/withdrawalCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { canSubmitWithdrawal, withdrawalCopy } from '../withdrawalCore.js';

test('서버 모드 탈퇴 안내는 서버에서 지운다고 말하고, 데모 모드는 이 기기만', () => {
  const server = withdrawalCopy(true);
  assert.match(server.confirm, /서버에서 모두 삭제/);
  assert.match(server.confirm, /되돌릴 수 없어요/);
  assert.equal(server.needsPassword, true);
  assert.match(server.done, /회원 탈퇴를 마쳤어요/);
  const demo = withdrawalCopy(false);
  assert.match(demo.confirm, /이 기기에 저장된/);
  assert.equal(demo.needsPassword, false);
});

test('확정 버튼: 서버 모드는 비밀번호를 넣어야, 처리 중에는 누를 수 없음', () => {
  assert.equal(canSubmitWithdrawal({ serverMode: true, password: '', busy: false }), false);
  assert.equal(canSubmitWithdrawal({ serverMode: true, password: '   ', busy: false }), false);
  assert.equal(canSubmitWithdrawal({ serverMode: true, password: 'pw', busy: false }), true);
  assert.equal(canSubmitWithdrawal({ serverMode: true, password: 'pw', busy: true }), false);
  assert.equal(canSubmitWithdrawal({ serverMode: false, password: '', busy: false }), true);
  // 서버에서 이미 지웠으면(기기 정리만 남음) 비밀번호 없이 다시 시도할 수 있다
  assert.equal(canSubmitWithdrawal({ serverMode: true, password: '', busy: false, serverDone: true }), true);
});

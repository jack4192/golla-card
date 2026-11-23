// 회원가입 때 고른 '직장'을 기억했다가, 그 이메일로 처음 로그인하면 일과 질문의 직업 답으로 채워 넣습니다.
// (서버 모드에서는 로그인 시 이전 계정 데이터를 지우므로 가입 시점이 아니라 로그인 직후에 반영합니다.)
import * as Store from './demoStore';
import { readProfile, saveOccupation } from './routineData';
import { JOB_OPTIONS } from '../screens/SignUpScreen';

const PENDING_JOB_KEY = 'solpay_signup_job_v1';

export async function rememberSignupJob(email, job, jobOther = '') {
  if (!JOB_OPTIONS.some(option => option.value === job)) return;
  await Store.setItemAsync(PENDING_JOB_KEY, JSON.stringify({ email, job, jobOther }));
}

/** 가입한 이메일로 로그인했을 때 한 번만 직업 답을 채웁니다. 이미 답이 있으면 덮어쓰지 않습니다. */
export async function applySignupJob(email) {
  try {
    const raw = await Store.getItemAsync(PENDING_JOB_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw);
    if (pending?.email !== email) return;
    const occupation = JOB_OPTIONS.find(option => option.value === pending.job)?.occupation;
    const profile = await readProfile();
    if (occupation && !profile.occupation) {
      await saveOccupation(occupation, { job: pending.job, jobOther: pending.jobOther || '' });
    }
    await Store.deleteItemAsync(PENDING_JOB_KEY);
  } catch {
    // 직업 답을 못 채워도 로그인은 계속합니다(일과 질문에서 직접 고를 수 있음).
  }
}

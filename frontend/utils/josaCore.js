// 카드 이름 뒤 조사를 끝소리에 맞게 고른다 (2026-11-25 팀 결정 '이름에 맞게 자동', PR #13 보완).
// 한글은 받침, 영어 단어는 끝 글자 소리(Plan→플랜, PET→펫, Oil→오일), 영어 한 글자는 글자 이름(P→피),
// 숫자는 읽는 소리(3→삼), '+'는 플러스, 끝의 괄호·따옴표는 떼고 그 앞 글자로 본다.
// (챗봇 추천 질문의 utils/homeChat.js withJosa 는 영어면 '(으)로'처럼 둘 다 적는다 — 그쪽은 그대로 둔다)

// 조사: [받침 없을 때, 받침 있을 때]
const PAIRS = {
  와: ['와', '과'], 과: ['와', '과'],
  로: ['로', '으로'], 으로: ['로', '으로'],
  가: ['가', '이'], 이: ['가', '이'],
  는: ['는', '은'], 은: ['는', '은'],
  를: ['를', '을'], 을: ['를', '을'],
};
const NONE = 'none';
const RIEUL = 'rieul';   // ㄹ 받침: '로'는 받침 없을 때처럼
const OTHER = 'other';

const WORD_ENDINGS = { l: RIEUL, n: OTHER, m: OTHER, k: OTHER, p: OTHER, t: OTHER, b: OTHER, d: OTHER, g: OTHER };
const LETTER_NAMES = { L: RIEUL, R: RIEUL, M: OTHER, N: OTHER };   // 엘·알·엠·엔
const DIGITS = { 0: OTHER, 1: RIEUL, 3: OTHER, 6: OTHER, 7: RIEUL, 8: RIEUL };   // 영·일·삼·육·칠·팔

function finalSound(word) {
  const text = String(word || '').replace(/[\s)\]}'"·.,!?-]+$/u, '');
  if (!text) return null;
  if (text.endsWith('+')) return NONE;   // 플러스
  const last = text[text.length - 1];
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const batchim = (code - 0xac00) % 28;
    return batchim === 0 ? NONE : batchim === 8 ? RIEUL : OTHER;
  }
  if (/[0-9]/.test(last)) return DIGITS[last] || NONE;
  const latin = text.match(/[A-Za-z]+$/);
  if (latin) {
    const run = latin[0];
    if (run.length === 1) return LETTER_NAMES[run.toUpperCase()] || NONE;
    return WORD_ENDINGS[run[run.length - 1].toLowerCase()] || NONE;
  }
  return NONE;
}

export function withParticle(word, particle) {
  const name = String(word || '');
  if (!name) return '';
  const [plain, final] = PAIRS[particle] || [particle, particle];
  const sound = finalSound(name);
  const usePlain = sound === NONE || (plain === '로' && sound === RIEUL);
  return name + (usePlain ? plain : final);
}

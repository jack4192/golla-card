// 홈 챗봇(SOL 카드 도우미)의 추천 질문과 AI 챗봇에 보낼 이전 대화 (순수 함수).
//
// 추천 질문은 AI 챗봇 평가 질문(solpay-ai/evaluation/chat_eval.py)에서 골라 탭마다 8개 안팎으로 묶었다 (2026-11-23 결정).
// 평가 질문의 카드 이름(데모 1번 기준)은 사용자의 실제 카드 이름으로 바꿔 넣는다.
// 테스트: node --test utils/__tests__/homeChat.test.mjs

const PAIRS = { 로: ['로', '으로'], 으로: ['로', '으로'], 는: ['는', '은'], 은: ['는', '은'], 가: ['가', '이'], 이: ['가', '이'] };

// '카드' + 로 → '카드로', '통장' + 로 → '통장으로'. 영어·숫자로 끝나 받침을 알 수 없으면 '(으)로', '은(는)'처럼 둘 다 적는다.
export function withJosa(name, particle) {
  const [plain, final] = PAIRS[particle] || [particle, particle];
  const letters = String(name || '').replace(/[\s)\]}'"·.,!?-]+$/u, '');
  const last = letters.charCodeAt(letters.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    const batchim = (last - 0xac00) % 28;
    const usePlain = batchim === 0 || (plain === '로' && batchim === 8);   // ㄹ 받침 뒤에는 '로'
    return name + (usePlain ? plain : final);
  }
  return name + (plain === '로' ? '(으)로' : `${final}(${plain})`);
}

// 탭별 추천 질문. a = 첫 번째 카드, b = 두 번째 카드 (없으면 그 질문은 뺀다)
const BY_TAB = {
  home: [
    () => '지금 결제하기 좋은 카드 알려줘',
    () => '왜 이 카드가 1순위야?',
    () => '내 소비에 맞는 카드 찾아줘',
    () => '진행 중인 프로모션 알려줘',
    () => '이번 달 실적 얼마 남았어?',
    (a, b) => b && `${withJosa(b, '로')} 내면 얼마 손해야?`,
    () => '스타벅스에서 6천 원 결제할 건데 뭐 써?',
    () => '올해 카드로 얼마 아꼈는지 어디서 봐?',
  ],
  schedule: [
    () => '일정은 어떻게 추가해?',
    () => '지금 결제하기 좋은 카드 알려줘',
    () => '장소 일정은 카드 순서에 어떻게 반영돼?',
    () => '편의점에서 5000원 쓸 건데 어떤 카드가 좋아?',
    () => '이마트에서 8만 원 장 볼 건데 어떤 카드가 좋아?',
    a => a && `주말엔 ${a} 먼저 보여줘`,
    a => a && `평일 12시부터 2시까지는 ${a} 먼저 보여줘`,
    () => '결제 카드 바꾸는 법 알려줘',
  ],
  benefits: [
    () => '진행 중인 프로모션 알려줘',
    () => '스타벅스에서 하는 이벤트 있어?',
    () => '혜택은 어디서 봐?',
    a => a && `${a} 혜택 알려줘`,
    () => '이번 달에 받은 혜택 카드별로 알려줘',
    () => '올리브영에서 3만 원 결제하면 어떤 카드가 유리해?',
    () => 'CU에서 4500원 결제할 때 제일 좋은 카드는?',
    () => '신한카드 Simple Plan+는 어떤 혜택이 있어?',
  ],
  cards: [
    () => '이번 달 실적 얼마 남았어?',
    () => '카드 등록은 어떻게 해?',
    a => a && `${a} 혜택 알려줘`,
    a => a && `${a} 지난달 실적 얼마였어?`,
    a => a && `${withJosa(a, '는')} 전월 실적 얼마부터 혜택을 받아?`,
    () => '신한카드 중에 나한테 제일 이득인 카드 추천해줘',
    (a, b) => b && `${withJosa(b, '는')} 실적 안 채워도 돼`,
    () => '실적은 첫 구간부터 채우는 방식으로 바꿔줘',
  ],
};

export function suggestionsFor(tab, cards) {
  const [a, b] = (Array.isArray(cards) ? cards : []).map(card => card?.name).filter(Boolean);
  const list = (BY_TAB[tab] || BY_TAB.home).map(make => make(a, b)).filter(Boolean);
  return [...new Set(list)];
}

// 챗봇 메시지 [{ role: 'user' | 'bot', text, greeting?, pending?, offline? }] → AI 에 보낼 이전 대화.
// 질문과 답이 짝을 이룬 것만, 최근 turns 쌍까지. 인사말, 준비 중인 답, AI 대신 기본 안내로 답한 것은 뺀다.
export function toChatHistory(messages, turns = 4) {
  const pairs = [];
  const list = Array.isArray(messages) ? messages : [];
  for (let i = 0; i + 1 < list.length; i += 1) {
    const question = list[i];
    const answer = list[i + 1];
    if (question?.role !== 'user' || answer?.role !== 'bot') continue;
    if (answer.pending || answer.offline || answer.greeting || !question.text || !answer.text) continue;
    pairs.push([{ role: 'user', text: question.text }, { role: 'assistant', text: answer.text }]);
  }
  return pairs.slice(-turns).flat();
}

const PREFIX = 'solpay_public_demo_';

// 웹 저장소: 로그인·동의 등을 localStorage 에 둔다 (2026-11-25, 팀 결정 '닫아도 로그인 유지').
//   전에는 sessionStorage 라 탭이나 바탕화면 웹앱을 닫으면 로그인이 지워졌다. 로그아웃하면 지운다.
//   localStorage 를 쓸 수 없는 브라우저(사생활 보호 모드 등)는 sessionStorage 로 대신한다.
function storage() {
  if (typeof window === 'undefined') {
    throw new Error('이 브라우저에 정보를 저장할 수 없어요.');
  }
  try {
    if (window.localStorage) return window.localStorage;
  } catch {
    // localStorage 접근이 막힌 경우 아래로
  }
  if (window.sessionStorage) return window.sessionStorage;
  throw new Error('이 브라우저에 정보를 저장할 수 없어요.');
}

export async function getItemAsync(key) {
  try {
    return storage().getItem(PREFIX + key);
  } catch {
    throw new Error(
      '저장된 정보를 읽지 못했습니다. 브라우저 저장소 설정을 확인해주세요.'
    );
  }
}

export async function setItemAsync(key, value) {
  try {
    storage().setItem(PREFIX + key, String(value));
  } catch {
    throw new Error(
      '정보를 저장하지 못했습니다. 브라우저 저장소 설정을 확인해주세요.'
    );
  }
}

export async function deleteItemAsync(key) {
  try {
    storage().removeItem(PREFIX + key);
  } catch {
    throw new Error(
      '정보를 삭제하지 못했습니다. 브라우저 저장소 설정을 확인해주세요.'
    );
  }
}
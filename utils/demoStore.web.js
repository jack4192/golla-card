const PREFIX = 'solpay_public_demo_';

function storage() {
  if (
    typeof window === 'undefined' ||
    !window.sessionStorage
  ) {
    throw new Error('이 브라우저에 정보를 저장할 수 없어요.');
  }

  return window.sessionStorage;
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
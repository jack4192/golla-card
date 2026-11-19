"""저장 데이터 암호화 (봉투 암호화).

하루 일정처럼 민감한 값은 데이터베이스에 암호문으로만 저장한다.
- 데이터 키: 실제 암호화에 쓰는 대칭 키 (Fernet: AES-128-CBC + HMAC-SHA256).
- 운영: 데이터 키를 클라우드 키 관리 서비스(KMS)로 암호화해 둔 값(SOLPAY_DATA_KEY_ENCRYPTED)만 설정에 두고,
  서버가 시작할 때 KMS(SOLPAY_KMS_KEY_ID)로 풀어 메모리에만 둔다. 마스터 키는 KMS 밖으로 나오지 않는다.
- 로컬 개발: SOLPAY_DATA_KEY 에 데이터 키를 직접 넣는다 (.env, 깃에 올리지 않음).
키가 없으면 민감한 값을 저장하지 않고 오류를 낸다 (평문 저장으로 조용히 넘어가지 않는다).

    키 만들기: uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

import base64
import json
import os

from cryptography.fernet import Fernet, InvalidToken


class MissingKey(RuntimeError):
    pass


class DataCipher:
    def __init__(self, key: bytes):
        self._fernet = Fernet(key)

    def encrypt(self, value: dict) -> bytes:
        return self._fernet.encrypt(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())

    def decrypt(self, token: bytes) -> dict:
        try:
            return json.loads(self._fernet.decrypt(bytes(token)))
        except InvalidToken as e:
            raise ValueError("암호문을 풀 수 없습니다 (키가 다르거나 값이 바뀌었습니다)") from e


def _kms_data_key() -> bytes | None:
    encrypted, key_id = os.environ.get("SOLPAY_DATA_KEY_ENCRYPTED"), os.environ.get("SOLPAY_KMS_KEY_ID")
    if not encrypted or not key_id:
        return None
    import boto3                       # 운영에서만 필요하다
    plain = boto3.client("kms").decrypt(CiphertextBlob=base64.b64decode(encrypted), KeyId=key_id)["Plaintext"]
    return base64.urlsafe_b64encode(plain[:32])


def load_cipher() -> DataCipher:
    key = _kms_data_key() or (os.environ.get("SOLPAY_DATA_KEY") or "").encode() or None
    if not key:
        raise MissingKey("데이터 암호화 키가 없습니다. SOLPAY_DATA_KEY (로컬) 또는 KMS 설정 (운영)을 넣어 주세요.")
    return DataCipher(key)

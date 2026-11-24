"""가상 POS 단말기 키 (가맹점 번호 → 단말기 키 원문).

SOL·Pay 백엔드는 단말기 키의 SHA-256 만 DB(terminals.key_hash)에 두고, 원문은 어디에도 저장하지 않는다.
가상 데이터의 단말기 660개도 원문을 버렸으므로, 시연하려면 키를 아는 단말기를 하나 새로 넣어야 한다.

    cd demo && python -m app.terminals 560

을 실행하면 새 키를 만들어 demo/data/terminal_keys.json (git 에 안 올라감)에 저장하고, DB 에 넣을 SQL 을 보여 준다.
SQL 을 DB 에 실행하면 가상 POS 가 바로 그 가맹점으로 승인을 보낸다 (POS 서버를 다시 켤 필요 없음).
환경 변수 SOLPAY_FIXED_TERMINAL_KEYS(JSON) 가 있으면 파일보다 먼저 쓴다.
"""
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path

KEYS_FILE = Path(__file__).resolve().parent.parent / "data" / "terminal_keys.json"
ENV = "SOLPAY_FIXED_TERMINAL_KEYS"


class KeysError(ValueError):
    """단말기 키 설정이 JSON 객체({"가맹점 번호": "키"})가 아니다."""


def load_keys() -> dict[str, str]:
    """환경 변수 → 파일 순서로 읽는다. 둘 다 없으면 빈 dict (예전처럼 데모 서버가 발급한 코드만 승인)."""
    raw, source = os.environ.get(ENV, "").strip(), ENV
    if not raw and KEYS_FILE.exists():
        raw, source = KEYS_FILE.read_text(encoding="utf-8").strip(), str(KEYS_FILE)
    if not raw:
        return {}
    try:
        keys = json.loads(raw)
    except ValueError:
        raise KeysError(f"{source} 의 단말기 키가 JSON 형식이 아닙니다.") from None
    if not isinstance(keys, dict) or not all(isinstance(v, str) and v for v in keys.values()):
        raise KeysError(f'{source} 의 단말기 키는 {{"가맹점 번호": "키"}} 형식이어야 합니다.')
    return {str(k): v for k, v in keys.items()}


def terminal_sql(merchant_id: int, key_hash: str) -> str:
    """단말기 1개를 넣는 SQL. 번호는 자동 번호(identity)에 맡기되, CSV 로 채운 뒤 자동 번호가 뒤처져 있을 수 있어 먼저 맞춘다."""
    return (f"-- 가상 POS 시연용 단말기 (가맹점 {merchant_id}). 키 원문은 DB 에 넣지 않는다.\n"
            "SELECT setval(pg_get_serial_sequence('public.terminals', 'terminal_id'), "
            "(SELECT MAX(terminal_id) FROM public.terminals));\n"
            f"INSERT INTO public.terminals (merchant_id, key_hash) VALUES ({int(merchant_id)}, '{key_hash}') "
            "RETURNING terminal_id;\n")


def new_terminal(merchant_id: int, path: Path | None = None) -> tuple[str, str]:
    """새 키를 만들어 파일에 저장(같은 가맹점이면 바꿈)하고 (키, SQL) 을 돌려준다."""
    path = path or KEYS_FILE
    key = secrets.token_hex(16)
    keys = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    keys[str(int(merchant_id))] = key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(keys, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600)
    return key, terminal_sql(merchant_id, hashlib.sha256(key.encode()).hexdigest())


def main(argv: list[str]) -> int:
    if len(argv) != 1 or not argv[0].isdigit():
        print("사용: python -m app.terminals <가맹점 번호>   (예: 560 = 스타벅스 강남역점)")
        return 2
    _, sql = new_terminal(int(argv[0]))
    print(f"단말기 키를 {KEYS_FILE} 에 저장했습니다 (git 에 올라가지 않음).\n")
    print("아래 SQL 을 DB 에 실행하세요 (로컬: docker exec -i solpay-db psql ..., 공용 RDS: 마스터 계정):\n")
    print(sql)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

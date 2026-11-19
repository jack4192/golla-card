"""시연용 SQLite 전략 저장소. 운영 연동에서는 Spring의 DB 저장 경로를 사용한다."""
import sqlite3
import json
from pathlib import Path
from engine.params import SELECTABLE, STRATEGIES


class StrategyStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS strategy (user_id INTEGER PRIMARY KEY, strategy TEXT NOT NULL, source TEXT NOT NULL, metadata TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')

    def get(self, user_id):
        with sqlite3.connect(self.path) as db:
            row = db.execute('SELECT strategy,source,updated_at,metadata FROM strategy WHERE user_id=?',(user_id,)).fetchone()
        return {'strategy':row[0], 'source':row[1], 'updated_at':row[2], 'metadata':json.loads(row[3]) if row[3] else None} if row else None

    @staticmethod
    def _validate(strategy, allowed=STRATEGIES):
        if strategy not in allowed:
            raise ValueError('유효하지 않은 방식입니다')

    def initialize(self,user_id,strategy,metadata=None):
        self._validate(strategy)
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO strategy(user_id,strategy,source,metadata) VALUES(?,?,'initial',?) ON CONFLICT(user_id) DO NOTHING",(user_id,strategy,json.dumps(metadata,ensure_ascii=False) if metadata else None))
        return self.get(user_id)

    def confirm_change(self,user_id,strategy):
        self._validate(strategy, SELECTABLE)
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO strategy(user_id,strategy,source) VALUES(?,?,'confirmed') ON CONFLICT(user_id) DO UPDATE SET strategy=excluded.strategy,source=excluded.source,metadata=NULL,updated_at=CURRENT_TIMESTAMP",(user_id,strategy))
        return self.get(user_id)

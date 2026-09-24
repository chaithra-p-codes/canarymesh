"""
CanaryMesh — Database 
SQLite async audit log for all alerts and operator decisions.
"""
import aiosqlite
from datetime import datetime

DB_PATH = "canarymesh.db"


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id        TEXT PRIMARY KEY,
                node_id   TEXT,
                node_name TEXT,
                severity  TEXT,
                reason    TEXT,
                timestamp TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS decisions (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id   TEXT,
                action    TEXT,
                operator  TEXT,
                reason    TEXT,
                timestamp TEXT
            )
        """)
        await db.commit()


async def log_alert(alert: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO alerts VALUES (?,?,?,?,?,?)",
            (alert.get("id", ""), alert.get("nodeId", ""), alert.get("node", ""),
             alert.get("severity", ""), alert.get("reason", ""),
             alert.get("time", datetime.utcnow().strftime("%H:%M:%S")))
        )
        await db.commit()


async def log_decision(decision: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO decisions (node_id,action,operator,reason,timestamp) VALUES (?,?,?,?,?)",
            (decision.get("node_id", ""), decision.get("action", ""),
             decision.get("operator", "operator"), decision.get("reason", ""),
             decision.get("timestamp", datetime.utcnow().isoformat()))
        )
        await db.commit()


async def get_recent_alerts(limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?", (limit,)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def get_decisions(limit: int = 100) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM decisions ORDER BY timestamp DESC LIMIT ?", (limit,)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

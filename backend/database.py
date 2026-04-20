"""
肺结节检测后端 - 数据库模块
使用 SQLite 存储检测历史
"""

import sqlite3
import threading
from typing import List, Optional, Dict, Any


class Record:
    """检测记录"""
    def __init__(self, id: int, image_path: str, detection_time: str,
                 nodule_count: int, result_json: str, image_data: str = None,
                 batch_id: int = None):
        self.id = id
        self.image_path = image_path
        self.detection_time = detection_time
        self.nodule_count = nodule_count
        self.result_json = result_json
        self.image_data = image_data  # Base64 编码的图片
        self.batch_id = batch_id

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "image_path": self.image_path,
            "detection_time": self.detection_time,
            "nodule_count": self.nodule_count,
            "result_json": self.result_json,
            "image_data": self.image_data,
            "batch_id": self.batch_id
        }


class Database:
    """SQLite 数据库操作"""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _get_conn(self):
        """获取线程本地连接"""
        return sqlite3.connect(self.db_path, check_same_thread=False)

    def _init_db(self):
        """初始化数据库"""
        conn = self._get_conn()
        cursor = conn.execute("PRAGMA table_info(records)")
        columns = [row[1] for row in cursor.fetchall()]

        sql = """
        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_path TEXT NOT NULL,
            detection_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            nodule_count INTEGER DEFAULT 0,
            result_json TEXT,
            image_data TEXT,
            batch_id INTEGER DEFAULT 0
        );
        """
        conn.execute(sql)
        conn.commit()

        # Re-check columns after CREATE TABLE
        cursor = conn.execute("PRAGMA table_info(records)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'image_data' not in columns:
            conn.execute("ALTER TABLE records ADD COLUMN image_data TEXT")
        if 'batch_id' not in columns:
            conn.execute("ALTER TABLE records ADD COLUMN batch_id INTEGER DEFAULT 0")

        conn.commit()
        conn.close()

    def get_next_batch_id(self) -> int:
        """获取下一个批次ID"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.execute("SELECT MAX(batch_id) FROM records")
            max_id = cursor.fetchone()[0]
            conn.close()
            return (max_id or 0) + 1

    def insert(self, image_path: str, nodule_count: int, result_json: str,
               image_data: str = None, batch_id: int = None) -> int:
        """插入记录"""
        with self._lock:
            conn = self._get_conn()
            from datetime import datetime
            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            sql = """
            INSERT INTO records (image_path, nodule_count, result_json, image_data, detection_time, batch_id)
            VALUES (?, ?, ?, ?, ?, ?);
            """
            cursor = conn.execute(sql, (image_path, nodule_count, result_json, image_data, now, batch_id))
            conn.commit()
            record_id = cursor.lastrowid
            conn.close()
            return record_id

    def insert_batch(self, records: List[Dict], batch_id: int) -> List[int]:
        """批量插入记录"""
        with self._lock:
            conn = self._get_conn()
            from datetime import datetime
            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            sql = """
            INSERT INTO records (image_path, nodule_count, result_json, image_data, detection_time, batch_id)
            VALUES (?, ?, ?, ?, ?, ?);
            """
            record_ids = []
            for record in records:
                cursor = conn.execute(sql, (
                    record['image_path'],
                    record['nodule_count'],
                    record['result_json'],
                    record['image_data'],
                    now,
                    batch_id
                ))
                record_ids.append(cursor.lastrowid)
            conn.commit()
            conn.close()
            return record_ids

    def get_all(self) -> List[Record]:
        """获取所有记录"""
        with self._lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            sql = """
            SELECT id, image_path, detection_time, nodule_count, result_json, image_data, batch_id
            FROM records ORDER BY detection_time DESC;
            """
            rows = conn.execute(sql).fetchall()
            records = [Record(row[0], row[1], row[2], row[3], row[4],
                             row[5] if len(row) > 5 else None,
                             row[6] if len(row) > 6 else None) for row in rows]
            conn.close()
            return records

    def get(self, id: int) -> Optional[Record]:
        """获取单条记录"""
        with self._lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            sql = """
            SELECT id, image_path, detection_time, nodule_count, result_json, image_data, batch_id
            FROM records WHERE id = ?;
            """
            row = conn.execute(sql, (id,)).fetchone()
            conn.close()
            if row:
                return Record(row[0], row[1], row[2], row[3], row[4],
                             row[5] if len(row) > 5 else None,
                             row[6] if len(row) > 6 else None)
            return None

    def delete(self, id: int) -> bool:
        """删除记录"""
        with self._lock:
            conn = self._get_conn()
            sql = "DELETE FROM records WHERE id = ?;"
            cursor = conn.execute(sql, (id,))
            conn.commit()
            count = cursor.rowcount
            conn.close()
            return count > 0

    def delete_all(self) -> bool:
        """删除所有记录"""
        with self._lock:
            conn = self._get_conn()
            conn.execute("DELETE FROM records")
            conn.commit()
            conn.close()
            return True

    def count(self) -> int:
        """获取记录数量"""
        with self._lock:
            conn = self._get_conn()
            sql = "SELECT COUNT(*) FROM records;"
            count = conn.execute(sql).fetchone()[0]
            conn.close()
            return count

    def close(self):
        """关闭连接"""
        pass

# app/core/task_queue.py
"""
Lightweight SQLite-based task queue system (Redis Queue replacement).
Supports background job processing with retry logic and status tracking.
"""

import sqlite3
import json
import uuid
import time
import logging
import threading
from datetime import datetime
from enum import Enum
from typing import Callable, Any, Optional, Dict
from app.config import active_config

logger = logging.getLogger(__name__)


class TaskStatus(Enum):
    """Task status enumeration."""
    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class TaskQueue:
    """
    SQLite-based task queue for background job processing.
    Thread-safe implementation for async task execution.
    """

    def __init__(self, db_path=None):
        """
        Initialize task queue.

        Args:
            db_path (str): Path to SQLite database file
        """
        self.db_path = db_path or active_config.TASK_DB_PATH
        self._local = threading.local()
        self._lock = threading.Lock()
        self._init_db()

    def _get_conn(self):
        """Get thread-local database connection."""
        if not hasattr(self._local, 'conn'):
            self._local.conn = sqlite3.connect(
                self.db_path,
                check_same_thread=False,
                timeout=30.0
            )
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn

    def _init_db(self):
        """Initialize database schema."""
        conn = self._get_conn()
        cursor = conn.cursor()

        # Create tasks table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                func_name TEXT NOT NULL,
                args TEXT NOT NULL,
                kwargs TEXT NOT NULL,
                status TEXT NOT NULL,
                result TEXT,
                error TEXT,
                retries INTEGER DEFAULT 0,
                max_retries INTEGER DEFAULT 3,
                created_at REAL NOT NULL,
                started_at REAL,
                completed_at REAL
            )
        ''')

        # Create index on status for faster queries
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_status
            ON tasks(status)
        ''')

        # Create index on created_at for ordering
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_created_at
            ON tasks(created_at)
        ''')

        conn.commit()
        logger.info(f"Task queue initialized with database: {self.db_path}")

    def enqueue(self, func: Callable, *args, **kwargs) -> str:
        """
        Add a task to the queue.

        Args:
            func: Function to execute
            *args: Positional arguments for the function
            **kwargs: Keyword arguments for the function

        Returns:
            str: Task ID
        """
        task_id = str(uuid.uuid4())
        func_name = f"{func.__module__}.{func.__name__}"

        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO tasks (
                task_id, func_name, args, kwargs, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            task_id,
            func_name,
            json.dumps(args),
            json.dumps(kwargs),
            TaskStatus.QUEUED.value,
            time.time()
        ))

        conn.commit()
        logger.info(f"Task {task_id} enqueued: {func_name}")

        return task_id

    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Get status of a task.

        Args:
            task_id: Task ID

        Returns:
            dict: Task status info or None if not found
        """
        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT * FROM tasks WHERE task_id = ?
        ''', (task_id,))

        row = cursor.fetchone()
        if not row:
            return None

        result = dict(row)

        # Parse JSON fields
        if result.get('result'):
            try:
                result['result'] = json.loads(result['result'])
            except json.JSONDecodeError:
                pass

        return result

    def update_task_status(self, task_id: str, status: TaskStatus,
                          result: Any = None, error: str = None):
        """
        Update task status.

        Args:
            task_id: Task ID
            status: New status
            result: Task result (if completed)
            error: Error message (if failed)
        """
        conn = self._get_conn()
        cursor = conn.cursor()

        update_fields = {
            'status': status.value
        }

        if status == TaskStatus.PROCESSING:
            update_fields['started_at'] = time.time()

        if status in [TaskStatus.DONE, TaskStatus.FAILED]:
            update_fields['completed_at'] = time.time()

            if result is not None:
                update_fields['result'] = json.dumps(result)

            if error is not None:
                update_fields['error'] = error

        # Build dynamic UPDATE query
        set_clause = ', '.join([f"{k} = ?" for k in update_fields.keys()])
        values = list(update_fields.values())
        values.append(task_id)

        cursor.execute(f'''
            UPDATE tasks SET {set_clause} WHERE task_id = ?
        ''', values)

        conn.commit()

    def get_next_task(self) -> Optional[Dict[str, Any]]:
        """
        Get next queued task.

        Returns:
            dict: Task info or None if queue is empty
        """
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            # Get oldest queued task
            cursor.execute('''
                SELECT * FROM tasks
                WHERE status = ?
                ORDER BY created_at ASC
                LIMIT 1
            ''', (TaskStatus.QUEUED.value,))

            row = cursor.fetchone()
            if not row:
                return None

            task = dict(row)

            # Mark as processing
            cursor.execute('''
                UPDATE tasks
                SET status = ?, started_at = ?
                WHERE task_id = ?
            ''', (
                TaskStatus.PROCESSING.value,
                time.time(),
                task['task_id']
            ))

            conn.commit()

            # Parse JSON fields
            task['args'] = json.loads(task['args'])
            task['kwargs'] = json.loads(task['kwargs'])

            return task

    def increment_retry(self, task_id: str) -> int:
        """
        Increment retry count for a task.

        Args:
            task_id: Task ID

        Returns:
            int: New retry count
        """
        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute('''
            UPDATE tasks
            SET retries = retries + 1, status = ?
            WHERE task_id = ?
        ''', (TaskStatus.QUEUED.value, task_id))

        cursor.execute('''
            SELECT retries FROM tasks WHERE task_id = ?
        ''', (task_id,))

        row = cursor.fetchone()
        conn.commit()

        return row['retries'] if row else 0

    def cleanup_old_tasks(self, days=7):
        """
        Remove completed/failed tasks older than specified days.

        Args:
            days: Number of days to keep
        """
        cutoff_time = time.time() - (days * 24 * 60 * 60)

        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute('''
            DELETE FROM tasks
            WHERE status IN (?, ?)
            AND completed_at < ?
        ''', (TaskStatus.DONE.value, TaskStatus.FAILED.value, cutoff_time))

        deleted_count = cursor.rowcount
        conn.commit()

        logger.info(f"Cleaned up {deleted_count} old tasks")

    def get_queue_stats(self) -> Dict[str, int]:
        """
        Get queue statistics.

        Returns:
            dict: Queue stats
        """
        conn = self._get_conn()
        cursor = conn.cursor()

        stats = {}

        for status in TaskStatus:
            cursor.execute('''
                SELECT COUNT(*) as count FROM tasks WHERE status = ?
            ''', (status.value,))

            row = cursor.fetchone()
            stats[status.value] = row['count']

        return stats


# Global task queue instance
task_queue = TaskQueue()


# Registry of task functions
TASK_REGISTRY: Dict[str, Callable] = {}


def register_task(func: Callable) -> Callable:
    """
    Decorator to register a function as a task.

    Example:
        @register_task
        def my_background_task(arg1, arg2):
            # do work
            return result
    """
    task_name = f"{func.__module__}.{func.__name__}"
    TASK_REGISTRY[task_name] = func
    logger.info(f"Registered task: {task_name}")
    return func


def enqueue_task(func: Callable, *args, **kwargs) -> str:
    """
    Enqueue a task for background processing.

    Args:
        func: Function to execute
        *args: Positional arguments
        **kwargs: Keyword arguments

    Returns:
        str: Task ID
    """
    return task_queue.enqueue(func, *args, **kwargs)


def get_task_result(task_id: str) -> Optional[Dict[str, Any]]:
    """
    Get task result by ID.

    Args:
        task_id: Task ID

    Returns:
        dict: Task info including result/status
    """
    return task_queue.get_task_status(task_id)

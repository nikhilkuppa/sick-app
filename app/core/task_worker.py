# app/core/task_worker.py
"""
Background task worker for processing tasks from the queue.
Replaces RQ (Redis Queue) worker functionality.
"""

import time
import logging
import signal
import sys
from typing import Optional
from app.core.task_queue import (
    task_queue,
    TaskStatus,
    TASK_REGISTRY
)
from app.config import active_config

logger = logging.getLogger(__name__)


class TaskWorker:
    """
    Worker that processes tasks from the queue.
    """

    def __init__(self, concurrency=1):
        """
        Initialize worker.

        Args:
            concurrency (int): Number of concurrent workers (for future enhancement)
        """
        self.concurrency = concurrency
        self.running = False
        self.processed_count = 0
        self.failed_count = 0

    def _execute_task(self, task):
        """
        Execute a single task.

        Args:
            task (dict): Task info

        Returns:
            any: Task result
        """
        func_name = task['func_name']

        # Get function from registry
        if func_name not in TASK_REGISTRY:
            raise ValueError(f"Task function not registered: {func_name}")

        func = TASK_REGISTRY[func_name]

        # Execute function with args/kwargs
        result = func(*task['args'], **task['kwargs'])

        return result

    def process_task(self, task):
        """
        Process a single task with retry logic.

        Args:
            task (dict): Task info
        """
        task_id = task['task_id']
        max_retries = task.get('max_retries', active_config.MAX_RETRIES)

        try:
            logger.info(f"Processing task {task_id}: {task['func_name']}")

            # Execute task
            result = self._execute_task(task)

            # Mark as completed
            task_queue.update_task_status(
                task_id,
                TaskStatus.DONE,
                result=result
            )

            self.processed_count += 1
            logger.info(f"Task {task_id} completed successfully")

        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            logger.error(f"Task {task_id} failed: {error_msg}")

            # Check if we should retry
            retry_count = task_queue.increment_retry(task_id)

            if retry_count < max_retries:
                logger.info(f"Task {task_id} will be retried (attempt {retry_count + 1}/{max_retries})")
            else:
                # Max retries reached, mark as failed
                task_queue.update_task_status(
                    task_id,
                    TaskStatus.FAILED,
                    error=error_msg
                )
                self.failed_count += 1
                logger.error(f"Task {task_id} failed permanently after {max_retries} retries")

    def run(self, poll_interval=2):
        """
        Start the worker loop.

        Args:
            poll_interval (int): Seconds to wait between polls
        """
        self.running = True

        logger.info(f"Worker started (poll interval: {poll_interval}s)")

        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

        while self.running:
            try:
                # Get next task from queue
                task = task_queue.get_next_task()

                if task:
                    # Process task
                    self.process_task(task)
                else:
                    # No tasks, wait before polling again
                    time.sleep(poll_interval)

            except Exception as e:
                logger.error(f"Worker error: {str(e)}", exc_info=True)
                time.sleep(poll_interval)

        logger.info(f"Worker stopped. Processed: {self.processed_count}, Failed: {self.failed_count}")

    def _signal_handler(self, signum, frame):
        """Handle shutdown signals gracefully."""
        logger.info(f"Received signal {signum}, shutting down worker...")
        self.running = False

    def get_stats(self):
        """
        Get worker statistics.

        Returns:
            dict: Worker stats
        """
        queue_stats = task_queue.get_queue_stats()

        return {
            "processed": self.processed_count,
            "failed": self.failed_count,
            "queue": queue_stats,
            "running": self.running
        }


def start_worker(concurrency=None):
    """
    Start the task worker.

    Args:
        concurrency (int): Number of concurrent workers
    """
    if concurrency is None:
        concurrency = active_config.WORKER_CONCURRENCY

    worker = TaskWorker(concurrency=concurrency)
    worker.run()


if __name__ == "__main__":
    # Run worker directly
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    start_worker()

# worker_run.py
"""
Background worker launcher for processing tasks from the queue.
Replaces Redis Queue (RQ) worker with lightweight SQLite-based task queue.
"""

import os
import sys
import logging
import argparse
from app.core.task_worker import start_worker
from app.config import active_config

# Import tasks to register them
from app.workers import tasks

# Configure logging
logging.basicConfig(
    level=active_config.LOG_LEVEL or logging.INFO,
    format='[%(asctime)s] [WORKER] [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('worker.log')
    ]
)

logger = logging.getLogger(__name__)

def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description='Start background task worker')

    parser.add_argument(
        '--concurrency',
        type=int,
        default=active_config.WORKER_CONCURRENCY,
        help='Number of concurrent workers (for future enhancement)'
    )

    parser.add_argument(
        '--poll-interval',
        type=int,
        default=2,
        help='Seconds to wait between polling for new tasks'
    )

    return parser.parse_args()

if __name__ == '__main__':
    # Parse arguments
    args = parse_arguments()

    logger.info("=" * 60)
    logger.info("Starting Task Worker (Redis-free!)")
    logger.info(f"Concurrency: {args.concurrency}")
    logger.info(f"Poll interval: {args.poll_interval}s")
    logger.info("=" * 60)

    try:
        # Start worker
        start_worker(concurrency=args.concurrency)
    except KeyboardInterrupt:
        logger.info("Worker stopped by user (Ctrl+C)")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Worker error: {str(e)}", exc_info=True)
        sys.exit(1)
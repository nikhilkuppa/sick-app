# worker_run.py
import os
import sys
import logging
import argparse
from app.workers.worker import start_worker
from app.config import active_config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [WORKER_LAUNCHER] [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description='Start worker processes')
    
    parser.add_argument(
        '--concurrency',
        type=int,
        default=active_config.WORKER_CONCURRENCY,
        help='Number of worker processes'
    )
    
    parser.add_argument(
        '--worker-id',
        type=str,
        default='worker',
        help='Worker identifier prefix'
    )
    
    return parser.parse_args()

if __name__ == '__main__':
    # Parse arguments
    args = parse_arguments()
    
    logger.info(f"Starting worker with concurrency {args.concurrency}")
    
    try:
        # Start worker
        start_worker(worker_id=args.worker_id, concurrency=args.concurrency)
    except KeyboardInterrupt:
        logger.info("Worker launcher stopped by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Worker launcher error: {str(e)}")
        sys.exit(1)
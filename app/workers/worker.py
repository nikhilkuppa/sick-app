# app/workers/worker.py
import os
import redis
from rq import Worker, Queue
import logging
from app.config import active_config
import signal
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [WORKER] [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

# Initialize Redis connection
redis_conn = redis.from_url(active_config.REDIS_URL)

# Initialize queue
queue = Queue(active_config.REDIS_QUEUE_NAME, connection=redis_conn)

def signal_handler(sig, frame):
    """Handle termination signals gracefully."""
    logger.info("Received termination signal. Shutting down worker...")
    sys.exit(0)

def start_worker(worker_id=None, concurrency=None):
    """
    Start a worker process.
    
    Args:
        worker_id (str, optional): Worker identifier
        concurrency (int, optional): Number of concurrent processes
    """
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Set worker ID
    if worker_id is None:
        worker_id = os.environ.get('WORKER_ID', 'worker')
    
    # Set concurrency
    if concurrency is None:
        concurrency = active_config.WORKER_CONCURRENCY
    
    logger.info(f"Starting worker {worker_id} with concurrency {concurrency}")
    
    # Connect to Redis
    try:
        # Create and start worker
        worker = Worker(
            [queue],
            name=f"{worker_id}-{os.getpid()}",
            log_job_description=True
        )
        
        logger.info(f"Worker {worker.name} listening to queue: {active_config.REDIS_QUEUE_NAME}")
        
        # Start worker
        worker.work(with_scheduler=True)
    except KeyboardInterrupt:
        logger.info("Worker stopped by user")
    except Exception as e:
        logger.error(f"Worker error: {str(e)}")
        raise
        
if __name__ == '__main__':
    # This allows running the worker directly with: python -m app.workers.worker
    start_worker()
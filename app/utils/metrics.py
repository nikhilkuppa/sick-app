# app/utils/metrics.py
import time
import functools
import threading
import json
import os
from collections import defaultdict
import redis

# Store metrics in memory temporarily
_metrics = {
    "api_requests": defaultdict(int),
    "response_times": defaultdict(list),
    "error_counts": defaultdict(int),
    "worker_jobs": defaultdict(int),
    "cache_hits": 0,
    "cache_misses": 0
}

# Thread lock for thread-safe operations
_lock = threading.Lock()

# Redis client for distributed metrics
_redis_client = None

def initialize_metrics(redis_url):
    """Initialize the metrics module with Redis connection."""
    global _redis_client
    try:
        _redis_client = redis.from_url(redis_url)
        return True
    except Exception as e:
        print(f"Error initializing metrics Redis connection: {e}")
        return False

def track_api_request(endpoint):
    """Track API request count for a specific endpoint."""
    with _lock:
        _metrics["api_requests"][endpoint] += 1
    
    # Also store in Redis if available
    if _redis_client:
        try:
            _redis_client.hincrby("metrics:api_requests", endpoint, 1)
        except Exception as e:
            print(f"Error tracking API request in Redis: {e}")

def track_response_time(endpoint, time_ms):
    """Track response time for a specific endpoint."""
    with _lock:
        _metrics["response_times"][endpoint].append(time_ms)
        # Keep only last 1000 measurements
        if len(_metrics["response_times"][endpoint]) > 1000:
            _metrics["response_times"][endpoint] = _metrics["response_times"][endpoint][-1000:]
    
    # Also store in Redis if available
    if _redis_client:
        try:
            _redis_client.lpush(f"metrics:response_time:{endpoint}", time_ms)
            _redis_client.ltrim(f"metrics:response_time:{endpoint}", 0, 999)  # Keep last 1000
        except Exception as e:
            print(f"Error tracking response time in Redis: {e}")

def track_error(endpoint, error_type):
    """Track error occurrence for a specific endpoint."""
    error_key = f"{endpoint}:{error_type}"
    with _lock:
        _metrics["error_counts"][error_key] += 1
    
    # Also store in Redis if available
    if _redis_client:
        try:
            _redis_client.hincrby("metrics:errors", error_key, 1)
        except Exception as e:
            print(f"Error tracking error in Redis: {e}")

def track_worker_job(job_type, status):
    """Track worker job execution."""
    job_key = f"{job_type}:{status}"
    with _lock:
        _metrics["worker_jobs"][job_key] += 1
    
    # Also store in Redis if available
    if _redis_client:
        try:
            _redis_client.hincrby("metrics:worker_jobs", job_key, 1)
        except Exception as e:
            print(f"Error tracking worker job in Redis: {e}")

def track_cache(hit=True):
    """Track cache hit/miss."""
    with _lock:
        if hit:
            _metrics["cache_hits"] += 1
        else:
            _metrics["cache_misses"] += 1
    
    # Also store in Redis if available
    if _redis_client:
        try:
            if hit:
                _redis_client.incr("metrics:cache_hits")
            else:
                _redis_client.incr("metrics:cache_misses")
        except Exception as e:
            print(f"Error tracking cache metrics in Redis: {e}")

def get_metrics():
    """Get current metrics."""
    with _lock:
        # Calculate derived metrics
        result = dict(_metrics)
        
        # Calculate average response times
        avg_response_times = {}
        for endpoint, times in result["response_times"].items():
            if times:
                avg_response_times[endpoint] = sum(times) / len(times)
            else:
                avg_response_times[endpoint] = 0
        
        result["avg_response_times"] = avg_response_times
        
        # Calculate cache hit ratio
        total_cache = result["cache_hits"] + result["cache_misses"]
        if total_cache > 0:
            result["cache_hit_ratio"] = result["cache_hits"] / total_cache
        else:
            result["cache_hit_ratio"] = 0
            
        return result

# Remove Flask dependency
def timed_execution(func):
    """Decorator to measure execution time of a function."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.time()
        try:
            result = func(*args, **kwargs)
            return result
        finally:
            execution_time = (time.time() - start_time) * 1000  # Convert to ms
            # Use function name as endpoint
            endpoint = func.__name__
            track_response_time(endpoint, execution_time)
    return wrapper
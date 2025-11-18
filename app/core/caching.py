# app/core/caching_new.py
"""
Lightweight in-memory caching system (Redis replacement).
Uses LRU cache with TTL support and thread-safe operations.
"""

import functools
import json
import hashlib
import logging
import time
import threading
from app.config import active_config
from app.utils.metrics import track_cache

# Initialize logger
logger = logging.getLogger(__name__)


def get_cache_key(prefix, *args, **kwargs):
    """
    Generate a deterministic cache key from arguments.

    Args:
        prefix (str): Key prefix to categorize the cache entry
        *args: Positional arguments to include in the key
        **kwargs: Keyword arguments to include in the key

    Returns:
        str: Cache key
    """
    # Create a string representation of the arguments
    key_parts = [str(arg) for arg in args]
    key_parts.extend([f"{k}:{v}" for k, v in sorted(kwargs.items())])

    # Create a hash of the arguments
    args_hash = hashlib.md5(json.dumps(key_parts, sort_keys=True).encode()).hexdigest()

    # Combine prefix and hash
    return f"{prefix}:{args_hash}"


class LRUCache:
    """
    Thread-safe in-memory LRU cache with TTL support.
    This replaces Redis for caching functionality.
    """

    def __init__(self, max_size=5000):
        """
        Initialize LRU cache.

        Args:
            max_size (int): Maximum number of items to store
        """
        self.cache = {}
        self.max_size = max_size
        self.access_order = []
        self._lock = threading.RLock()

        # Statistics
        self.hits = 0
        self.misses = 0

    def get(self, key):
        """
        Get item from cache.

        Args:
            key (str): Cache key

        Returns:
            any: Cached value or None if not found/expired
        """
        with self._lock:
            if key in self.cache:
                value, expiry = self.cache[key]

                # Check if expired
                if expiry is not None and time.time() > expiry:
                    # Remove expired item
                    del self.cache[key]
                    self.access_order.remove(key)
                    self.misses += 1
                    return None

                # Update access order (move to end)
                self.access_order.remove(key)
                self.access_order.append(key)
                self.hits += 1

                return value

            self.misses += 1
            return None

    def set(self, key, value, ttl=None):
        """
        Set item in cache.

        Args:
            key (str): Cache key
            value (any): Value to cache (must be JSON-serializable)
            ttl (int, optional): Time-to-live in seconds
        """
        with self._lock:
            # Calculate expiry time
            expiry = None
            if ttl is not None:
                expiry = time.time() + ttl

            # Check if key exists
            if key in self.cache:
                self.access_order.remove(key)

            # Add/update item
            self.cache[key] = (value, expiry)
            self.access_order.append(key)

            # Evict oldest if needed
            while len(self.cache) > self.max_size:
                oldest_key = self.access_order.pop(0)
                del self.cache[oldest_key]
                logger.debug(f"Evicted cache key: {oldest_key}")

    def delete(self, key):
        """
        Delete item from cache.

        Args:
            key (str): Cache key
        """
        with self._lock:
            if key in self.cache:
                del self.cache[key]
                self.access_order.remove(key)

    def clear(self):
        """Clear all items from cache."""
        with self._lock:
            self.cache = {}
            self.access_order = []
            self.hits = 0
            self.misses = 0
            logger.info("Cache cleared")

    def cleanup_expired(self):
        """Remove all expired items from cache."""
        with self._lock:
            now = time.time()
            expired_keys = []

            for key, (value, expiry) in self.cache.items():
                if expiry is not None and now > expiry:
                    expired_keys.append(key)

            for key in expired_keys:
                del self.cache[key]
                self.access_order.remove(key)

            if expired_keys:
                logger.debug(f"Cleaned up {len(expired_keys)} expired cache entries")

    def get_stats(self):
        """
        Get cache statistics.

        Returns:
            dict: Cache stats
        """
        with self._lock:
            total = self.hits + self.misses
            hit_rate = (self.hits / total * 100) if total > 0 else 0

            return {
                "size": len(self.cache),
                "max_size": self.max_size,
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": f"{hit_rate:.2f}%"
            }


# Initialize global in-memory cache
memory_cache = LRUCache(max_size=active_config.MAX_CACHE_SIZE)


def cache_result(prefix, ttl=None):
    """
    Decorator for caching function results in memory.

    Args:
        prefix (str): Key prefix for the cache
        ttl (int, optional): Time-to-live in seconds. Defaults to config value.

    Returns:
        function: Decorated function

    Example:
        @cache_result("embeddings", ttl=3600)
        def get_embeddings(text):
            # expensive operation
            return result
    """
    if ttl is None:
        ttl = active_config.CACHE_EXPIRATION

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Generate cache key
            cache_key = get_cache_key(prefix, *args, **kwargs)

            # Try to get from cache
            cached_value = memory_cache.get(cache_key)
            if cached_value is not None:
                track_cache(hit=True)
                logger.debug(f"Cache hit for {cache_key}")
                return cached_value

            # Cache miss, execute function
            track_cache(hit=False)
            logger.debug(f"Cache miss for {cache_key}")
            result = func(*args, **kwargs)

            # Store in cache
            memory_cache.set(cache_key, result, ttl)

            return result
        return wrapper
    return decorator


# Backwards compatibility aliases
def redis_cache(prefix, ttl=None):
    """
    Alias for cache_result to maintain backwards compatibility.
    (Redis is no longer used, but keeping the name for easier migration)
    """
    return cache_result(prefix, ttl)


def memory_cache_decorator(prefix, ttl=3600):
    """
    Alias for cache_result to maintain backwards compatibility.
    """
    return cache_result(prefix, ttl)


# Cache cleanup scheduler
def schedule_cache_cleanup():
    """
    Schedule periodic cache cleanup to remove expired entries.
    Runs every 5 minutes.
    """
    def cleanup_loop():
        while True:
            time.sleep(300)  # 5 minutes
            memory_cache.cleanup_expired()

    cleanup_thread = threading.Thread(target=cleanup_loop, daemon=True)
    cleanup_thread.start()
    logger.info("Cache cleanup scheduler started")


# Start cleanup scheduler on import
schedule_cache_cleanup()

# app/core/caching.py
import functools
import json
import hashlib
import logging
import time
from app.config import active_config
from app import redis_client
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
    args_hash = hashlib.md5(json.dumps(key_parts).encode()).hexdigest()
    
    # Combine prefix and hash
    return f"{prefix}:{args_hash}"

def redis_cache(prefix, ttl=None):
    """
    Cache function results in Redis.
    
    Args:
        prefix (str): Key prefix for the cache
        ttl (int, optional): Time-to-live in seconds. Defaults to config value.
        
    Returns:
        function: Decorated function
    """
    if ttl is None:
        ttl = active_config.REDIS_CACHE_EXPIRATION
        
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Generate cache key
            cache_key = get_cache_key(prefix, *args, **kwargs)
            
            # Try to get from cache
            try:
                cached_value = redis_client.get(cache_key)
                if cached_value:
                    track_cache(hit=True)
                    logger.debug(f"Cache hit for {cache_key}")
                    return json.loads(cached_value)
                    
            except Exception as e:
                logger.warning(f"Redis cache retrieval error: {str(e)}")
            
            # Cache miss, execute function
            track_cache(hit=False)
            logger.debug(f"Cache miss for {cache_key}")
            result = func(*args, **kwargs)
            
            # Store in cache
            try:
                redis_client.setex(
                    cache_key,
                    ttl,
                    json.dumps(result)
                )
            except Exception as e:
                logger.warning(f"Redis cache storage error: {str(e)}")
                
            return result
        return wrapper
    return decorator

class LRUCache:
    """
    Simple in-memory LRU cache for when Redis is unavailable.
    Thread-safe implementation for local caching.
    """
    
    def __init__(self, max_size=1000):
        """
        Initialize LRU cache.
        
        Args:
            max_size (int): Maximum number of items to store
        """
        self.cache = {}
        self.max_size = max_size
        self.access_order = []
        self._lock = functools.RLock()
        
    def get(self, key):
        """
        Get item from cache.
        
        Args:
            key (str): Cache key
            
        Returns:
            any: Cached value or None if not found
        """
        with self._lock:
            if key in self.cache:
                # Update access order
                self.access_order.remove(key)
                self.access_order.append(key)
                
                value, expiry = self.cache[key]
                
                # Check if expired
                if expiry is not None and time.time() > expiry:
                    # Remove expired item
                    del self.cache[key]
                    self.access_order.remove(key)
                    return None
                    
                return value
            return None
            
    def set(self, key, value, ttl=None):
        """
        Set item in cache.
        
        Args:
            key (str): Cache key
            value (any): Value to cache
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
            if len(self.cache) > self.max_size:
                oldest_key = self.access_order.pop(0)
                del self.cache[oldest_key]
                
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

# Initialize in-memory cache
memory_cache = LRUCache(max_size=5000)

def memory_cache_decorator(prefix, ttl=3600):
    """
    Cache function results in memory.
    
    Args:
        prefix (str): Key prefix for the cache
        ttl (int): Time-to-live in seconds. Default is 1 hour.
        
    Returns:
        function: Decorated function
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Generate cache key
            cache_key = get_cache_key(prefix, *args, **kwargs)
            
            # Try to get from cache
            cached_value = memory_cache.get(cache_key)
            if cached_value is not None:
                track_cache(hit=True)
                logger.debug(f"Memory cache hit for {cache_key}")
                return cached_value
                
            # Cache miss, execute function
            track_cache(hit=False)
            logger.debug(f"Memory cache miss for {cache_key}")
            result = func(*args, **kwargs)
            
            # Store in cache
            memory_cache.set(cache_key, result, ttl)
                
            return result
        return wrapper
    return decorator


def cache_result(prefix, ttl=None):
    """
    Smart caching decorator that tries Redis first, falls back to memory cache.
    Decorate the function once at startup.
    """
    if ttl is None:
        ttl = active_config.REDIS_CACHE_EXPIRATION

    def decorator(func):
        if redis_client.ping():
            logger.info("Using Redis cache")
            return redis_cache(prefix, ttl)(func)
        else:
            logger.warning("Redis unavailable, using in-memory cache")
            return memory_cache_decorator(prefix, ttl)(func)

    return decorator
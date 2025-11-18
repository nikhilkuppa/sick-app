// Service Worker for Push Notifications
// Save this as /static/js/sw.js

const CACHE_NAME = 'medication-reminder-v1';
const urlsToCache = [
  '/',
  '/static/css/styles.css',
  '/static/css/auth-styles.css',
  '/static/js/app.js',
  '/static/js/auth.js',
  '/static/js/medications.js'
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      }
    )
  );
});

// Push event for medication reminders
self.addEventListener('push', event => {
  let data = {};
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }
  
  const options = {
    body: data.body || 'Time to take your medication!',
    icon: '/static/img/pill-icon.png',
    badge: '/static/img/pill-icon.png',
    vibrate: [100, 50, 100],
    requireInteraction: true,
    data: {
      dateOfArrival: Date.now(),
      medicationId: data.medicationId,
      medicationName: data.medicationName,
      time: data.time,
      url: '/'
    },
    actions: [
      {
        action: 'taken',
        title: 'Mark as Taken',
        icon: '/static/img/check-icon.png'
      },
      {
        action: 'skip',
        title: 'Skip',
        icon: '/static/img/skip-icon.png'
      },
      {
        action: 'snooze',
        title: 'Snooze 5min',
        icon: '/static/img/snooze-icon.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('💊 Medication Reminder', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  const action = event.action;
  const data = event.notification.data;
  
  if (action === 'taken' || action === 'skip') {
    // Send status update to server
    event.waitUntil(
      fetch('/api/v1/auth/medication-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          medication_id: data.medicationId,
          status: action,
          time: data.time,
          date: new Date().toISOString().split('T')[0]
        })
      })
    );
  } else if (action === 'snooze') {
    // Schedule another notification in 5 minutes
    setTimeout(() => {
      self.registration.showNotification('💊 Medication Reminder (Snoozed)', {
        body: `Don't forget: ${data.medicationName}`,
        icon: '/static/img/pill-icon.png',
        data: data
      });
    }, 5 * 60 * 1000);
  } else {
    // Default click - open the app
    event.waitUntil(
      clients.openWindow(data.url || '/')
    );
  }
});

// Background sync for offline status updates
self.addEventListener('sync', event => {
  if (event.tag === 'medication-status-sync') {
    event.waitUntil(syncMedicationStatus());
  }
});

async function syncMedicationStatus() {
  // Get pending status updates from IndexedDB
  const pendingUpdates = await getPendingStatusUpdates();
  
  for (const update of pendingUpdates) {
    try {
      const response = await fetch('/api/v1/auth/medication-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(update)
      });
      
      if (response.ok) {
        // Remove from pending updates
        await removePendingStatusUpdate(update.id);
      }
    } catch (error) {
      console.error('Failed to sync medication status:', error);
    }
  }
}

// IndexedDB helpers for offline functionality
async function getPendingStatusUpdates() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MedicationDB', 1);
    
    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['pendingUpdates'], 'readonly');
      const store = transaction.objectStore('pendingUpdates');
      const getAllRequest = store.getAll();
      
      getAllRequest.onsuccess = () => resolve(getAllRequest.result);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingUpdates')) {
        db.createObjectStore('pendingUpdates', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

async function removePendingStatusUpdate(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MedicationDB', 1);
    
    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['pendingUpdates'], 'readwrite');
      const store = transaction.objectStore('pendingUpdates');
      const deleteRequest = store.delete(id);
      
      deleteRequest.onsuccess = () => resolve();
    };
  });
}
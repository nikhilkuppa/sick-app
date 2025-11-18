// medication.js - Corrected and Consolidated Version
// Purpose: Manages all frontend logic for medication tracking, adherence, and history.
// Key Fixes:
// 1. `init` function: Removed `this._initialized = false;` to prevent an infinite loop causing 429 errors.
// 2. `updateMedicationStatus`: Consolidated two conflicting functions into one and corrected the API endpoint to fix 404 errors.

// Use the centralized API service
import { apiRequest as apiServiceRequest } from './apiService.js';

// Standardized API endpoint definitions
const MEDICATION_API = {
    GET_ALL: '/medications',
    TRACK: '/track-medication',
    UPDATE_STATUS: '/medication-status',
    GET_ADHERENCE: '/medication-adherence',
    BULK_ADHERENCE: '/bulk-medication-adherence',
    USER_HISTORY: '/user-history',
    DELETE_MEDICATION: '/medication',
};

/**
 * Enhanced data cache with advanced features
 */
const dataCache = {
    adherence: new Map(),
    medications: null,
    medicationHistory: null,
    cacheTTL: 300000, // Increase to 5 minutes
    timestamps: {
        adherence: new Map(),
        medications: 0,
        medicationHistory: 0
    },
    pendingRequests: new Map(),
  
    // Improved isValid with timestamp tolerance
    isValid: function(key, id = null) {
        const now = Date.now();
        if (id) {
            return this.timestamps[key].has(id) && 
                   (now - this.timestamps[key].get(id)) < this.cacheTTL;
        }
        return this.timestamps[key] && (now - this.timestamps[key]) < this.cacheTTL;
    },
  
    // Store data in cache
    set: function(key, data, id = null) {
        const now = Date.now();
        if (id) {
            this[key].set(id, data);
            this.timestamps[key].set(id, now);
        } else {
            this[key] = data;
            this.timestamps[key] = now;
        }
    },
  
    // Get data from cache
    get: function(key, id = null) {
        if (id) {
            return this[key].get(id);
        }
        return this[key];
    },
  
    // Get with auto-fetch capability
    getWithFetch: async function(key, id = null, fetchFn) {
        // If data is valid in cache, return it
        if (this.isValid(key, id)) {
            return id ? this[key].get(id) : this[key];
        }
  
        // Check if already fetching this data
        const requestKey = id ? `${key}-${id}` : key;
        if (this.pendingRequests.has(requestKey)) {
            return this.pendingRequests.get(requestKey);
        }
  
        // Not in cache or expired, fetch it
        const fetchPromise = fetchFn().then(data => {
            this.set(key, data, id);
            this.pendingRequests.delete(requestKey);
            return data;
        }).catch(error => {
            this.pendingRequests.delete(requestKey);
            throw error;
        });
  
        // Store the promise
        this.pendingRequests.set(requestKey, fetchPromise);
        return fetchPromise;
    },
  
    // Clear cache
    clear: function(key = null) {
        if (key) {
            if (this[key] instanceof Map) {
                this[key].clear();
                this.timestamps[key].clear();
            } else {
                this[key] = null;
                this.timestamps[key] = 0;
            }
        } else {
            this.adherence.clear();
            this.medications = null;
            this.medicationHistory = null;
            this.timestamps.adherence.clear();
            this.timestamps.medications = 0;
            this.timestamps.medicationHistory = 0;
        }
    }
};
  
// Batch update queue for medication status changes
const statusUpdateQueue = {
    queue: [],
    processing: false,
    timeout: null,
  
    // Add a status update to the queue
    add: function(update) {
        this.queue.push(update);
        this.scheduleProcessing();
    },
  
    // Schedule processing of the queue
    scheduleProcessing: function() {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => this.processQueue(), 500);
    },
  
    // Process the queue
    processQueue: async function() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        const batchSize = Math.min(this.queue.length, 5);
        const batch = this.queue.splice(0, batchSize);
        
        try {
            // Group by medication ID to reduce calls
            const medGroups = {};
            batch.forEach(update => {
                if (!medGroups[update.medicationId]) {
                    medGroups[update.medicationId] = [];
                }
                medGroups[update.medicationId].push(update);
            });
            
            // Process each group
            const promises = Object.keys(medGroups).map(medId => {
                const updates = medGroups[medId];
                return MedicationService.batchUpdateMedicationStatus(medId, updates);
            });
            
            await Promise.all(promises);
        } catch (error) {
            console.error('Error processing status updates:', error);
            // Re-add failed updates to the queue
            this.queue.unshift(...batch);
        } finally {
            this.processing = false;
            if (this.queue.length > 0) {
                this.scheduleProcessing();
            }
        }
    }
};
  
// Debounce function to prevent too many requests
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}
  
// Main Medication Service with corrected function calls
const MedicationService = {
    _initialized: false,

    /**
     * Initialize medication tracking system.
     * Correctly uses the `_initialized` guard to prevent re-entry and infinite loops.
     */
    init: function() {
        if (this._initialized) return;
        this._initialized = true; // Set guard and DO NOT reset it.

        if (window.AuthService?.isAuthenticated()) {
            dataCache.clear();
            this.setupMedicationTrackers();
            this.loadAllMedicationData();
        } else {
            this.setupAnonymousUserPrompts();
        }
    },
    
    /**
     * Enhanced medication status update with timezone support.
     * This is the single, corrected function that replaces all previous versions.
     * It uses the correct API endpoint, fixing the 404 error.
     */
    updateMedicationStatus: async function(medicationId, status, medicationName, time) {
        try {
            const userTimezone = await this.getUserTimezone();
            const now = new Date();
            const userDate = new Date(now.toLocaleString('en-US', { timeZone: userTimezone }));
            const data = {
                medication_id: medicationId,
                status: status,
                date: userDate.toISOString().split('T')[0],
                time: time || userDate.toTimeString().split(' ')[0].slice(0, 5),
            };
            const response = await apiServiceRequest(MEDICATION_API.UPDATE_STATUS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (response.error) {
                throw new Error(response.error);
            }
            this.showNotification(`Medication marked as ${status}`);
            debouncedInvalidateAdherence(medicationId);
            // Optimistically update UI from cache, then re-fetch in background
            setTimeout(() => {
                this.loadAdherenceData(medicationId);
            }, 350);
        } catch (error) {
            console.error('Error updating medication status:', error);
            this.showNotification(error.message || 'Failed to update medication status', 'error');
            throw error;
        }
    },
    
    /**
     * Load all medication data in a coordinated way to prevent rate limiting
     */
    loadAllMedicationData: async function() {
        try {
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'global-loading-indicator';
            loadingIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading your data...';
            document.body.appendChild(loadingIndicator);
            
            // Step 1: Load medications list
            const medications = await this.loadMedicationTracking();
            
            // Short delay to spread out requests
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Step 2: Load both medication and query history in parallel
            const historyPromise = this.loadMedicationHistory();
            const queryHistoryPromise = this.loadQueryHistory();
            
            // Step 3: Render the main UI components
            this.renderMedicationTracking(medications);
            this.updateTodaySchedule(medications);
            
            // Wait for all parallel loading to complete
            await Promise.all([historyPromise, queryHistoryPromise]);
            
            // Remove loading indicator
            document.body.removeChild(loadingIndicator);
            
            return medications;
        } catch (error) {
            console.error('Error loading all medication data:', error);
            this.showNotification('There was an error loading your data. Please try refreshing.', 'error');
            const loadingIndicator = document.querySelector('.global-loading-indicator');
            if (loadingIndicator) {
                document.body.removeChild(loadingIndicator);
            }
            return [];
        }
    },
    
    /**
     * Set up anonymous user prompts
     */
    setupAnonymousUserPrompts: function() {
        // Add click handlers to medication tracking-related buttons that require authentication
        document.querySelectorAll('.track-medication-btn, #add-medication-button').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                // Show login modal instead
                const loginModal = document.getElementById('login-modal');
                if (loginModal) {
                    loginModal.style.display = 'block';
                }
                this.showNotification('Please log in to track medications', 'warning');
            });
        });
  
        // If we're on the medications or history sections, show login prompts
        const currentSection = document.querySelector('.app-section.active');
        if (currentSection && (currentSection.id === 'medications-section' || currentSection.id === 'history-section')) {
            const container = document.createElement('div');
            container.className = 'login-prompt';
            container.innerHTML = `
                <div class="login-prompt-content">
                    <i class="fas fa-lock icon-large"></i>
                    <h3>Sign in to access this feature</h3>
                    <p>Create an account or sign in to track medications and view your history.</p>
                    <div class="prompt-buttons">
                        <button id="prompt-login-button" class="auth-button">Login</button>
                        <button id="prompt-register-button" class="auth-button primary">Sign Up</button>
                    </div>
                </div>
            `;
            currentSection.querySelector('.section-content').appendChild(container);
            
            // Add click handlers to the login/register buttons
            document.getElementById('prompt-login-button')?.addEventListener('click', () => {
                document.getElementById('login-modal').style.display = 'block';
            });
            
            document.getElementById('prompt-register-button')?.addEventListener('click', () => {
                document.getElementById('register-modal').style.display = 'block';
            });
        }
    },
    
    /**
     * Set up medication tracking UI
     */
    setupMedicationTrackers: function() {
        // Add click handlers to "Track this medication" buttons
        document.querySelectorAll('.track-medication-btn').forEach(button => {
            button.addEventListener('click', event => {
                const drugCard = event.target.closest('.drug-card');
                if (drugCard) {
                    const drugName = drugCard.querySelector('.drug-name').textContent;
                    const brandName = drugCard.querySelector('.brand-name')?.textContent;
                    const dosage = drugCard.querySelector('.dosage')?.textContent;
                    
                    this.showTrackingModal(drugName, brandName, dosage);
                }
            });
        });
        
        // Handle medication status buttons
        document.getElementById('mark-taken-button')?.addEventListener('click', () => {
            const modal = document.getElementById('medication-status-modal');
            const medicationId = modal.getAttribute('data-medication-id');
            const medicationName = document.getElementById('status-drug-name').textContent;
            this.updateMedicationStatus(medicationId, 'taken', medicationName);
        });
        
        document.getElementById('mark-skipped-button')?.addEventListener('click', () => {
            const modal = document.getElementById('medication-status-modal');
            const medicationId = modal.getAttribute('data-medication-id');
            const medicationName = document.getElementById('status-drug-name').textContent;
            this.updateMedicationStatus(medicationId, 'skipped', medicationName);
        });
        
        // Set up medication tracking form
        const trackingForm = document.getElementById('medication-tracking-form');
        if (trackingForm) {
            trackingForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                
                // Get form data
                const drugName = document.getElementById('tracking-drug-name').value;
                const brandName = document.getElementById('tracking-brand-name').value;
                const dosage = document.getElementById('tracking-dosage').value;
                const frequency = document.getElementById('tracking-frequency').value;
                const startDate = document.getElementById('tracking-start-date').value;
                const endDate = document.getElementById('tracking-end-date').value;
                const reminderEnabled = document.getElementById('tracking-reminder-enabled').checked;
                
                // Get reminder times
                const reminderTimes = [];
                document.querySelectorAll('.reminder-time').forEach(input => {
                    if (input.value) {
                        reminderTimes.push(input.value);
                    }
                });
                
                // Create medication data
                const medicationData = {
                    drug_name: drugName,
                    brand_name: brandName,
                    dosage: dosage,
                    frequency: frequency,
                    start_date: startDate,
                    end_date: endDate,
                    reminder_enabled: reminderEnabled,
                    reminder_times: reminderTimes
                };
                
                // Check if this is an update
                const medicationId = trackingForm.getAttribute('data-medication-id');
                if (medicationId) {
                    medicationData.medication_id = medicationId;
                }
                
                try {
                    const trackedMed = await this.trackMedication(medicationData);
                    
                    // LIGHTWEIGHT UPDATE to prevent rate-limiting
                    // Instead of a full reload, just update the local cache and rerender
                    if (trackedMed && trackedMed.data) {
                        dataCache.set('medications', [...dataCache.get('medications'), trackedMed.data]);
                        this.renderMedicationTracking(dataCache.get('medications'));
                        this.updateTodaySchedule(dataCache.get('medications'));
                    } else {
                        // Fallback to reload if needed
                        this.loadAllMedicationData();
                    }
                    this.showNotification('Medication tracked successfully');
                } catch (error) {
                    console.error('Error tracking medication:', error);
                    this.showNotification('Failed to track medication', 'error');
                }
            });
        }
        
        // Handle reminder toggle
        const reminderToggle = document.getElementById('tracking-reminder-enabled');
        const reminderSection = document.getElementById('reminder-times-section');
        
        if (reminderToggle && reminderSection) {
            reminderToggle.addEventListener('change', function() {
                reminderSection.style.display = this.checked ? 'block' : 'none';
            });
        }
        
        // Add button for adding more reminder times
        const addReminderBtn = document.getElementById('add-reminder-time');
        const reminderTimesContainer = document.getElementById('reminder-times-container');
        
        if (addReminderBtn && reminderTimesContainer) {
            addReminderBtn.addEventListener('click', function() {
                const newTimeInput = document.createElement('input');
                newTimeInput.type = 'time';
                newTimeInput.className = 'reminder-time';
                newTimeInput.required = true;
                
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'remove-time-btn';
                removeBtn.innerHTML = '&times;';
                removeBtn.addEventListener('click', function() {
                    this.parentElement.remove();
                });
                
                const timeContainer = document.createElement('div');
                timeContainer.className = 'time-container';
                timeContainer.appendChild(newTimeInput);
                timeContainer.appendChild(removeBtn);
                
                reminderTimesContainer.appendChild(timeContainer);
            });
        }
        
        // Close modals when clicking on close button or outside
        document.querySelectorAll('.modal .close-button').forEach(button => {
            button.addEventListener('click', function() {
                const modal = this.closest('.modal');
                if (modal) {
                    modal.style.display = 'none';
                }
            });
        });
        
        // Close modal when clicking outside
        window.addEventListener('click', function(event) {
            document.querySelectorAll('.modal').forEach(modal => {
                if (event.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });
        
        // Add medication button in dashboard
        const addMedicationButton = document.getElementById('add-medication-button');
        if (addMedicationButton) {
            addMedicationButton.addEventListener('click', () => {
                this.showTrackingModal();
            });
        }
    },
    
    /**
     * Show medication tracking modal
     * @param {string} drugName - Scientific name of the drug
     * @param {string} brandName - Brand name of the drug
     * @param {string} dosage - Dosage information
     */
    showTrackingModal: function(drugName, brandName, dosage) {
        // Reset medication ID data attribute
        const trackingForm = document.getElementById('medication-tracking-form');
        if (trackingForm) {
            trackingForm.removeAttribute('data-medication-id');
        }
        
        // Update modal title
        const modalTitle = document.querySelector('#medication-tracking-modal h2');
        if (modalTitle) {
            modalTitle.textContent = 'Track Medication';
        }
        
        // Update submit button text
        const submitButton = document.querySelector('#medication-tracking-form button[type="submit"]');
        if (submitButton) {
            submitButton.textContent = 'Track Medication';
        }
        
        // Populate form with drug information if provided
        document.getElementById('tracking-drug-name').value = drugName || '';
        document.getElementById('tracking-brand-name').value = brandName || '';
        document.getElementById('tracking-dosage').value = dosage || '';
        
        // Set default start date to today
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('tracking-start-date').value = today;
        
        // Clear reminder times
        const reminderTimesContainer = document.getElementById('reminder-times-container');
        if (reminderTimesContainer) {
            reminderTimesContainer.innerHTML = '';
            
            // Add one default time input
            const timeContainer = document.createElement('div');
            timeContainer.className = 'time-container';
            
            const timeInput = document.createElement('input');
            timeInput.type = 'time';
            timeInput.className = 'reminder-time';
            timeInput.required = true;
            timeInput.value = '09:00';
            
            timeContainer.appendChild(timeInput);
            reminderTimesContainer.appendChild(timeContainer);
        }
        
        // Reset reminder toggle
        const reminderToggle = document.getElementById('tracking-reminder-enabled');
        if (reminderToggle) {
            reminderToggle.checked = false;
        }
        
        const reminderSection = document.getElementById('reminder-times-section');
        if (reminderSection) {
            reminderSection.style.display = 'none';
        }
        
        // Show the modal
        const modal = document.getElementById('medication-tracking-modal');
        if (modal) {
            modal.style.display = 'block';
        }
    },
    
    /**
     * Track a medication
     * @param {Object} medicationData - Medication tracking data
     * @returns {Promise} Tracking result
     */
    trackMedication: async function(medicationData) {
        return await apiServiceRequest(MEDICATION_API.TRACK, {
            method: 'POST',
            body: JSON.stringify(medicationData),
        });
    },
  
    /**
     * Load medication tracking data with efficient caching
     * @returns {Promise} Medication data
     */
    loadMedicationTracking: function() {
        if (!window.AuthService || !window.AuthService.isAuthenticated()) {
            return Promise.resolve([]);
        }
        
        // Use the enhanced cache method with auto-fetching
        return dataCache.getWithFetch('medications', null, async () => {
            try {
                console.log('Fetching medication data from API...');
                const data = await apiServiceRequest(MEDICATION_API.GET_ALL);
                
                // Deduplicate medications by unique combination of drug name, dosage, AND frequency
                // This allows tracking the same drug multiple times with different dosages/frequencies
                const uniqueMedications = [];
                const seenMedications = new Set();

                if (data.medications && data.medications.length > 0) {
                    data.medications.forEach(med => {
                        // Use medication ID if available, otherwise create composite key
                        const medKey = med.id || `${med.drug_name}-${med.dosage || ''}-${med.frequency || ''}`;

                        if (!seenMedications.has(medKey)) {
                            uniqueMedications.push(med);
                            seenMedications.add(medKey);
                        } else {
                            // If there are true duplicates (same ID or exact same drug+dosage+frequency),
                            // keep the most recent one
                            const existingIndex = uniqueMedications.findIndex(m => {
                                const existingKey = m.id || `${m.drug_name}-${m.dosage || ''}-${m.frequency || ''}`;
                                return existingKey === medKey;
                            });

                            if (existingIndex !== -1) {
                                const existingMed = uniqueMedications[existingIndex];
                                const existingCreatedAt = new Date(existingMed.created_at || 0);
                                const newCreatedAt = new Date(med.created_at || 0);

                                if (newCreatedAt > existingCreatedAt) {
                                    uniqueMedications[existingIndex] = med;
                                }
                            }
                        }
                    });
                }

                return uniqueMedications;
            } catch (error) {
                console.error('Error loading medication tracking:', error);
                return [];
            }
        });
    },
    
    /**
     * Update the today's schedule section
     * @param {Array} medications - List of medications
     */
    updateTodaySchedule: function(medications) {
        const scheduleContainer = document.getElementById('today-schedule');
        
        if (!scheduleContainer) {
            return;
        }
        
        if (!medications || medications.length === 0) {
            scheduleContainer.innerHTML = '<div class="no-schedule-message"><p>No medications scheduled for today.</p></div>';
            return;
        }
        
        // Filter medications that are active today
        const today = new Date();
        const todayString = today.toISOString().split('T')[0];
        
        // Enhanced filtering that allows multiple entries of same drug with different dosages/frequencies
        const activeMeds = [];
        const seenMedications = new Set();

        medications.forEach(med => {
            // Use medication ID or composite key (drug name + dosage + frequency) to allow multiple entries
            const medKey = med.id || `${med.drug_name}-${med.dosage || ''}-${med.frequency}`;
            if (seenMedications.has(medKey)) {
                return; // True duplicate (same ID or exact same drug+dosage+frequency)
            }
            
            const startDate = new Date(med.start_date);
            const endDate = med.end_date ? new Date(med.end_date) : null;
            
            // Check if medication is active today
            if (
                startDate <= today && 
                (!endDate || endDate >= today) &&
                med.frequency !== 'as-needed'
            ) {
                activeMeds.push(med);
                seenMedications.add(medKey);
            }
        });
        
        if (activeMeds.length === 0) {
            scheduleContainer.innerHTML = '<div class="no-schedule-message"><p>No medications scheduled for today.</p></div>';
            return;
        }
        
        // Create a map to store all doses by time
        const dosesByTime = new Map();
        
        // Helper function to add a dose to the map
        const addDose = (time, med, doseNum = '') => {
            // Convert 24h time to a sortable value (minutes since midnight)
            let sortTime = 0;
            if (time) {
                const [hours, minutes] = time.split(':').map(Number);
                sortTime = hours * 60 + minutes;
            }
            
            if (!dosesByTime.has(sortTime)) {
                dosesByTime.set(sortTime, []);
            }
            
            dosesByTime.get(sortTime).push({
                id: med.id || '',
                name: med.drug_name,
                dosage: med.dosage || 'Standard dose',
                time: time,
                formattedTime: this.formatTime(time),
                doseNum: doseNum
            });
        };
        
        // Process each active medication
        activeMeds.forEach(med => {
            // If reminder times are specified, use those
            if (med.reminder_times && med.reminder_times.length > 0) {
                med.reminder_times.forEach((time, index) => {
                    addDose(time, med, index + 1);
                });
            } else {
                // Use default times based on frequency
                switch(med.frequency) {
                    case 'daily':
                        addDose('09:00', med);
                        break;
                    case 'twice-daily':
                        addDose('09:00', med, 1);
                        addDose('18:00', med, 2);
                        break;
                    case 'three-times-daily':
                        addDose('09:00', med, 1);
                        addDose('14:00', med, 2);
                        addDose('20:00', med, 3);
                        break;
                    case 'weekly':
                        // Only show if today is the weekly day (using start date as reference)
                        const startDay = new Date(med.start_date).getDay();
                        const todayDay = today.getDay();
                        if (startDay === todayDay) {
                            addDose('09:00', med);
                        }
                        break;
                    default:
                        addDose('09:00', med);
                }
            }
        });
        
        // Generate HTML with sorted doses
        let scheduleHTML = '';
        const sortedTimes = [...dosesByTime.keys()].sort((a, b) => a - b);
        
        sortedTimes.forEach(sortTime => {
            const doses = dosesByTime.get(sortTime);
            
            doses.forEach(dose => {
                scheduleHTML += `
                    <div class="schedule-item" data-time="${sortTime}">
                        <div class="schedule-info">
                            <span class="schedule-time">${dose.formattedTime}</span>
                            <span class="schedule-name">${dose.name} ${dose.doseNum ? `(Dose ${dose.doseNum})` : ''}</span>
                            <span class="schedule-dosage">${dose.dosage}</span>
                        </div>
                        <div class="schedule-actions">
                            <button class="status-button taken" data-id="${dose.id}" data-name="${dose.name}" data-time="${dose.time}">
                                <i class="fas fa-check"></i> Taken
                            </button>
                            <button class="status-button skipped" data-id="${dose.id}" data-name="${dose.name}" data-time="${dose.time}">
                                <i class="fas fa-times"></i> Skip
                            </button>
                        </div>
                    </div>
                `;
            });
        });
        
        scheduleContainer.innerHTML = scheduleHTML || '<div class="no-schedule-message"><p>No medications scheduled for today.</p></div>';
        
        // Add event listeners to the status buttons
        scheduleContainer.querySelectorAll('.status-button.taken').forEach(button => {
            button.addEventListener('click', () => {
                const medId = button.getAttribute('data-id');
                const medName = button.getAttribute('data-name');
                const doseTime = button.getAttribute('data-time');
                this.updateMedicationStatus(medId, 'taken', medName, doseTime);
            });
        });
        
        scheduleContainer.querySelectorAll('.status-button.skipped').forEach(button => {
            button.addEventListener('click', () => {
                const medId = button.getAttribute('data-id');
                const medName = button.getAttribute('data-name');
                const doseTime = button.getAttribute('data-time');
                this.updateMedicationStatus(medId, 'skipped', medName, doseTime);
            });
        });
    },
    
    /**
     * Format time string
     * @param {string} timeStr - Time string (HH:MM)
     * @returns {string} Formatted time (HH:MM AM/PM)
     */
    formatTime: function(timeStr, timezone = 'US/Eastern') {
        if (!timeStr) return '';
        
        try {
            // Create a date object for today with the given time
            const [hours, minutes] = timeStr.split(':').map(Number);
            const date = new Date();
            date.setHours(hours, minutes, 0, 0);
            
            // Format in user's timezone
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: timezone
            });
        } catch (e) {
            console.error('Error formatting time:', e);
            return timeStr;
        }
    },
    
    /**
     * Render medication tracking information in the UI
     * @param {Array} medications - User's medication data
     */
    renderMedicationTracking: function(medications) {
        const trackingContainer = document.getElementById('medication-tracking-display');
        
        if (!trackingContainer) {
            // Create the container if it doesn't exist
            const resultsDiv = document.getElementById('results');
            if (resultsDiv) {
                const newContainer = document.createElement('div');
                newContainer.id = 'medication-tracking-display';
                newContainer.className = 'medication-tracking-display';
                resultsDiv.parentNode.insertBefore(newContainer, resultsDiv.nextSibling);
                this.populateMedicationTracking(newContainer, medications);
            }
            return;
        }
        
        this.populateMedicationTracking(trackingContainer, medications);
    },
    
    /**
     * Populate medication tracking container with data
     * @param {HTMLElement} container - Container element
     * @param {Array} medications - Medications data
     */
    populateMedicationTracking: function(container, medications) {
        if (!medications || medications.length === 0) {
            container.innerHTML = `
                <div class="no-medications-message">
                    <i class="fas fa-prescription-bottle-alt icon-large"></i>
                    <p>You haven't tracked any medications yet.</p>
                    <p>Use the "Track this medication" button when you get recommendations or add them manually.</p>
                </div>
            `;
            return;
        }
        
        let trackingHTML = '<div class="tracked-medications">';
        
        medications.forEach(med => {
            const startDate = med.start_date ? new Date(med.start_date).toLocaleDateString() : 'N/A';
            const endDate = med.end_date ? new Date(med.end_date).toLocaleDateString() : 'Ongoing';
            
            // Calculate next dose time based on frequency
            let nextDoseText = 'As needed';
            if (med.frequency && med.frequency !== 'as-needed') {
                const today = new Date();
                let nextDoseTime = '';
                
                if (med.reminder_times && med.reminder_times.length > 0) {
                    nextDoseTime = med.reminder_times[0];
                } else {
                    // Default times based on frequency
                    switch(med.frequency) {
                        case 'daily':
                            nextDoseTime = '09:00';
                            break;
                        case 'twice-daily':
                            // Check if it's before or after noon
                            nextDoseTime = today.getHours() < 12 ? '09:00' : '18:00';
                            break;
                        case 'three-times-daily':
                            // Morning, noon, evening
                            if (today.getHours() < 10) nextDoseTime = '09:00';
                            else if (today.getHours() < 16) nextDoseTime = '14:00';
                            else nextDoseTime = '20:00';
                            break;
                        case 'weekly':
                            nextDoseTime = '09:00';
                            break;
                    }
                }
                
                if (nextDoseTime) {
                    const formattedTime = this.formatTime(nextDoseTime);
                    nextDoseText = `Next dose: ${formattedTime}`;
                }
            }
            
            // Add medication status indicator
            const statusClass = this.getMedicationStatusClass(med);
            
            // Create chart ID
            const adherenceChartId = `adherence-chart-${med.id || med.drug_name.toLowerCase().replace(/\s+/g, '-')}`;
            
            trackingHTML += `
                <div class="medication-item" data-id="${med.id || ''}" data-name="${med.drug_name}">
                    <div class="medication-status ${statusClass}"></div>
                    <div class="medication-header">
                        <h4>${med.drug_name || 'Unnamed Medication'}</h4>
                        <button class="edit-medication-btn" title="Edit medication">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                    <p><strong>Brand:</strong> ${med.brand_name || 'N/A'}</p>
                    <p><strong>Dosage:</strong> ${med.dosage || 'N/A'}</p>
                    <p><strong>Frequency:</strong> ${med.frequency || 'As needed'}</p>
                    <p><strong>Period:</strong> ${startDate} to ${endDate}</p>
                    <p><strong>${nextDoseText}</strong></p>
                    <div class="medication-adherence">
                        <h5>Recent Adherence</h5>
                        <div class="adherence-chart" id="${adherenceChartId}">
                            <div class="loading-chart">Loading adherence data...</div>
                        </div>
                    </div>
                    <button class="delete-medication-btn" title="Delete medication">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
        });
        
        trackingHTML += '</div>';
        container.innerHTML = trackingHTML;
        
        // Add click handlers to medication items
        container.querySelectorAll('.medication-item').forEach(item => {
            item.addEventListener('click', (event) => {
                // Don't trigger if clicking the edit button
                if (event.target.closest('.edit-medication-btn')) {
                    return;
                }
                
                const medId = item.getAttribute('data-id');
                const medName = item.getAttribute('data-name');
                
                if (medId || medName) {
                    // Find the medication in the array
                    const medication = medications.find(m => 
                        (medId && m.id === medId) || 
                        (medName && m.drug_name === medName)
                    );
                    
                    if (medication) {
                        this.showMedicationStatus(medication);
                    }
                }
            });
        });
        
        // Add click handlers to edit buttons
        container.querySelectorAll('.edit-medication-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const medItem = button.closest('.medication-item');
                const medId = medItem.getAttribute('data-id');
                const medName = medItem.getAttribute('data-name');
                
                if (medId || medName) {
                    // Find the medication in the array
                    const medication = medications.find(m => 
                        (medId && m.id === medId) || 
                        (medName && m.drug_name === medName)
                    );
                    
                    if (medication) {
                        this.showEditMedicationModal(medication);
                    }
                }
            });
        });
        
        // Load adherence charts with bulk method
        this.initializeAdherenceChartsWithBulk(medications);
        
        // Add new event listener after rendering
        container.querySelectorAll('.delete-medication-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const medItem = button.closest('.medication-item');
                const medId = medItem.dataset.id;
                if (confirm('Are you sure you want to delete this medication?')) {
                    this.deleteMedication(medId);
                }
            });
        });
    },
    
    /**
     * Initialize adherence charts from bulk data
     * @param {Array} medications - List of medications
     */
    initializeAdherenceChartsWithBulk: async function(medications) {
        if (!medications || medications.length === 0) return;
        const medicationIds = medications.filter(med => med.id).map(med => med.id);
        if (medicationIds.length === 0) return;
        // Show loading state in all chart containers
        medicationIds.forEach(medId => {
            const chartId = `adherence-chart-${medId}`;
            const chartContainer = document.getElementById(chartId);
            if (chartContainer) {
                chartContainer.innerHTML = '<div class="loading-chart">Loading adherence data...</div>';
            }
        });
        // Centralized fetch
        const adherenceData = await MedicationService.fetchAdherenceForMeds(medicationIds);
        medicationIds.forEach(medId => {
            const chartId = `adherence-chart-${medId}`;
            const chartContainer = document.getElementById(chartId);
            if (chartContainer) {
                const data = adherenceData[medId];
                if (data) {
                    MedicationService.createAdherenceChart(chartContainer, data);
                    // If fallback, show warning
                    if (data.status.every(s => s === 'none')) {
                        const warn = document.createElement('div');
                        warn.className = 'adherence-warning';
                        warn.textContent = 'Adherence data may be delayed or unavailable.';
                        chartContainer.appendChild(warn);
                    }
                } else {
                    // Empty fallback
                    const emptyData = MedicationService.generateFallbackAdherenceData();
                    MedicationService.createAdherenceChart(chartContainer, emptyData);
                    const warn = document.createElement('div');
                    warn.className = 'adherence-warning';
                    warn.textContent = 'Adherence data may be delayed or unavailable.';
                    chartContainer.appendChild(warn);
                }
            }
        });
    },
    
    /**
     * Initialize individual adherence charts as fallback
     * @param {Array} medications - List of medications
     */
    initializeAdherenceCharts: function(medications) {
        if (!medications || medications.length === 0) return;
        
        // Use a small delay to prevent too many simultaneous requests
        const batchSize = 3;
        let currentBatch = 0;
        
        const loadBatch = () => {
            const startIdx = currentBatch * batchSize;
            const endIdx = Math.min(startIdx + batchSize, medications.length);
            
            for (let i = startIdx; i < endIdx; i++) {
                const med = medications[i];
                if (med.id) {
                    const chartId = `adherence-chart-${med.id || med.drug_name.toLowerCase().replace(/\s+/g, '-')}`;
                    const chartContainer = document.getElementById(chartId);
                    
                    if (chartContainer) {
                        // Set a small timeout for each medication to stagger requests
                        setTimeout(() => {
                            this.loadAdherenceData(med.id, chartContainer);
                        }, (i - startIdx) * 100);
                    }
                }
            }
            
            currentBatch++;
            
            // Schedule next batch if needed
            if (endIdx < medications.length) {
                setTimeout(loadBatch, batchSize * 300);
            }
        };
        
        // Start loading the first batch
        loadBatch();
    },

    /**
     * Create adherence chart
     * @param {HTMLElement} container - Chart container element
     * @param {Object} data - Adherence data
     */
    createAdherenceChart: function(container, data) {
        const chartHTML = document.createElement('div');
        chartHTML.className = 'adherence-bar-chart';
        
        // Create the legend
        const legend = document.createElement('div');
        legend.className = 'adherence-legend';
        legend.innerHTML = `
            <div class="legend-item">
                <span class="legend-color taken"></span>
                <span class="legend-label">Taken</span>
            </div>
            <div class="legend-item">
                <span class="legend-color skipped"></span>
                <span class="legend-label">Skipped</span>
            </div>
            <div class="legend-item">
                <span class="legend-color none"></span>
                <span class="legend-label">No Data</span>
            </div>
        `;
        
        // Create the bars
        for (let i = 0; i < data.dates.length; i++) {
            const dateObj = new Date(data.dates[i]);
            const day = dateObj.getDate();
            const month = dateObj.getMonth() + 1; // Month is 0-indexed
            const status = data.status[i] || 'none';
            
            const bar = document.createElement('div');
            bar.className = `adherence-bar ${status}`;
            bar.title = `${dateObj.toLocaleDateString()}: ${status === 'none' ? 'No data' : status.charAt(0).toUpperCase() + status.slice(1)}`;
            
            // Make bar editable by clicking
            bar.setAttribute('data-date', data.dates[i]);
            bar.setAttribute('data-status', status);
            bar.addEventListener('click', (event) => {
                this.showEditStatusModal(bar.getAttribute('data-date'), bar.getAttribute('data-status'), container.id);
            });
            
            const label = document.createElement('span');
            label.className = 'bar-label';
            label.textContent = `${month}/${day}`;
            
            bar.appendChild(label);
            chartHTML.appendChild(bar);
        }
        
        // Clear the container and add the chart
        container.innerHTML = '';
        container.appendChild(legend);
        container.appendChild(chartHTML);
    },
    
    /**
     * Show edit status modal for a specific date
     * @param {string} date - Date string (YYYY-MM-DD)
     * @param {string} currentStatus - Current status (taken, skipped, none)
     * @param {string} chartId - ID of the chart container
     */
    showEditStatusModal: function(date, currentStatus, chartId) {
        // Extract medication ID from chart ID
        const medicationId = chartId.replace('adherence-chart-', '');
        
        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.className = 'edit-status-modal';
        modalContent.innerHTML = `
            <h3>Update Status for ${new Date(date).toLocaleDateString()}</h3>
            <div class="status-options">
                <button class="status-button taken ${currentStatus === 'taken' ? 'active' : ''}">
                    <i class="fas fa-check"></i> Taken
                </button>
                <button class="status-button skipped ${currentStatus === 'skipped' ? 'active' : ''}">
                    <i class="fas fa-times"></i> Skipped
                </button>
                <button class="status-button none ${currentStatus === 'none' ? 'active' : ''}">
                    <i class="fas fa-minus"></i> No Data
                </button>
            </div>
            <div class="modal-buttons">
                <button class="save-status-btn">Save</button>
                <button class="cancel-status-btn">Cancel</button>
            </div>
        `;
        
        // Create and show modal
        const modal = document.createElement('div');
        modal.className = 'modal edit-status-modal-container';
        modal.style.display = 'block';
        
        const modalDiv = document.createElement('div');
        modalDiv.className = 'modal-content';
        modalDiv.appendChild(modalContent);
        
        modal.appendChild(modalDiv);
        document.body.appendChild(modal);
        
        // Set current status
        let selectedStatus = currentStatus;
        
        // Add click handlers to status buttons
        modal.querySelectorAll('.status-button').forEach(button => {
            button.addEventListener('click', () => {
                // Remove active class from all buttons
                modal.querySelectorAll('.status-button').forEach(btn => {
                    btn.classList.remove('active');
                });
                
                // Add active class to clicked button
                button.classList.add('active');
                
                // Update selected status
                if (button.classList.contains('taken')) {
                    selectedStatus = 'taken';
                } else if (button.classList.contains('skipped')) {
                    selectedStatus = 'skipped';
                } else {
                    selectedStatus = 'none';
                }
            });
        });
        
        // Add click handler to save button
        modal.querySelector('.save-status-btn').addEventListener('click', () => {
            this.updateHistoricalMedicationStatus(medicationId, date, selectedStatus).then(() => {
                // Close modal
                document.body.removeChild(modal);
                
                // Reload adherence data for the chart
                const chartContainer = document.getElementById(chartId);
                if (chartContainer) {
                    // Update the chart immediately for better UX
                    const bar = chartContainer.querySelector(`.adherence-bar[data-date="${date}"]`);
                    if (bar) {
                        // Remove existing status classes
                        bar.classList.remove('taken', 'skipped', 'none');
                        // Add new status class
                        bar.classList.add(selectedStatus);
                        bar.setAttribute('data-status', selectedStatus);
                        // Update title
                        bar.title = `${new Date(date).toLocaleDateString()}: ${selectedStatus === 'none' ? 'No data' : selectedStatus.charAt(0).toUpperCase() + selectedStatus.slice(1)}`;
                    }
                    
                    // Also reload from server to ensure consistency
                    this.loadAdherenceData(medicationId, chartContainer);
                }
            });
        });
        
        // Add click handler to cancel button
        modal.querySelector('.cancel-status-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        // Close modal when clicking outside
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                document.body.removeChild(modal);
            }
        });
    },
    
    /**
     * Update historical medication status
     * @param {string} medicationId - Medication ID
     * @param {string} date - Date string (YYYY-MM-DD)
     * @param {string} status - New status (taken, skipped, none)
     * @returns {Promise} Update result
     */
    updateHistoricalMedicationStatus: async function(medicationId, date, status) {
        try {
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                throw new Error('Authentication required');
            }
            
            // Show optimistic success notification
            this.showNotification('Updating status...', 'info');
            
            // If status is 'none', we're deleting the record
            if (status === 'none') {
                const response = await apiServiceRequest(MEDICATION_API.DELETE_STATUS, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        medication_id: medicationId,
                        date: date
                    })
                });
                
                // Invalidate cache for this medication
                dataCache.adherence.delete(medicationId);
                dataCache.timestamps.adherence.delete(medicationId);
                
                this.showNotification('Status removed successfully', 'success');
                return response;
            }
            
            // Make the API call
            const response = await apiServiceRequest(MEDICATION_API.UPDATE_STATUS, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    medication_id: medicationId,
                    status: status,
                    date: date,
                    time: '12:00:00', // Default time for historical updates
                    historical: true
                })
            });
            
            // Invalidate cache for this medication
            dataCache.adherence.delete(medicationId);
            dataCache.timestamps.adherence.delete(medicationId);
            
            // Show success notification
            this.showNotification(`Historical status updated successfully`, 'success');
            
            return response;
        } catch (error) {
            console.error('Error updating historical medication status:', error);
            this.showNotification('Failed to update status: ' + error.message, 'error');
            throw error;
        }
    },
    
    /**
     * Get medication status class
     * @param {Object} medication - Medication data
     * @returns {string} Status class
     */
    getMedicationStatusClass: function(medication) {
        // Determine if medication is active, upcoming, or inactive
        if (!medication.start_date) return 'inactive';
        
        const today = new Date();
        const startDate = new Date(medication.start_date);
        
        if (medication.end_date) {
            const endDate = new Date(medication.end_date);
            if (today > endDate) return 'inactive';
        }
        
        if (today < startDate) return 'upcoming';
        
        return 'active';
    },
    
    /**
     * Batch update medication status
     * @param {string} medicationId - Medication ID
     * @param {Array} updates - Array of status updates
     */
    batchUpdateMedicationStatus: async function(medicationId, updates) {
        return await apiServiceRequest(MEDICATION_API.UPDATE_STATUS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                batch: true,
                updates: updates.map(u => ({
                    medication_id: medicationId,
                    status: u.status,
                    date: u.date,
                    time: u.time
                })),
            })
        });
    },
    
    /**
     * Show medication status modal
     * @param {Object} medication - Medication data
     */
    showMedicationStatus: function(medication) {
        const modal = document.getElementById('medication-status-modal');
        
        if (!modal) {
            return;
        }
        
        // Set medication details
        document.getElementById('status-drug-name').textContent = medication.drug_name || 'Medication';
        
        // Set next dose schedule based on frequency
        let nextDoseText = 'As needed';
        if (medication.frequency && medication.frequency !== 'as-needed') {
            // Calculate next dose time
            const today = new Date();
            let nextDoseTime = '';
            
            if (medication.reminder_times && medication.reminder_times.length > 0) {
                nextDoseTime = medication.reminder_times[0];
            } else {
                // Default times based on frequency
                switch(medication.frequency) {
                    case 'daily':
                        nextDoseTime = '09:00 AM';
                        break;
                    case 'twice-daily':
                        // Check if it's before or after noon
                        nextDoseTime = today.getHours() < 12 ? '09:00 AM' : '06:00 PM';
                        break;
                    case 'three-times-daily':
                        // Morning, noon, evening
                        if (today.getHours() < 10) nextDoseTime = '09:00 AM';
                        else if (today.getHours() < 16) nextDoseTime = '02:00 PM';
                        else nextDoseTime = '08:00 PM';
                        break;
                    case 'weekly':
                        nextDoseTime = '09:00 AM';
                        break;
                }
            }
            
            if (nextDoseTime) {
                nextDoseText = nextDoseTime;
            }
        }
        
        document.getElementById('next-dose-time').textContent = nextDoseText;
        
        // Set medication ID for status updates
        modal.setAttribute('data-medication-id', medication.id || '');
        modal.setAttribute('data-medication-name', medication.drug_name || '');
        
        // Show history loading state
        const historyList = document.getElementById('medication-status-history');
        if (historyList) {
            historyList.innerHTML = '<li>Loading adherence history...</li>';
        }
        
        // Show modal
        modal.style.display = 'block';
        
        // Load adherence history if we have an ID
        if (medication.id) {
            this.loadAdherenceHistory(medication.id);
        }
    },

    // Fix for the loadAdherenceHistory function that's causing errors

    /**
     * Improved adherence history loading with caching and better error handling
     * @param {string} medicationId - Medication ID
     */
    loadAdherenceHistory: async function(medicationId) {
        const historyList = document.getElementById('medication-status-history');
        if (!historyList) return;
        try {
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                throw new Error('Authentication required');
            }
            historyList.innerHTML = '<li>Loading adherence history...</li>';
            // Use centralized fetch
            const dataMap = await MedicationService.fetchAdherenceForMeds([medicationId]);
            const data = dataMap[medicationId];
            if (data && data.dates) {
                MedicationService.renderAdherenceHistory(historyList, data);
                if (data.status.every(s => s === 'none')) {
                    const warn = document.createElement('div');
                    warn.className = 'adherence-warning';
                    warn.textContent = 'Adherence data may be delayed or unavailable.';
                    historyList.parentElement.appendChild(warn);
                }
                return data;
            } else {
                // fallback
                const emptyData = MedicationService.generateFallbackAdherenceData();
                MedicationService.renderAdherenceHistory(historyList, emptyData);
                const warn = document.createElement('div');
                warn.className = 'adherence-warning';
                warn.textContent = 'Adherence data may be delayed or unavailable.';
                historyList.parentElement.appendChild(warn);
                return emptyData;
            }
        } catch (error) {
            console.error(`Error in adherence history flow for ${medicationId}:`, error);
            historyList.innerHTML = '<li>Failed to load adherence history. Please try again later.</li>';
            return MedicationService.generateFallbackAdherenceData();
        }
    },
    
    /**
     * Render adherence history in the UI
     * @param {HTMLElement} historyList - History list element
     * @param {Object} data - Adherence data
     */
    renderAdherenceHistory: function(historyList, data) {
        let historyHTML = '';
        
        if (data.dates && data.dates.length > 0) {
            for (let i = 0; i < data.dates.length; i++) {
                const dateObj = new Date(data.dates[i]);
                const dateStr = dateObj.toLocaleDateString();
                const status = data.status[i] || 'none';
                const statusText = status === 'none' ? 'No data' : status.charAt(0).toUpperCase() + status.slice(1);
                
                historyHTML += `
                    <li>
                        <span>${dateStr}</span>
                        <span class="status ${status}">${statusText}</span>
                    </li>
                `;
            }
        } else {
            historyHTML = '<li>No adherence history available</li>';
        }
        
        historyList.innerHTML = historyHTML;
    },
    
    /**
     * Load adherence data with enhanced error handling and fallback data
     * @param {string} medicationId - Medication ID
     * @param {HTMLElement} container - Optional chart container element
     * @returns {Promise} Promise that resolves to adherence data
     */
    loadAdherenceData: function(medicationId, container) {
        // If we have a container, show loading state
        if (container) {
            container.innerHTML = '<div class="loading-chart">Loading adherence data...</div>';
        }
        
        // Use the enhanced cache method with auto-fetching
        return dataCache.getWithFetch('adherence', medicationId, async () => {
            try {
                if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                    throw new Error('Authentication required');
                }
                
                // Check if the circuit is open for this medication
                const circuitKey = `circuit_adherence_${medicationId}`;
                if (localStorage.getItem(circuitKey)) {
                    const circuitData = JSON.parse(localStorage.getItem(circuitKey));
                    const now = Date.now();
                    
                    // If circuit is open and reset time hasn't passed, use fallback data
                    if (circuitData.state === 'OPEN' && now < circuitData.resetTime) {
                        console.log(`Circuit open for medication ${medicationId}, using fallback data`);
                        return this.generateFallbackAdherenceData();
                    }
                    
                    // If time has passed, move to half-open state
                    if (circuitData.state === 'OPEN' && now >= circuitData.resetTime) {
                        circuitData.state = 'HALF_OPEN';
                        localStorage.setItem(circuitKey, JSON.stringify(circuitData));
                    }
                }
                
                // Get days parameter
                const days = 7; // Default to 7 days
                
                console.log(`Fetching adherence data for medication ${medicationId}...`);
                const data = await apiServiceRequest(`${MEDICATION_API.GET_ADHERENCE}/${medicationId}?days=${days}`, {}, 1); // Reducing retries
                
                // Circuit closed successfully
                if (localStorage.getItem(circuitKey)) {
                    const circuitData = JSON.parse(localStorage.getItem(circuitKey));
                    circuitData.state = 'CLOSED';
                    circuitData.failures = 0;
                    localStorage.setItem(circuitKey, JSON.stringify(circuitData));
                }
                
                return data;
            } catch (error) {
                console.error(`Error loading adherence data for ${medicationId}:`, error);
                
                // Update circuit breaker state for this specific medication
                let circuitData = { state: 'CLOSED', failures: 0, resetTime: 0 };
                
                const circuitKey = `circuit_adherence_${medicationId}`;
                if (localStorage.getItem(circuitKey)) {
                    circuitData = JSON.parse(localStorage.getItem(circuitKey));
                }
                
                // Increment failure count
                circuitData.failures++;
                
                // If too many failures, open the circuit
                if (circuitData.failures >= 2) { // Lower threshold for specific endpoints
                    circuitData.state = 'OPEN';
                    circuitData.resetTime = Date.now() + 30000; // 30 second timeout
                    console.warn(`Opening circuit for medication ${medicationId} adherence data`);
                }
                
                localStorage.setItem(circuitKey, JSON.stringify(circuitData));
                
                // Return fallback data
                return this.generateFallbackAdherenceData();
            }
        }).then(data => {
            // Create the chart if we have a container
            if (container && data) {
                this.createAdherenceChart(container, data);
            }
            return data;
        }).catch(error => {
            console.error(`Cache fetch failed for ${medicationId}:`, error);
            const fallbackData = this.generateFallbackAdherenceData();
            
            // Create the chart with fallback data if we have a container
            if (container) {
                this.createAdherenceChart(container, fallbackData);
            }
            
            return fallbackData;
        });
    },
    
    /**
     * Generate fallback adherence data when the API is unavailable
     * @returns {Object} Fallback adherence data
     */
    generateFallbackAdherenceData: function() {
        const dates = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            dates.push(date.toISOString().split('T')[0]);
        }
        
        return { 
            dates: dates,
            status: Array(7).fill('none')
        };
    },
    
    /**
     * Enhanced function to load bulk adherence data with circuit breaker
     * @param {Array} medicationIds - Array of medication IDs
     * @param {number} days - Number of days to fetch
     * @returns {Promise} Promise that resolves to adherence data map
     */
    loadBulkAdherenceData: async function(medicationIds, days = 7) {
        try {
            if (!window.AuthService || !window.AuthService.isAuthenticated() || !medicationIds || medicationIds.length === 0) {
                return {};
            }
            
            // Remove duplicate IDs
            const uniqueIds = [...new Set(medicationIds)];
            
            // Filter out medications with open circuits
            const availableMedIds = [];
            const circuitOpenMedIds = [];
            
            uniqueIds.forEach(id => {
                const circuitKey = `circuit_adherence_${id}`;
                if (localStorage.getItem(circuitKey)) {
                    const circuitData = JSON.parse(localStorage.getItem(circuitKey));
                    const now = Date.now();
                    
                    if (circuitData.state === 'OPEN' && now < circuitData.resetTime) {
                        circuitOpenMedIds.push(id);
                    } else {
                        availableMedIds.push(id);
                    }
                } else {
                    availableMedIds.push(id);
                }
            });
            
            // Check if all IDs are already in cache and valid
            const allCached = availableMedIds.every(id => dataCache.isValid('adherence', id));
            
            // Prepare results object
            const result = {};
            
            // Add cached data for all medications (if available)
            uniqueIds.forEach(id => {
                if (dataCache.isValid('adherence', id)) {
                    result[id] = dataCache.get('adherence', id);
                }
            });
            
            // Add fallback data for circuit-open medications
            circuitOpenMedIds.forEach(id => {
                if (!result[id]) {
                    result[id] = this.generateFallbackAdherenceData();
                }
            });
            
            // If everything is cached or circuit-open, we're done
            if (allCached || availableMedIds.length === 0) {
                return result;
            }
            
            // Group medications into smaller batches to avoid overloading the server
            const batchSize = 3; // Process just 3 medications at a time
            const batches = [];
            
            for (let i = 0; i < availableMedIds.length; i += batchSize) {
                batches.push(availableMedIds.slice(i, i + batchSize));
            }
            
            // Process each batch sequentially with delay
            for (const batch of batches) {
                try {
                    const batchResult = await apiServiceRequest(MEDICATION_API.BULK_ADHERENCE, {
                        method: 'POST',
                        body: JSON.stringify({
                          medication_ids: batch,
                          days: days
                        })
                      });
                    
                    if (batchResult && batchResult.adherence_data) {
                        // Store each medication's data in cache and result
                        Object.keys(batchResult.adherence_data).forEach(medId => {
                            dataCache.set('adherence', batchResult.adherence_data[medId], medId);
                            result[medId] = batchResult.adherence_data[medId];
                            
                            // Reset circuit if it was in HALF_OPEN state
                            const circuitKey = `circuit_adherence_${medId}`;
                            if (localStorage.getItem(circuitKey)) {
                                const circuitData = JSON.parse(localStorage.getItem(circuitKey));
                                if (circuitData.state === 'HALF_OPEN') {
                                    circuitData.state = 'CLOSED';
                                    circuitData.failures = 0;
                                    localStorage.setItem(circuitKey, JSON.stringify(circuitData));
                                }
                            }
                        });
                    }
                    
                    // Delay between batches to avoid rate limiting
                    if (batches.length > 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    console.error('Error loading bulk adherence data batch:', error);
                    
                    // Update circuit breaker for failed medications
                    batch.forEach(medId => {
                        let circuitData = { state: 'CLOSED', failures: 0, resetTime: 0 };
                        const circuitKey = `circuit_adherence_${medId}`;
                        
                        if (localStorage.getItem(circuitKey)) {
                            circuitData = JSON.parse(localStorage.getItem(circuitKey));
                        }
                        
                        circuitData.failures++;
                        
                        if (circuitData.failures >= 2) {
                            circuitData.state = 'OPEN';
                            circuitData.resetTime = Date.now() + 30000; // 30 second timeout
                        }
                        
                        localStorage.setItem(circuitKey, JSON.stringify(circuitData));
                        
                        // Add fallback data for failed medications
                        if (!result[medId]) {
                            result[medId] = this.generateFallbackAdherenceData();
                        }
                    });
                }
            }
            
            // Fill in fallback data for any medications without data
            uniqueIds.forEach(id => {
                if (!result[id]) {
                    result[id] = this.generateFallbackAdherenceData();
                }
            });
            
            return result;
        } catch (error) {
            console.error('Error in bulk adherence loading:', error);
            
            // Create a fallback result for all medications
            const fallbackResult = {};
            medicationIds.forEach(id => {
                fallbackResult[id] = this.generateFallbackAdherenceData();
            });
            
            return fallbackResult;
        }
    },
    
    /**
     * Improved medication history loading with caching
     */
    loadMedicationHistory: async function() {
        if (!window.AuthService?.isAuthenticated()) return;

        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;

        historyContainer.innerHTML = '<p>Loading medication history...</p>';

        try {
            const data = await apiServiceRequest(MEDICATION_API.GET_ALL); // CORRECTED
            this.renderMedicationHistory(data.medications || []);
        } catch (error) {
            console.error('Error loading medication history:', error);
            historyContainer.innerHTML = '<p>Failed to load medication history.</p>';
        }
    },
    
    /**
     * Render medication history in the UI
     * @param {Array} medications - User's medication history
     */
    renderMedicationHistory: function(medications) {
        const historyContainer = document.getElementById('history-container');
        
        if (!historyContainer) {
            console.error('Medication history container not found');
            return;
        }
        
        if (!medications || medications.length === 0) {
            historyContainer.innerHTML = `
                <div class="no-history-message">
                    <i class="fas fa-history icon-large"></i>
                    <p>You haven't tracked any medications yet.</p>
                </div>
            `;
            return;
        }
        
        let historyHTML = '<h3>Your Medication History</h3>';
        historyHTML += '<div class="history-list">';
        
        medications.forEach(medication => {
            const startDate = new Date(medication.start_date).toLocaleDateString();
            const endDate = medication.end_date ? new Date(medication.end_date).toLocaleDateString() : 'Present';
            const statusClass = this.getMedicationStatusClass(medication);
            
            historyHTML += `
                <div class="history-item ${statusClass}">
                    <div class="history-header">
                        <span class="medication-name">${medication.drug_name}</span>
                        <span class="medication-status ${statusClass}">${statusClass}</span>
                    </div>
                    <div class="medication-details">
                        <p><strong>Dosage:</strong> ${medication.dosage || 'Not specified'}</p>
                        <p><strong>Frequency:</strong> ${medication.frequency}</p>
                        <p><strong>Duration:</strong> ${startDate} - ${endDate}</p>
                    </div>
                    <div class="medication-actions">
                        <button class="view-adherence-btn" data-medication-id="${medication.id}">
                            View Adherence
                        </button>
                        <button class="edit-medication-btn" data-medication-id="${medication.id}">
                            Edit
                        </button>
                    </div>
                </div>
            `;
        });
        
        historyHTML += '</div>';
        historyContainer.innerHTML = historyHTML;
        
        // Add click handlers
        historyContainer.querySelectorAll('.view-adherence-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const medicationId = button.getAttribute('data-medication-id');
                await this.loadAdherenceData(medicationId, historyContainer);
            });
        });
        
        historyContainer.querySelectorAll('.edit-medication-btn').forEach(button => {
            button.addEventListener('click', () => {
                const medicationId = button.getAttribute('data-medication-id');
                this.showEditMedicationModal(medicationId);
            });
        });
    },
    
    /**
     * Show edit medication modal
     * @param {Object} medication - Medication data
     */
    showEditMedicationModal: function(medication) {
        // Populate form with medication data
        document.getElementById('tracking-drug-name').value = medication.drug_name || '';
        document.getElementById('tracking-brand-name').value = medication.brand_name || '';
        document.getElementById('tracking-dosage').value = medication.dosage || '';
        document.getElementById('tracking-frequency').value = medication.frequency || 'daily';
        document.getElementById('tracking-start-date').value = medication.start_date || '';
        document.getElementById('tracking-end-date').value = medication.end_date || '';
        
        // Handle reminder times
        const reminderEnabled = medication.reminder_enabled || (medication.reminder_times && medication.reminder_times.length > 0);
        document.getElementById('tracking-reminder-enabled').checked = reminderEnabled;
        
        const reminderSection = document.getElementById('reminder-times-section');
        const reminderTimesContainer = document.getElementById('reminder-times-container');
        
        if (reminderSection) {
            reminderSection.style.display = reminderEnabled ? 'block' : 'none';
        }
        
        if (reminderTimesContainer) {
            reminderTimesContainer.innerHTML = '';
            
            if (medication.reminder_times && medication.reminder_times.length > 0) {
                medication.reminder_times.forEach(time => {
                    const timeContainer = document.createElement('div');
                    timeContainer.className = 'time-container';
                    
                    const timeInput = document.createElement('input');
                    timeInput.type = 'time';
                    timeInput.className = 'reminder-time';
                    timeInput.required = true;
                    timeInput.value = time;
                    
                    const removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.className = 'remove-time-btn';
                    removeBtn.innerHTML = '&times;';
                    removeBtn.addEventListener('click', function() {
                        this.parentElement.remove();
                    });
                    
                    timeContainer.appendChild(timeInput);
                    timeContainer.appendChild(removeBtn);
                    reminderTimesContainer.appendChild(timeContainer);
                });
            } else {
                // Add one default time input
                const timeContainer = document.createElement('div');
                timeContainer.className = 'time-container';
                
                const timeInput = document.createElement('input');
                timeInput.type = 'time';
                timeInput.className = 'reminder-time';
                timeInput.required = true;
                timeInput.value = '09:00';
                
                timeContainer.appendChild(timeInput);
                reminderTimesContainer.appendChild(timeContainer);
            }
        }
        
        // Update modal title
        const modalTitle = document.querySelector('#medication-tracking-modal h2');
        if (modalTitle) {
            modalTitle.textContent = 'Edit Medication';
        }
        
        // Update submit button text
        const submitButton = document.querySelector('#medication-tracking-form button[type="submit"]');
        if (submitButton) {
            submitButton.textContent = 'Update Medication';
        }
        
        // Save medication ID as data attribute on the form
        const trackingForm = document.getElementById('medication-tracking-form');
        if (trackingForm) {
            trackingForm.setAttribute('data-medication-id', medication.id || '');
        }
        
        // Show the modal
        const modal = document.getElementById('medication-tracking-modal');
        if (modal) {
            modal.style.display = 'block';
        }
    },
    
    /**
     * Load and display a specific recommendation result
     * @param {string} jobId - Job ID of the recommendation
     */
    loadAndDisplayResult: async function(jobId) {
        try {
            // Show loading indicator
            const resultsDiv = document.getElementById('results');
            if (resultsDiv) {
                resultsDiv.innerHTML = '<div class="spinner"></div>';
            }
            
            // Use debounce to prevent simultaneous requests
            const result = await apiServiceRequest(`/api/v1/status/${jobId}`);
            
            if (result.status !== 'done' || !result.result) {
                this.showNotification('Result not available', 'error');
                return;
            }
            
            // Switch to the home section if not already there
            const sections = document.querySelectorAll('.app-section');
            sections.forEach(section => section.classList.remove('active'));
            document.getElementById('home-section').classList.add('active');
            
            // Update the navigation
            document.querySelectorAll('.main-nav a').forEach(link => link.classList.remove('active'));
            document.getElementById('nav-home').classList.add('active');
            
            // Use the app's displayResults function to show the result
            if (window.displayResults) {
                // Clear results first
                if (resultsDiv) {
                    resultsDiv.innerHTML = '';
                }
                
                // Display the results using the main app's function
                window.displayResults(result.result);
                
                // Scroll to results
                if (resultsDiv) {
                    resultsDiv.scrollIntoView({ behavior: 'smooth' });
                }
                
                // Show success notification
                this.showNotification('Past recommendation loaded successfully');
                
                // Also update URL to reflect the loaded job
                const url = new URL(window.location);
                url.searchParams.set('job_id', jobId);
                window.history.pushState({}, '', url);
            } else {
                // Fallback if the main app's displayResults function is not available
                // Redirect to the job with URL parameter
                window.location.href = `/?job_id=${jobId}#results`;
            }
        } catch (error) {
            console.error('Error loading result:', error);
            this.showNotification('Failed to load result: ' + error.message, 'error');
            
            // Clear loading indicator
            const resultsDiv = document.getElementById('results');
            if (resultsDiv) {
                resultsDiv.innerHTML = '<p class="error-message">Failed to load results. Please try again.</p>';
            }
        }
    },
    
    /**
     * Show a notification message
     * @param {string} message - Notification message
     * @param {string} type - Notification type (success, error, warning)
     */
    showNotification: function(message, type = 'success') {
        // Check if notification container exists, create if not
        let notificationContainer = document.getElementById('notification-container');
        
        if (!notificationContainer) {
            notificationContainer = document.createElement('div');
            notificationContainer.id = 'notification-container';
            document.body.appendChild(notificationContainer);
        }
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add close button
        const closeButton = document.createElement('button');
        closeButton.className = 'notification-close';
        closeButton.innerHTML = '&times;';
        closeButton.addEventListener('click', function() {
            notification.remove();
        });
        
        notification.appendChild(closeButton);
        notificationContainer.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
    },
    
    // Add timezone handling
    getUserTimezone: async function() {
        try {
            // Corrected endpoint path
            const response = await apiServiceRequest('/user-timezone'); 
            if (response.error) throw new Error(response.error);
            return response.timezone;
        } catch (error) {
            console.error('Error getting user timezone:', error);
            return 'US/Eastern'; // Fallback timezone
        }
    },
    
    // Initialize timezone handling
    initTimezone: async function() {
        try {
            const timezone = await this.getUserTimezone();
            
            // Update timezone select if it exists
            const timezoneSelect = document.getElementById('tracking-timezone');
            if (timezoneSelect) {
                // Populate timezone options if not already done
                if (timezoneSelect.options.length <= 1) {
                    const timezones = Intl.supportedValuesOf('timeZone');
                    timezones.forEach(tz => {
                        const option = document.createElement('option');
                        option.value = tz;
                        option.text = tz;
                        timezoneSelect.appendChild(option);
                    });
                }
                
                // Set current timezone
                timezoneSelect.value = timezone;
            }
            
            return timezone;
        } catch (error) {
            console.error('Error initializing timezone:', error);
            return 'US/Eastern';
        }
    },
    
    loadQueryHistory: async function() {
        if (!window.AuthService?.isAuthenticated()) return;

        const queryHistoryContainer = document.getElementById('query-history-container');
        if (!queryHistoryContainer) return;

        queryHistoryContainer.innerHTML = '<p>Loading query history...</p>';

        try {
            const data = await apiServiceRequest(MEDICATION_API.QUERY_HISTORY); // CORRECTED
            this.renderQueryHistory(data.history || []);
        } catch (error) {
            console.error('Error loading query history:', error);
            queryHistoryContainer.innerHTML = '<p>Failed to load query history.</p>';
        }
    },

    renderQueryHistory: function(history) {
        const container = document.getElementById('query-history-container');
        if (!container) return;
        if (!history || history.length === 0) {
            container.innerHTML = '<p>No query history found.</p>';
            return;
        }

        let html = '<ul>';
        history.forEach(item => {
            // Use query_text and job_id from the backend
            html += `<li>
                <a href="#" class="query-history-link" data-job-id="${item.job_id}">
                    ${item.user_query || 'View Query'}
                </a>
                <small>${new Date(item.created_at).toLocaleString()}</small>
            </li>`;
        });
        html += '</ul>';
        container.innerHTML = html;

        // Add event listeners for the new links
        container.querySelectorAll('.query-history-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const jobId = e.currentTarget.dataset.jobId;
                const historyItem = history.find(h => h.job_id === jobId);
                if (historyItem && historyItem.results) {
                    // Assuming results are stored in a way that displayResults can handle
                    window.displayResults(historyItem.results); 
                } else {
                    alert('Could not retrieve results for this query.');
                }
            });
        });
    },
    
    // ... (update all other functions to use apiServiceRequest)

    deleteMedication: async function(medicationId) {
        try {
            await apiServiceRequest(`${MEDICATION_API.DELETE_MEDICATION}/${medicationId}`, { method: 'DELETE' });
            
            // Lightweight local update
            const currentMeds = dataCache.get('medications');
            const updatedMeds = currentMeds.filter(m => m.id !== medicationId);
            dataCache.set('medications', updatedMeds);
            this.renderMedicationTracking(updatedMeds);
            this.updateTodaySchedule(updatedMeds);

            this.showNotification('Medication deleted successfully.', 'success');
        } catch (error) {
            console.error('Error deleting medication:', error);
            this.showNotification('Failed to delete medication.', 'error');
        }
    },

    fetchAdherenceForMeds: fetchAdherenceForMeds
};

window.MedicationService = MedicationService;
  
// --- CENTRALIZED ADHERENCE FETCHING UTILITY ---
/**
 * Fetch adherence data for multiple medications efficiently.
 * Always uses cache first, then bulk fetch for missing/expired.
 * Notifies all waiting UI components.
 * @param {Array<string>} medIds - Medication IDs
 * @param {number} days - Number of days to fetch
 * @returns {Promise<Object>} Map of medId -> adherence data
 */
async function fetchAdherenceForMeds(medIds, days = 7) {
    if (!window.AuthService || !window.AuthService.isAuthenticated() || !medIds || medIds.length === 0) {
        return {};
    }
    // Remove duplicates
    const uniqueIds = [...new Set(medIds)];
    // Check cache
    const cached = {};
    const toFetch = [];
    uniqueIds.forEach(id => {
        if (dataCache.isValid('adherence', id)) {
            cached[id] = dataCache.get('adherence', id);
        } else {
            toFetch.push(id);
        }
    });
    if (toFetch.length === 0) return cached;
    // Use bulk fetch for all missing
    let fetched = {};
    try {
        fetched = await MedicationService.loadBulkAdherenceData(toFetch, days);
    } catch (e) {
        // fallback: mark all as fallback data
        toFetch.forEach(id => {
            fetched[id] = MedicationService.generateFallbackAdherenceData();
        });
    }
    // Merge and return
    return { ...cached, ...fetched };
}
  
// --- DEBOUNCED CACHE INVALIDATION ---
const debouncedInvalidateAdherence = debounce((medId) => {
    dataCache.clear('adherence', medId);
}, 300);
MedicationService.debouncedInvalidateAdherence = debouncedInvalidateAdherence;
  
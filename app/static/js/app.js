/**
 * Drug Recommendation Application
 * Client-side JavaScript for handling API requests and UI interactions
 */

import { apiRequest } from './apiService.js';

// API Endpoints
const API_BASE_URL = '/api/v1';
const API_ENDPOINTS = {
  RECOMMENDATION: `${API_BASE_URL}/recommendation`,
  STATUS: `${API_BASE_URL}/status`,
  PHARMACY: `${API_BASE_URL}/pharmacy/nearby`
};

// DOM Elements
let elements = {};

/**
 * Initialize the application
 */
function initApp() {
  // Get DOM elements
  elements = {
    symptomsInput: document.getElementById('symptoms'),
    submitButton: document.getElementById('submit-button'),
    resultsDiv: document.getElementById('results'),
    pharmacyButton: document.getElementById('pharmacy-button'),
    pharmacyResults: document.getElementById('pharmacy-results'),
    zipCodeInput: document.getElementById('zip-code')
  };

  // Add event listeners
  if (elements.submitButton) {
    elements.submitButton.addEventListener('click', getRecommendation);
  }
  
  if (elements.symptomsInput) {
    elements.symptomsInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        getRecommendation();
      }
    });
  }
  
  if (elements.pharmacyButton) {
    elements.pharmacyButton.addEventListener('click', findNearbyPharmacies);
  }

  // Check for browser support
  if (!fetch) {
    showError('Your browser does not support the required features for this application.');
    return;
  }
  
  // Check URL for job_id parameter
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('job_id');
  
  if (jobId) {
    // Load results for the specified job
    pollJobStatus(jobId);
  }
  
  // Update request limit display for anonymous users
  if (window.AuthService && !window.AuthService.isAuthenticated()) {
    window.AuthService.checkAnonymousLimit();
  }
  
  console.log('Drug recommendation app initialized');
}

/**
 * Submit symptoms and get recommendation
 */
async function getRecommendation() {
  try {
    // Validate input
    const symptoms = elements.symptomsInput.value.trim();
    if (!symptoms) {
      showError('Please enter your symptoms');
      return;
    }
    
    // Disable button and show loading state
    setLoading(true);
    
    // Clear previous results
    clearResults();
    showStatusMessage('Submitting your request...', 'status-queued');
    
    // Prepare request data
    const requestData = { symptoms };
    
    // Add user profile data if authenticated
    if (window.AuthService && window.AuthService.isAuthenticated()) {
      const userInfo = window.AuthService.getCurrentUser();
      
      if (userInfo && userInfo.profile) {
        requestData.user_profile = userInfo.profile;
      }
    }
    
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Add authorization header if authenticated
    if (window.AuthService && window.AuthService.isAuthenticated()) {
      headers['Authorization'] = `Bearer ${window.AuthService.getAccessToken()}`;
    }
    
    // Submit request to API
    const response = await fetch(API_ENDPOINTS.RECOMMENDATION, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestData)
    });
    
    // Handle non-successful response
    if (!response.ok) {
      const errorData = await response.json();
      
      // Special handling for rate limit errors
      if (response.status === 429) {
        throw new Error(errorData.message || 'Rate limit exceeded. Please register for an account to make more requests.');
      }
      
      throw new Error(errorData.error || 'Failed to submit request');
    }
    
    // Get job ID from response
    const jobData = await response.json();
    console.log('Job submitted:', jobData);
    
    if (!jobData.job_id) {
      throw new Error('No job ID returned from server');
    }
    
    // Update URL with job_id parameter for sharing/bookmarking
    const url = new URL(window.location);
    url.searchParams.set('job_id', jobData.job_id);
    window.history.pushState({}, '', url);
    
    // Start polling for job status
    await pollJobStatus(jobData.job_id);
    
  } catch (error) {
    console.error('Error:', error);
    showError(error.message || 'An unexpected error occurred');
    setLoading(false);
    
    // Check if error is due to authentication and show login prompt
    if (error.message && error.message.includes('rate limit') && 
        (!window.AuthService || !window.AuthService.isAuthenticated())) {
      showLoginPrompt();
    }
  }
}

/**
 * Poll for job status until complete
 * @param {string} jobId - Job identifier
 */
async function pollJobStatus(jobId) {
  try {
    // Show polling status
    showStatusMessage('Processing your symptoms...', 'status-processing');
    
    // Function to check status
    const checkStatus = async () => {
      console.log(`Checking status for job ${jobId}...`);
      
      // Prepare headers
      const headers = {
        'Content-Type': 'application/json'
      };
      
      // Add authorization header if authenticated
      if (window.AuthService && window.AuthService.isAuthenticated()) {
        headers['Authorization'] = `Bearer ${window.AuthService.getAccessToken()}`;
      }
      
      // Get status from API
      const statusResponse = await fetch(`${API_ENDPOINTS.STATUS}/${jobId}`, {
        headers
      });
      
      if (!statusResponse.ok) {
        throw new Error(`Failed to get job status: ${statusResponse.status}`);
      }
      
      // Parse response
      const statusData = await statusResponse.json();
      console.log('Job status:', statusData);
      
      // Handle different statuses
      if (statusData.status === 'queued' || statusData.status === 'processing') {
        // Still processing, update UI
        const message = statusData.status === 'queued' 
          ? 'Waiting in queue...' 
          : 'Processing your symptoms...';
        
        showStatusMessage(message, `status-${statusData.status}`);
        
        // Wait and check again (exponential backoff)
        const waitTime = statusData.status === 'queued' ? 2000 : 1000;
        setTimeout(checkStatus, waitTime);
      } 
      else if (statusData.status === 'done' && statusData.result) {
        // Job complete, display results
        displayResults(statusData.result);
        setLoading(false);
        
        // Scroll to results
        elements.resultsDiv.scrollIntoView({ behavior: 'smooth' });
        
        // If anonymous user, update remaining requests counter
        // Note: The count is now incremented on the server only after
        // a successful recommendation is delivered
        if (window.AuthService && !window.AuthService.isAuthenticated()) {
          window.AuthService.checkAnonymousLimit();
        }
      } 
      else if (statusData.status === 'failed') {
        // Job failed
        showError(statusData.error || 'Processing failed');
        setLoading(false);
      }
      else {
        // Unexpected status
        showError(`Unexpected status: ${statusData.status}`);
        setLoading(false);
      }
    };
    
    // Start polling
    await checkStatus();
    
  } catch (error) {
    console.error('Error polling status:', error);
    showError(error.message || 'Failed to get results');
    setLoading(false);
  }
}

/**
 * Display recommendation results
 * @param {object} data - Results data
 */
function displayResults(data) {
  // Clear status message
  clearResults();
  
  // Check if data is valid
  if (!data.recommendations || !Array.isArray(data.recommendations)) {
    showError('Invalid response from server');
    return;
  }
  
  // Add subscription info if present
  if (data.metadata) {
    const metadataDiv = document.createElement('div');
    metadataDiv.className = 'metadata';
    
    if (data.metadata.subscription_tier) {
      const tierBadge = document.createElement('span');
      tierBadge.className = `tier-badge ${data.metadata.subscription_tier}`;
      // tierBadge.textContent = data.metadata.subscription_tier.toUpperCase();
      
      const tierInfo = document.createElement('p');
      // tierInfo.innerHTML = `Results provided by <strong>${data.metadata.model_used}</strong> model`;
      
      metadataDiv.appendChild(tierBadge);
      metadataDiv.appendChild(tierInfo);
    }
    
    elements.resultsDiv.appendChild(metadataDiv);
  }
  
  // Process each item in the results
  data.recommendations.forEach((item, index) => {
    // Check if first item is Symptom Assessment (new enhanced feature)
    if (index === 0 && item["Symptom Assessment"]) {
      const assessment = item["Symptom Assessment"];
      const assessmentDiv = document.createElement('div');
      assessmentDiv.className = 'symptom-assessment fade-in';

      // Header
      const header = document.createElement('h3');
      header.innerHTML = '<i class="fas fa-stethoscope"></i> Symptom Analysis';
      assessmentDiv.appendChild(header);

      // Severity Badge
      const severityContainer = document.createElement('div');
      severityContainer.className = 'severity-container';

      const severityBadge = document.createElement('div');
      severityBadge.className = `severity-badge ${assessment.severity}`;
      const severityIcon = assessment.severity === 'mild' ? 'fa-check-circle' :
                          assessment.severity === 'moderate' ? 'fa-exclamation-circle' :
                          'fa-exclamation-triangle';
      severityBadge.innerHTML = `<i class="fas ${severityIcon}"></i> ${assessment.severity.toUpperCase()}`;
      severityContainer.appendChild(severityBadge);
      assessmentDiv.appendChild(severityContainer);

      // Red Flags (if any)
      if (assessment.redFlags && assessment.redFlags.length > 0) {
        const redFlagsDiv = document.createElement('div');
        redFlagsDiv.className = assessment.doctorUrgency === 'immediate' ?
                                'red-flags-container emergency' : 'red-flags-container';

        const redFlagsHeader = document.createElement('div');
        redFlagsHeader.className = 'red-flags-header';
        redFlagsHeader.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Warning Signs Detected';
        redFlagsDiv.appendChild(redFlagsHeader);

        const redFlagsList = document.createElement('ul');
        redFlagsList.className = 'red-flags-list';
        assessment.redFlags.forEach(flag => {
          const li = document.createElement('li');
          li.textContent = flag;
          redFlagsList.appendChild(li);
        });
        redFlagsDiv.appendChild(redFlagsList);
        assessmentDiv.appendChild(redFlagsDiv);
      }

      // Doctor Recommendation
      if (assessment.seekDoctor) {
        const doctorDiv = document.createElement('div');
        doctorDiv.className = assessment.doctorUrgency === 'immediate' ?
                             'doctor-recommendation urgent' : 'doctor-recommendation';

        const doctorHeader = document.createElement('div');
        doctorHeader.className = 'doctor-header';
        doctorHeader.innerHTML = '<i class="fas fa-user-md doctor-icon"></i>';

        const urgencyTitle = document.createElement('div');
        urgencyTitle.className = 'doctor-urgency';

        const urgencyMessages = {
          'immediate': '🚨 Seek Immediate Medical Attention',
          'within_24h': 'See a Doctor Within 24 Hours',
          'within_week': 'Schedule a Doctor Visit This Week',
          'not_needed': 'Monitor Your Symptoms'
        };
        urgencyTitle.textContent = urgencyMessages[assessment.doctorUrgency] || 'Consult a Healthcare Provider';
        doctorHeader.appendChild(urgencyTitle);
        doctorDiv.appendChild(doctorHeader);

        const doctorMessage = document.createElement('div');
        doctorMessage.className = 'doctor-message';
        doctorMessage.textContent = assessment.reasoning;
        doctorDiv.appendChild(doctorMessage);

        const urgencyBadge = document.createElement('span');
        urgencyBadge.className = `urgency-badge ${assessment.doctorUrgency}`;
        urgencyBadge.textContent = assessment.doctorUrgency.replace('_', ' ');
        doctorDiv.appendChild(urgencyBadge);

        // Emergency CTA for immediate cases
        if (assessment.doctorUrgency === 'immediate') {
          const emergencyCTA = document.createElement('div');
          emergencyCTA.className = 'emergency-cta';
          emergencyCTA.innerHTML = `
            <h3><i class="fas fa-ambulance"></i> Emergency Situation</h3>
            <p>Call 911 or go to the nearest emergency room immediately</p>
            <a href="tel:911" class="emergency-cta-button">
              <i class="fas fa-phone"></i> Call 911
            </a>
          `;
          doctorDiv.appendChild(emergencyCTA);
        }

        assessmentDiv.appendChild(doctorDiv);
      }

      // Reasoning
      if (assessment.reasoning && !assessment.seekDoctor) {
        const reasoningDiv = document.createElement('div');
        reasoningDiv.className = 'assessment-reasoning';
        reasoningDiv.innerHTML = `<i class="fas fa-lightbulb"></i> ${assessment.reasoning}`;
        assessmentDiv.appendChild(reasoningDiv);
      }

      elements.resultsDiv.appendChild(assessmentDiv);
      return; // Skip to next iteration
    }

    // Feature 4: Check if this is Treatment Plan
    if (item["Treatment Plan"]) {
      const plan = item["Treatment Plan"];
      const planDiv = document.createElement('div');
      planDiv.className = 'treatment-plan bounce-in';

      // Header
      const header = document.createElement('h3');
      header.innerHTML = '<i class="fas fa-calendar-check"></i> Your Treatment Plan';
      planDiv.appendChild(header);

      // Duration Badge
      if (plan.duration) {
        const durationBadge = document.createElement('div');
        durationBadge.className = 'treatment-duration';
        durationBadge.innerHTML = `<i class="fas fa-clock"></i> ${plan.duration}`;
        planDiv.appendChild(durationBadge);
      }

      // Timeline
      if (plan.timeline) {
        const timeline = document.createElement('div');
        timeline.className = 'treatment-timeline';

        const timeIcons = {
          morning: 'fa-sun',
          afternoon: 'fa-cloud-sun',
          evening: 'fa-cloud-moon',
          night: 'fa-moon'
        };

        Object.keys(plan.timeline).forEach((day, index) => {
          const dayData = plan.timeline[day];
          const dayDiv = document.createElement('div');
          dayDiv.className = index === 0 ? 'treatment-day active' : 'treatment-day';

          // Day Header
          const dayHeader = document.createElement('div');
          dayHeader.className = 'day-header';

          const dayNumber = document.createElement('div');
          dayNumber.className = 'day-number';
          dayNumber.textContent = day;
          dayHeader.appendChild(dayNumber);

          dayDiv.appendChild(dayHeader);

          // Day Schedule
          const schedule = document.createElement('div');
          schedule.className = 'day-schedule';

          ['morning', 'afternoon', 'evening', 'night'].forEach(timeOfDay => {
            if (dayData[timeOfDay]) {
              const timeSlot = document.createElement('div');
              timeSlot.className = `time-slot ${timeOfDay}`;

              const timeHeader = document.createElement('div');
              timeHeader.className = 'time-slot-header';
              timeHeader.innerHTML = `<i class="fas ${timeIcons[timeOfDay]}"></i> ${timeOfDay}`;
              timeSlot.appendChild(timeHeader);

              const timeContent = document.createElement('div');
              timeContent.className = 'time-slot-content';
              timeContent.textContent = dayData[timeOfDay];
              timeSlot.appendChild(timeContent);

              schedule.appendChild(timeSlot);
            }
          });

          dayDiv.appendChild(schedule);

          // Expected Progress
          if (dayData.expectedProgress) {
            const progress = document.createElement('div');
            progress.className = 'expected-progress';
            progress.innerHTML = `
              <strong><i class="fas fa-chart-line"></i> Expected Progress:</strong>
              <p>${dayData.expectedProgress}</p>
            `;
            dayDiv.appendChild(progress);
          }

          timeline.appendChild(dayDiv);
        });

        planDiv.appendChild(timeline);
      }

      // When to Reassess
      if (plan.whenToReassess) {
        const reassessDiv = document.createElement('div');
        reassessDiv.className = 'treatment-reassessment';
        reassessDiv.innerHTML = `
          <div class="reassessment-title">
            <i class="fas fa-user-md"></i> When to Seek Medical Help
          </div>
          <div class="reassessment-text">${plan.whenToReassess}</div>
        `;
        planDiv.appendChild(reassessDiv);
      }

      // Improvement Signs
      if (plan.improvementSigns && plan.improvementSigns.length > 0) {
        const signsDiv = document.createElement('div');
        signsDiv.className = 'improvement-signs';

        const signsHeader = document.createElement('h4');
        signsHeader.innerHTML = '<i class="fas fa-heartbeat"></i> Signs of Improvement';
        signsDiv.appendChild(signsHeader);

        const signsList = document.createElement('div');
        signsList.className = 'improvement-list';

        plan.improvementSigns.forEach(sign => {
          const signItem = document.createElement('div');
          signItem.className = 'improvement-item';
          signItem.textContent = sign;
          signsList.appendChild(signItem);
        });

        signsDiv.appendChild(signsList);
        planDiv.appendChild(signsDiv);
      }

      elements.resultsDiv.appendChild(planDiv);
      return;
    }

    // Check if this is First Aid (could be index 0 or 1 depending on if Symptom Assessment exists)
    if (item["First Aid"]) {
      // Special formatting for First Aid
      const firstAidDiv = document.createElement('div');
      firstAidDiv.className = 'first-aid';

      // First Aid recommendations
      const firstAid = item["First Aid"];
      const possibleExplanation = document.createElement('p');
        possibleExplanation.innerHTML = `<strong>What might be going on inside your body?</strong><br><br>${firstAid.possibleExplanation}`;
        firstAidDiv.appendChild(possibleExplanation);

      // First Aid title
      const title = document.createElement('h3');
      title.innerHTML = '🩹 First Aid Recommendation';
      firstAidDiv.appendChild(title);
      
      if (firstAid) {
        if (firstAid.emergency){
          firstAidDiv.classList.add('emergency');  
          const cautionIcon = document.createElement('h3');
          cautionIcon.innerHTML = '⚠️ Emergency Situation';
          firstAidDiv.insertBefore(cautionIcon, firstAidDiv.firstChild);
          const emergencyP = document.createElement('p');
          emergencyP.innerHTML = `<strong>Emergency:</strong> ${firstAid.emergency}`;
          firstAidDiv.appendChild(emergencyP); 
        }

        const possibleExplanation = document.createElement('p');
        possibleExplanation.innerHTML = `<strong>What may be going on inside your body?</strong> ${firstAid.possibleExplanation}`;
        firstAidDiv.appendChild(possibleExplanation);

        const quickestP = document.createElement('p');
        quickestP.innerHTML = `<strong>Quickest:</strong> ${firstAid.quickest}`;
        firstAidDiv.appendChild(quickestP);
        
        const cheapestP = document.createElement('p');
        cheapestP.innerHTML = `<strong>Cheapest:</strong> ${firstAid.cheapest}`;
        firstAidDiv.appendChild(cheapestP);
        
        const accessibleP = document.createElement('p');
        accessibleP.innerHTML = `<strong>Accessible:</strong> ${firstAid.accessible}`;
        firstAidDiv.appendChild(accessibleP);
      }
      
      // Warning if no medications recommended
      if (item["Reasons for no medications"]) {
        const warningDiv = document.createElement('div');
        warningDiv.className = 'no-meds-warning';
        
        const warningTitle = document.createElement('strong');
        warningTitle.innerHTML = '⚠️ Reasons for No Medications:';
        warningDiv.appendChild(warningTitle);
        
        const warningText = document.createElement('p');
        warningText.textContent = item["Reasons for no medications"];
        warningDiv.appendChild(warningText);
        
        firstAidDiv.appendChild(warningDiv);
      }
      
      elements.resultsDiv.appendChild(firstAidDiv);
    } else {
      // Standard drug card format
      const drugDiv = document.createElement('div');
      drugDiv.className = 'drug-card';
      
      // Drug name
      const nameHeading = document.createElement('h4');
      nameHeading.className = 'drug-name';
      nameHeading.textContent = item["Scientific Name"];
      drugDiv.appendChild(nameHeading);

      // Feature 2: Contraindication Checker
      if (item["Contraindications"]) {
        const contra = item["Contraindications"];

        // Add safety badge
        const safetyBadge = document.createElement('div');
        if (contra.safe) {
          safetyBadge.className = 'safety-badge safe';
          safetyBadge.innerHTML = '<i class="fas fa-check-circle"></i> Safe for You';
        } else if (contra.warnings && contra.warnings.length > 0) {
          safetyBadge.className = contra.reason ? 'safety-badge unsafe' : 'safety-badge warning';
          const icon = contra.reason ? 'fa-exclamation-triangle' : 'fa-exclamation-circle';
          safetyBadge.innerHTML = `<i class="fas ${icon}"></i> ${contra.reason ? 'Contraindicated' : 'Caution'}`;

          // Mark drug card as unsafe/warning
          drugDiv.classList.add(contra.reason ? 'unsafe' : 'warning');
        }
        drugDiv.appendChild(safetyBadge);

        // Display warnings if any
        if (contra.warnings && contra.warnings.length > 0) {
          const warningBox = document.createElement('div');
          warningBox.className = contra.reason ? 'contraindication-warning severe' : 'contraindication-warning';

          const warningHeader = document.createElement('div');
          warningHeader.className = 'contraindication-header';
          warningHeader.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${contra.reason ? 'Not Recommended' : 'Important Warnings'}`;
          warningBox.appendChild(warningHeader);

          const warningList = document.createElement('ul');
          warningList.className = 'contraindication-list';
          contra.warnings.forEach(warning => {
            const li = document.createElement('li');
            li.textContent = warning;
            warningList.appendChild(li);
          });
          warningBox.appendChild(warningList);

          // Add reason if provided
          if (contra.reason) {
            const reasonDiv = document.createElement('div');
            reasonDiv.className = 'contraindication-reason';
            reasonDiv.textContent = contra.reason;
            warningBox.appendChild(reasonDiv);
          }

          drugDiv.appendChild(warningBox);
        }

        // Add safe indicator for safe drugs
        if (contra.safe && (!contra.warnings || contra.warnings.length === 0)) {
          const safeIndicator = document.createElement('div');
          safeIndicator.className = 'safe-indicator';
          safeIndicator.innerHTML = '<i class="fas fa-shield-alt"></i> No known contraindications for your profile';
          drugDiv.appendChild(safeIndicator);
        }
      }

      // Brand names
      if (item["Brand Name(s)"]) {
        const brandP = document.createElement('p');
        brandP.className = 'brand-name';
        brandP.innerHTML = `<strong>Brand Name(s):</strong> ${item["Brand Name(s)"]}`;
        drugDiv.appendChild(brandP);
      }
      
      // Dosage
      if (item["Dosage"]) {
        const dosageP = document.createElement('p');
        dosageP.className = 'dosage';
        dosageP.innerHTML = `<strong>Dosage:</strong> ${item["Dosage"]}`;
        drugDiv.appendChild(dosageP);
      }
      
      // Symptoms
      if (item["Symptoms Addressed"]) {
        const symptomsP = document.createElement('p');
        symptomsP.className = 'symptoms';
        symptomsP.innerHTML = `<strong>Symptoms Addressed:</strong> ${item["Symptoms Addressed"]}`;
        drugDiv.appendChild(symptomsP);
      }
      
      // Reference URL
      if (item["Reference URL"]) {
        const linkP = document.createElement('p');
        const link = document.createElement('a');
        link.href = item["Reference URL"];
        link.target = "_blank";
        link.textContent = "More info";
        linkP.appendChild(link);
        drugDiv.appendChild(linkP);
      }
      
      // Add tracking button if user is authenticated
      if (window.AuthService && window.AuthService.isAuthenticated()) {
        const trackButton = document.createElement('button');
        trackButton.className = 'track-medication-btn';
        trackButton.textContent = 'Track this medication';
        trackButton.addEventListener('click', function() {
          if (window.MedicationService) {
            window.MedicationService.showTrackingModal(
              item["Scientific Name"], 
              item["Brand Name(s)"], 
              item["Dosage"]
            );
          }
        });
        
        drugDiv.appendChild(trackButton);
      }
      
      elements.resultsDiv.appendChild(drugDiv);
    }
  });
  
  // Add pharmacy lookup section if not already present
  addPharmacyLookup();
}

/**
 * Add pharmacy lookup section to results
 */
function addPharmacyLookup() {
  // Check if pharmacy section already exists
  if (document.getElementById('pharmacy-section')) {
    return;
  }
  
  // Create pharmacy lookup section
  const pharmacySection = document.createElement('div');
  pharmacySection.id = 'pharmacy-section';
  pharmacySection.className = 'pharmacy-section';
  
  // Add heading
  const heading = document.createElement('h3');
  heading.textContent = 'Find Nearby Pharmacies';
  pharmacySection.appendChild(heading);
  
  // Add description
  const description = document.createElement('p');
  description.textContent = 'Enter your ZIP code to find pharmacies near you that may carry these medications.';
  pharmacySection.appendChild(description);
  
  // Create input group container
  const inputGroup = document.createElement('div');
  inputGroup.className = 'input-group';
  inputGroup.style.display = 'flex';
  inputGroup.style.width = '100%';
  inputGroup.style.gap = '0.5em'; // optional: spacing between input and button

  // ZIP code input
  const zipInput = document.createElement('input');
  zipInput.type = 'text';
  zipInput.id = 'zip-code';
  zipInput.placeholder = 'Enter ZIP code';
  zipInput.pattern = '[0-9]{5}';
  zipInput.maxLength = 5;
  zipInput.style.flex = '4'; // 40% of the space

  // Search button
  const searchButton = document.createElement('button');
  searchButton.id = 'pharmacy-button';
  searchButton.textContent = 'Find Pharmacies';
  searchButton.style.flex = '6'; // 60% of the space
  searchButton.addEventListener('click', findNearbyPharmacies);

  // Populate ZIP code if available in user profile
  if (window.AuthService && window.AuthService.isAuthenticated()) {
    const userInfo = window.AuthService.getCurrentUser();
    if (userInfo && userInfo.profile && userInfo.profile.zip_code) {
      zipInput.value = userInfo.profile.zip_code;
    }
  }
  
  // Add elements to input group
  inputGroup.appendChild(zipInput);
  inputGroup.appendChild(searchButton);
  pharmacySection.appendChild(inputGroup);
  
  // Add results container
  const resultsContainer = document.createElement('div');
  resultsContainer.id = 'pharmacy-results';
  pharmacySection.appendChild(resultsContainer);
  
  // Add to main results div
  elements.resultsDiv.appendChild(pharmacySection);
  
  // Update elements object
  elements.pharmacyButton = searchButton;
  elements.zipCodeInput = zipInput;
  elements.pharmacyResults = resultsContainer;
}

/**
 * Find nearby pharmacies based on ZIP code
 */
async function findNearbyPharmacies() {
  // Get the ZIP code
  const zipCode = elements.zipCodeInput.value.trim();
  
  // Validate ZIP code
  if (!zipCode || !/^\d{5}$/.test(zipCode)) {
    showPharmacyError('Please enter a valid 5-digit ZIP code');
    return;
  }
  
  try {
    // Show loading state
    elements.pharmacyResults.innerHTML = '<div class="loading">Searching for pharmacies...</div>';
    
    // Prepare headers
    const headers = {};
    
    // Add authorization header if authenticated
    if (window.AuthService && window.AuthService.isAuthenticated()) {
      headers['Authorization'] = `Bearer ${window.AuthService.getAccessToken()}`;
    }
    
    // Make API request
    const response = await fetch(`${API_ENDPOINTS.PHARMACY}?zip_code=${zipCode}`, {
      headers
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to find pharmacies');
    }
    
    const data = await response.json();
    
    // Display pharmacy results
    displayPharmacies(data.pharmacies);
    
  } catch (error) {
    console.error('Pharmacy search error:', error);
    showPharmacyError(error.message || 'An error occurred while searching for pharmacies');
  }
}

/**
 * Display list of pharmacies
 * @param {Array} pharmacies - List of pharmacy data
 */
function displayPharmacies(pharmacies) {
  if (!elements.pharmacyResults) {
    return;
  }

  // Clear previous results
  elements.pharmacyResults.innerHTML = '';

  if (!pharmacies || pharmacies.length === 0) {
    elements.pharmacyResults.innerHTML = '<p>No pharmacies found in this area</p>';
    return;
  }

  // Create results container
  const pharmacyList = document.createElement('div');
  pharmacyList.className = 'pharmacy-list';

  pharmacies.forEach(pharmacy => {
    const pharmacyCardLink = document.createElement('a');
    pharmacyCardLink.href = `https://www.google.com/maps/place/?q=place_id:${pharmacy.place_id}`;
    pharmacyCardLink.target = '_blank';
    pharmacyCardLink.rel = 'noopener noreferrer';
  
    const pharmacyCard = document.createElement('div');
    pharmacyCard.className = 'pharmacy-card';
  
    const nameHeading = document.createElement('h4');
    nameHeading.innerHTML = `📍 ${pharmacy.name}`;
    pharmacyCard.appendChild(nameHeading);
  
    const addressP = document.createElement('p');
    addressP.innerHTML = `<strong>Address:</strong> ${pharmacy.address}`;
    pharmacyCard.appendChild(addressP);
  
    if (pharmacy.distance_meters !== undefined) {
      const miles = pharmacy.distance_meters / 1609.34;
      const distanceP = document.createElement('p');
      distanceP.innerHTML = `<strong>Distance:</strong> ${miles.toFixed(1)} miles`;
      pharmacyCard.appendChild(distanceP);
    }
  
    const openStatus = pharmacy.open_now === true ? 'Yes' :
                      pharmacy.open_now === false ? 'No' : 'Unknown';
    const openP = document.createElement('p');
    openP.innerHTML = `<strong>Open Now:</strong> ${openStatus}`;
    pharmacyCard.appendChild(openP);
  
    if (pharmacy.rating !== undefined) {
      const ratingP = document.createElement('p');
      ratingP.innerHTML = `<strong>Rating:</strong> ${pharmacy.rating} (${pharmacy.user_ratings_total || 0} reviews)`;
      pharmacyCard.appendChild(ratingP);
    }
  
    pharmacyCardLink.appendChild(pharmacyCard);
    pharmacyList.appendChild(pharmacyCardLink);
  });
  
  // Append the results to the DOM
  elements.pharmacyResults.appendChild(pharmacyList);
}

/**
 * Show error in pharmacy results
 * @param {string} message - Error message
 */
function showPharmacyError(message) {
  if (!elements.pharmacyResults) {
    return;
  }
  
  elements.pharmacyResults.innerHTML = `<div class="error-message">${message}</div>`;
}

/**
 * Show login prompt for anonymous users who hit rate limit
 */
function showLoginPrompt() {
  const loginPrompt = document.createElement('div');
  loginPrompt.className = 'login-prompt';
  
  const promptMessage = document.createElement('p');
  promptMessage.innerHTML = `
    <strong>You've reached the limit for anonymous requests.</strong>
    <br>Register for a free account to continue using this service.
  `;
  
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'prompt-buttons';
  
  const registerButton = document.createElement('button');
  registerButton.className = 'register-prompt-btn';
  registerButton.textContent = 'Register';
  registerButton.addEventListener('click', function() {
    const registerModal = document.getElementById('register-modal');
    if (registerModal) {
      registerModal.style.display = 'block';
    }
  });
  
  const loginButton = document.createElement('button');
  loginButton.className = 'login-prompt-btn';
  loginButton.textContent = 'Login';
  loginButton.addEventListener('click', function() {
    const loginModal = document.getElementById('login-modal');
    if (loginModal) {
      loginModal.style.display = 'block';
    }
  });
  
  buttonContainer.appendChild(registerButton);
  buttonContainer.appendChild(loginButton);
  
  loginPrompt.appendChild(promptMessage);
  loginPrompt.appendChild(buttonContainer);
  
  elements.resultsDiv.appendChild(loginPrompt);
}

/**
 * Show error message
 * @param {string} message - Error message
 */
function showError(message) {
  clearResults();
  
  const errorDiv = document.createElement('div');
  errorDiv.className = 'status-message status-error';
  errorDiv.textContent = message;
  
  elements.resultsDiv.appendChild(errorDiv);
}

/**
 * Show status message during processing
 * @param {string} message - Status message
 * @param {string} className - CSS class for styling
 */
function showStatusMessage(message, className) {
  clearResults();
  
  // Create status message
  const statusDiv = document.createElement('div');
  statusDiv.className = `status-message ${className}`;
  statusDiv.textContent = message;
  
  // Create spinner
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  
  // Add to results
  elements.resultsDiv.appendChild(statusDiv);
  elements.resultsDiv.appendChild(spinner);
}

/**
 * Clear results container
 */
function clearResults() {
  elements.resultsDiv.innerHTML = '';
}

/**
 * Set loading state
 * @param {boolean} isLoading - Whether app is in loading state
 */
function setLoading(isLoading) {
  elements.submitButton.disabled = isLoading;
  elements.submitButton.textContent = isLoading ? 'Processing...' : 'Get Recommendations';
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);
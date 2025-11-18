// modern-ui.js - Updated version

// Wait for all scripts to load before initializing
window.addEventListener('load', function() {
  // Initialize UI elements
  initUI();
  
  // Initialize bear mascot
  initBearMascot();
  
  // Connect with existing auth system
  connectWithAuthSystem();
  
  // Initialize medication service if user is authenticated
  if (window.MedicationService && window.AuthService && window.AuthService.isAuthenticated()) {
    console.log('Initializing medication service from modern-ui.js');
    window.MedicationService.init();
  }
});

/**
 * Initialize UI elements and interactions
 */
function initUI() {
  // Hamburger menu toggle
  const hamburgerToggle = document.getElementById('hamburger-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  
  if (hamburgerToggle) {
    hamburgerToggle.addEventListener('click', function() {
      this.classList.toggle('active');
      mobileNav.classList.toggle('active');
      
      // Prevent scrolling when menu is open
      document.body.style.overflow = this.classList.contains('active') ? 'hidden' : '';
    });
  }
  
  // Close mobile nav when clicking outside
  document.addEventListener('click', function(event) {
    if (mobileNav && mobileNav.classList.contains('active') && 
        !mobileNav.contains(event.target) && 
        !hamburgerToggle.contains(event.target)) {
      mobileNav.classList.remove('active');
      hamburgerToggle.classList.remove('active');
      document.body.style.overflow = '';
    }
  });
  
  // User dropdown toggle
  const userDropdownToggle = document.getElementById('user-profile-dropdown-toggle');
  const userDropdownMenu = document.getElementById('user-dropdown-menu');
  
  if (userDropdownToggle && userDropdownMenu) {
    userDropdownToggle.addEventListener('click', function(event) {
      event.stopPropagation();
      userDropdownMenu.classList.toggle('active');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function() {
      userDropdownMenu.classList.remove('active');
    });
    
    // Prevent dropdown from closing when clicking inside
    userDropdownMenu.addEventListener('click', function(event) {
      event.stopPropagation();
    });
  }
  
  // Section navigation
  setupSectionNavigation();
  
  // Delete account confirmation
  const deleteAccountBtn = document.getElementById('delete-account-button');
  const deleteConfirmation = document.getElementById('delete-confirmation');
  const confirmDeleteBtn = document.getElementById('confirm-delete-button');
  const cancelDeleteBtn = document.getElementById('cancel-delete-button');
  
  if (deleteAccountBtn && deleteConfirmation) {
    deleteAccountBtn.addEventListener('click', function() {
      deleteConfirmation.style.display = 'block';
      deleteAccountBtn.style.display = 'none';
    });
    
    if (cancelDeleteBtn) {
      cancelDeleteBtn.addEventListener('click', function() {
        deleteConfirmation.style.display = 'none';
        deleteAccountBtn.style.display = 'block';
      });
    }
  }
  
  // Modal handling
  setupModals();
  
  // Setup authentication-required handlers for anonymous users
  setupAnonymousUserPrompts();
  
  // Add medication button
  const addMedicationButton = document.getElementById('add-medication-button');
  if (addMedicationButton) {
    addMedicationButton.addEventListener('click', function() {
      // Check if user is authenticated
      if (window.AuthService && window.AuthService.isAuthenticated()) {
        const trackingModal = document.getElementById('medication-tracking-modal');
        if (trackingModal) {
          // Reset the form to create new medication mode
          const modalTitle = trackingModal.querySelector('h2');
          if (modalTitle) {
            modalTitle.textContent = 'Track Medication';
          }
          
          const form = trackingModal.querySelector('form');
          if (form) {
            form.reset();
            form.removeAttribute('data-medication-id');
            
            // Set default start date to today
            const startDateInput = document.getElementById('tracking-start-date');
            if (startDateInput) {
              startDateInput.value = new Date().toISOString().split('T')[0];
            }
            
            // Update submit button text
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) {
              submitButton.textContent = 'Save Medication';
            }
          }
          
          trackingModal.style.display = 'block';
        }
      } else {
        // Show login modal for anonymous users
        const loginModal = document.getElementById('login-modal');
        if (loginModal) {
          loginModal.style.display = 'block';
        }
        showNotification('Please log in to track medications', 'warning');
      }
    });
  }
  
  // Setup medication interaction
  if (window.MedicationService) {
    window.MedicationService.setupMedicationTrackers();
  }
  
  // Hook into the existing app.js displayResults function
  if (window.displayResults) {
    const originalDisplayResults = window.displayResults;
    
    window.displayResults = function(data) {
      // Call the original function
      originalDisplayResults(data);
      
      // Now show the pharmacy section
      showPharmacySection();
      
      // Also load medication tracking if user is authenticated
      if (window.MedicationService && window.AuthService && window.AuthService.isAuthenticated()) {
        window.MedicationService.loadMedicationTracking();
      }
    };
  }
  
  // Add pharmacy search button functionality
  const pharmacyButton = document.getElementById('pharmacy-button');
  if (pharmacyButton) {
    pharmacyButton.addEventListener('click', function() {
      // Check if the original app.js function exists
      if (window.findNearbyPharmacies) {
        window.findNearbyPharmacies();
      }
    });
  }
}

/**
 * Setup authentication-required handlers for anonymous users
 */
function setupAnonymousUserPrompts() {
  // Check if user is not authenticated
  if (!window.AuthService || !window.AuthService.isAuthenticated()) {
    // Add handlers to profile form
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
      profileForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const loginModal = document.getElementById('login-modal');
        if (loginModal) {
          loginModal.style.display = 'block';
        }
        showNotification('Please log in to save your profile', 'warning');
      });
    }
    
    // Add visual cues to sections requiring authentication
    if (document.getElementById('profile-section').classList.contains('active') ||
        document.getElementById('medications-section').classList.contains('active') ||
        document.getElementById('history-section').classList.contains('active')) {
      
      const section = document.querySelector('.app-section.active');
      
      // Check if login prompt already exists
      if (!section.querySelector('.login-prompt')) {
        const loginPrompt = document.createElement('div');
        loginPrompt.className = 'login-prompt';
        loginPrompt.innerHTML = `
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
        
        // Find section content to append to
        const sectionContent = section.querySelector('.section-content');
        if (sectionContent) {
          sectionContent.appendChild(loginPrompt);
        } else {
          section.appendChild(loginPrompt);
        }
        
        // Add click handlers
        document.getElementById('prompt-login-button').addEventListener('click', function() {
          document.getElementById('login-modal').style.display = 'block';
        });
        
        document.getElementById('prompt-register-button').addEventListener('click', function() {
          document.getElementById('register-modal').style.display = 'block';
        });
      }
    }
  }
}

/**
 * Show pharmacy section after search
 */
function showPharmacySection() {
  const pharmacySection = document.getElementById('pharmacy-section');
  
  if (pharmacySection) {
    pharmacySection.style.display = 'block';
    
    // Populate ZIP code if user is logged in
    const zipCodeInput = document.getElementById('zip-code');
    if (zipCodeInput && window.AuthService && window.AuthService.isAuthenticated()) {
      const userInfo = window.AuthService.getCurrentUser();
      
      if (userInfo && userInfo.profile && userInfo.profile.zip_code) {
        zipCodeInput.value = userInfo.profile.zip_code;
      }
    }
  }
}

/**
 * Setup section navigation
 */
function setupSectionNavigation() {
  // Define navigation items and their corresponding sections
  const navigationMap = {
    // Main navigation
    'nav-home': 'home-section',
    'nav-profile': 'profile-section',
    'nav-medications': 'medications-section',
    'nav-history': 'history-section',
    
    // Dropdown navigation
    'profile-menu-item': 'profile-section',
    'medications-menu-item': 'medications-section',
    'history-menu-item': 'history-section',
    
    // Mobile navigation
    'mobile-home': 'home-section',
    'mobile-profile': 'profile-section',
    'mobile-medications': 'medications-section',
    'mobile-history': 'history-section'
  };
  
  // Add click handlers for navigation items
  for (const [navId, sectionId] of Object.entries(navigationMap)) {
    const navItem = document.getElementById(navId);
    
    if (navItem) {
      navItem.addEventListener('click', function(event) {
        // Prevent default for links
        if (this.tagName === 'A') {
          event.preventDefault();
        }
        
        // Remove active class from all navigation items
        document.querySelectorAll('.main-nav a').forEach(item => {
          item.classList.remove('active');
        });
        
        // Add active class to clicked item if it's in the main nav
        if (this.classList.contains('nav-item')) {
          this.classList.add('active');
        } else if (navId.startsWith('nav-')) {
          this.classList.add('active');
        }
        
        // Handle mobile menu closing
        if (navId.startsWith('mobile-')) {
          // Close mobile menu
          document.getElementById('mobile-nav').classList.remove('active');
          document.getElementById('hamburger-toggle').classList.remove('active');
          document.body.style.overflow = '';
        }
        
        // Close user dropdown if open
        const userDropdownMenu = document.getElementById('user-dropdown-menu');
        if (userDropdownMenu && userDropdownMenu.classList.contains('active')) {
          userDropdownMenu.classList.remove('active');
        }
        
        // Show the corresponding section
        showSection(sectionId);
        
        // Setup authentication-required handlers if needed
        setupAnonymousUserPrompts();
      });
    }
  }
}

/**
 * Show a specific section and hide others
 * @param {string} sectionId - ID of the section to show
 */
function showSection(sectionId) {
  // Hide all sections
  document.querySelectorAll('.app-section').forEach(section => {
    section.classList.remove('active');
  });
  
  // Show the requested section
  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.classList.add('active');
    
    // Scroll to top of section
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
    
    // Refresh medication data if showing medications section
    if (sectionId === 'medications-section' && window.MedicationService && window.AuthService && window.AuthService.isAuthenticated()) {
      window.MedicationService.loadMedicationTracking();
    }
    
    // Refresh history data if showing history section
    if (sectionId === 'history-section' && window.MedicationService && window.AuthService && window.AuthService.isAuthenticated()) {
      window.MedicationService.loadMedicationHistory();
    }
  }
}

/**
 * Setup modal functionality
 */
function setupModals() {
  // Modal open buttons
  const modalButtons = {
    'login-button': 'login-modal',
    'register-button': 'register-modal',
    'forgot-password': 'reset-password-modal',
    'mobile-login': 'login-modal',
    'mobile-register': 'register-modal'
  };
  
  // Add click handlers for modal buttons
  for (const [buttonId, modalId] of Object.entries(modalButtons)) {
    const button = document.getElementById(buttonId);
    const modal = document.getElementById(modalId);
    
    if (button && modal) {
      button.addEventListener('click', function(event) {
        event.preventDefault();
        modal.style.display = 'block';
      });
    }
  }
  
  // Close modals when clicking close button
  document.querySelectorAll('.modal .close-button').forEach(closeButton => {
    closeButton.addEventListener('click', function() {
      this.closest('.modal').style.display = 'none';
    });
  });
  
  // Close modals when clicking outside
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', function(event) {
      if (event.target === this) {
        this.style.display = 'none';
      }
    });
  });
  
  // Modal navigation
  document.getElementById('go-to-register')?.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('register-modal').style.display = 'block';
  });
  
  document.getElementById('go-to-login')?.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('register-modal').style.display = 'none';
    document.getElementById('login-modal').style.display = 'block';
  });
  
  document.getElementById('back-to-login')?.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('reset-password-modal').style.display = 'none';
    document.getElementById('login-modal').style.display = 'block';
  });
  
  // Handle medication tracking form submission
  const trackingForm = document.getElementById('medication-tracking-form');
  if (trackingForm) {
    trackingForm.addEventListener('submit', async function(event) {
      event.preventDefault();
      
      // Check if user is authenticated
      if (!window.AuthService || !window.AuthService.isAuthenticated()) {
        showNotification('Please log in to track medications', 'warning');
        document.getElementById('medication-tracking-modal').style.display = 'none';
        document.getElementById('login-modal').style.display = 'block';
        return;
      }
      
      // Get medication ID if editing existing medication
      const medicationId = this.getAttribute('data-medication-id');
      
      try {
        // Show loading state
        const submitButton = this.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;
        submitButton.textContent = 'Saving...';
        submitButton.disabled = true;
        
        // Get form data
        const formData = new FormData(this);
        const medicationData = {
          drug_name: formData.get('drug_name'),
          brand_name: formData.get('brand_name'),
          dosage: formData.get('dosage'),
          frequency: formData.get('frequency'),
          start_date: formData.get('start_date'),
          end_date: formData.get('end_date'),
          reminder_enabled: formData.get('reminder_enabled') === 'on',
        };
        
        // Get reminder times
        const reminderTimes = [];
        document.querySelectorAll('.reminder-time').forEach(input => {
          if (input.value) {
            reminderTimes.push(input.value);
          }
        });
        medicationData.reminder_times = reminderTimes;
        
        // Add medication ID if editing
        if (medicationId) {
          medicationData.medication_id = medicationId;
        }
        
        // Submit the data
        const token = window.AuthService.getAccessToken();
        const response = await fetch('/api/v1/auth/track-medication', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(medicationData)
        });
        
        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.error || 'Failed to save medication');
        }
        
        // Show success notification
        showNotification(result.message || 'Medication saved successfully', 'success');
        
        // Close modal
        document.getElementById('medication-tracking-modal').style.display = 'none';
        
        // Refresh medication data
        if (window.MedicationService) {
          window.MedicationService.loadMedicationTracking();
        }
      } catch (error) {
        console.error('Error saving medication:', error);
        showNotification('Failed to save medication: ' + error.message, 'error');
      } finally {
        // Reset button state
        const submitButton = this.querySelector('button[type="submit"]');
        submitButton.textContent = originalButtonText;
        submitButton.disabled = false;
      }
    });
  }
}

/**
 * Initialize bear mascot
 */
function initBearMascot() {
  const bearMascot = document.getElementById('bear-mascot');
  
  if (!bearMascot) {
    return;
  }
  
  // Make bear wave and show notification on click
  bearMascot.addEventListener('click', function() {
    this.classList.add('wave');
    
    // Show welcome message
    showNotification('Hi there! I\'m here to help you feel better!', 'success');
    
    // Remove animation class after animation completes
    setTimeout(() => {
      this.classList.remove('wave');
    }, 2000);
  });
  
  // Random bear movements
  setInterval(() => {
    // 10% chance to wave
    if (Math.random() < 0.1) {
      bearMascot.classList.add('wave');
      
      setTimeout(() => {
        bearMascot.classList.remove('wave');
      }, 2000);
    }
  }, 30000); // Check every 30 seconds
}

/**
 * Connect with the existing authentication system
 */
function connectWithAuthSystem() {
  // Check if AuthService from the existing code is available
  if (window.AuthService) {
    // Override the updateAuthUI method to integrate with our new UI
    const originalUpdateAuthUI = window.AuthService.updateAuthUI;
    
    window.AuthService.updateAuthUI = function() {
      // Call the original method first
      if (originalUpdateAuthUI) {
        originalUpdateAuthUI.call(window.AuthService);
      }
      
      // Now update our new UI elements
      updateAuthUIState();
    };
    
    // Initial update
    updateAuthUIState();
  } else {
    // If AuthService isn't loaded yet, wait for it
    const checkInterval = setInterval(() => {
      if (window.AuthService) {
        // Override the updateAuthUI method
        const originalUpdateAuthUI = window.AuthService.updateAuthUI;
        
        window.AuthService.updateAuthUI = function() {
          // Call the original method first
          if (originalUpdateAuthUI) {
            originalUpdateAuthUI.call(window.AuthService);
          }
          
          // Now update our new UI elements
          updateAuthUIState();
        };
        
        // Initial update
        updateAuthUIState();
        
        clearInterval(checkInterval);
      }
    }, 100);
    
    // Stop checking after 5 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 5000);
  }
}

/**
 * Update UI elements based on authentication state
 */
function updateAuthUIState() {
  const isAuthenticated = window.AuthService && window.AuthService.isAuthenticated();
  const userInfo = window.AuthService && window.AuthService.getCurrentUser();
  
  // Get UI elements
  const authAnonymous = document.getElementById('auth-anonymous');
  const authAuthenticated = document.getElementById('auth-authenticated');
  const userNameDisplay = document.getElementById('user-name-display');
  const subscriptionBadge = document.getElementById('subscription-badge');
  const mobileAuthAnonymous = document.querySelectorAll('.mobile-auth-anonymous');
  const mobileAuthAuthenticated = document.querySelectorAll('.mobile-auth-authenticated');
  
  if (isAuthenticated && userInfo) {
    // User is logged in
    if (authAnonymous) authAnonymous.style.display = 'none';
    if (authAuthenticated) authAuthenticated.style.display = 'flex';
    
    // Update user display
    if (userNameDisplay) {
      userNameDisplay.textContent = userInfo.name || userInfo.email || 'User';
    }
    
    // Update subscription badge
    if (subscriptionBadge && userInfo.subscription_tier) {
      subscriptionBadge.textContent = userInfo.subscription_tier.toUpperCase();
      subscriptionBadge.className = `subscription-badge ${userInfo.subscription_tier}`;
    }
    
    // Update mobile menu
    mobileAuthAnonymous.forEach(item => item.style.display = 'none');
    mobileAuthAuthenticated.forEach(item => item.style.display = 'block');
    
    // Show greeting notification if this is the first login
    if (!window.greeted && userInfo.name) {
      showNotification(`Welcome back, ${userInfo.name}!`, 'success');
      window.greeted = true;
    }
    
    // Initialize medication tracking if the service exists
    if (window.MedicationService) {
      window.MedicationService.init();
    }
    
    // Remove login prompts
    document.querySelectorAll('.login-prompt').forEach(prompt => {
      prompt.remove();
    });
  } else {
    // User is not logged in
    if (authAnonymous) authAnonymous.style.display = 'flex';
    if (authAuthenticated) authAuthenticated.style.display = 'none';
    
    // Update mobile menu
    mobileAuthAnonymous.forEach(item => item.style.display = 'block');
    mobileAuthAuthenticated.forEach(item => item.style.display = 'none');
    
    // Set up anonymous user prompts
    setupAnonymousUserPrompts();
  }
}

/**
 * Show a notification message
 * @param {string} message - Notification message
 * @param {string} type - Notification type (success, error, warning)
 */
function showNotification(message, type = 'success') {
  // Check if notification container exists, create if not
  let container = document.getElementById('notification-container');
  
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    document.body.appendChild(container);
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
  container.appendChild(notification);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.remove();
  }, 5000);
}
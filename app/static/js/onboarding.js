// onboarding.js - Handle the onboarding flow for new users

import apiService from './apiService.js';

class OnboardingManager {
  constructor() {
    this.currentStep = 1;
    this.totalSteps = 5;
    this.onboardingData = {
      name: '',
      age: null,
      gender: '',
      zip_code: '',
      allergies: [],
      conditions: [],
      medications: []
    };

    this.init();
  }

  init() {
    // Check if user needs onboarding (new user without profile)
    this.checkOnboardingNeeded();

    // Setup event listeners
    this.setupEventListeners();
  }

  async checkOnboardingNeeded() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const profile = await apiService.getUserProfile();

      // Show onboarding if user just registered and profile is incomplete
      const onboardingCompleted = localStorage.getItem('onboarding_completed');
      if (!onboardingCompleted && (!profile || !profile.name)) {
        this.showOnboarding();
      }
    } catch (error) {
      console.log('Not showing onboarding:', error.message);
    }
  }

  showOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden'; // Prevent scrolling
      this.animateStep(1);
    }
  }

  hideOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      document.body.style.overflow = 'auto';
      localStorage.setItem('onboarding_completed', 'true');
    }
  }

  setupEventListeners() {
    // Next buttons
    document.querySelectorAll('.onboarding-next-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleNext());
    });

    // Back buttons
    document.querySelectorAll('.onboarding-back-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleBack());
    });

    // Skip button (step 4)
    const skipBtn = document.querySelector('.onboarding-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => this.handleSkip());
    }

    // Finish button
    const finishBtn = document.querySelector('.onboarding-finish-btn');
    if (finishBtn) {
      finishBtn.addEventListener('click', () => this.handleFinish());
    }

    // Tag inputs for allergies, conditions, medications
    this.setupTagInput('onboarding-allergies', 'allergies-tags', 'allergies');
    this.setupTagInput('onboarding-conditions', 'conditions-tags', 'conditions');
    this.setupTagInput('onboarding-medications', 'medications-tags', 'medications');

    // Form inputs validation
    this.setupFormValidation();
  }

  setupTagInput(inputId, tagsDisplayId, dataKey) {
    const input = document.getElementById(inputId);
    const tagsDisplay = document.getElementById(tagsDisplayId);

    if (!input || !tagsDisplay) return;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = input.value.trim();
        if (value) {
          this.addTag(value, tagsDisplay, dataKey);
          input.value = '';
        }
      }
    });

    // Also allow comma separation
    input.addEventListener('blur', () => {
      const value = input.value.trim();
      if (value) {
        this.addTag(value, tagsDisplay, dataKey);
        input.value = '';
      }
    });
  }

  addTag(text, container, dataKey) {
    if (!this.onboardingData[dataKey].includes(text)) {
      this.onboardingData[dataKey].push(text);

      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.innerHTML = `
        ${text}
        <button class="tag-remove" data-tag="${text}" data-key="${dataKey}">
          <i class="fas fa-times"></i>
        </button>
      `;

      container.appendChild(tag);

      // Add remove functionality
      tag.querySelector('.tag-remove').addEventListener('click', (e) => {
        const tagText = e.currentTarget.dataset.tag;
        const key = e.currentTarget.dataset.key;
        this.removeTag(tagText, key, tag);
      });
    }
  }

  removeTag(text, dataKey, element) {
    const index = this.onboardingData[dataKey].indexOf(text);
    if (index > -1) {
      this.onboardingData[dataKey].splice(index, 1);
    }
    element.remove();
  }

  setupFormValidation() {
    // Real-time validation for inputs
    const nameInput = document.getElementById('onboarding-name');
    const ageInput = document.getElementById('onboarding-age');

    if (nameInput) {
      nameInput.addEventListener('input', (e) => {
        this.onboardingData.name = e.target.value.trim();
      });
    }

    if (ageInput) {
      ageInput.addEventListener('input', (e) => {
        this.onboardingData.age = parseInt(e.target.value) || null;
      });
    }

    const genderSelect = document.getElementById('onboarding-gender');
    if (genderSelect) {
      genderSelect.addEventListener('change', (e) => {
        this.onboardingData.gender = e.target.value;
      });
    }

    const zipInput = document.getElementById('onboarding-zip');
    if (zipInput) {
      zipInput.addEventListener('input', (e) => {
        this.onboardingData.zip_code = e.target.value;
      });
    }
  }

  async handleNext() {
    // Validate current step before proceeding
    if (!this.validateStep(this.currentStep)) {
      return;
    }

    // Save data if on step 2 (basic profile)
    if (this.currentStep === 2) {
      await this.saveBasicProfile();
    }

    // Save health info if on step 3
    if (this.currentStep === 3) {
      await this.saveHealthInfo();
    }

    // Save medications if on step 4
    if (this.currentStep === 4) {
      await this.saveMedications();
    }

    if (this.currentStep < this.totalSteps) {
      this.currentStep++;
      this.updateStep();
    }
  }

  handleBack() {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.updateStep();
    }
  }

  async handleSkip() {
    // Skip current step (medications)
    if (this.currentStep === 4) {
      this.currentStep++;
      this.updateStep();
    }
  }

  async handleFinish() {
    // Mark onboarding as complete and close
    this.hideOnboarding();

    // Show success notification
    this.showNotification('Welcome to ayuda! Your profile is all set up.', 'success');

    // Reload to show updated profile
    window.location.reload();
  }

  validateStep(step) {
    switch(step) {
      case 1:
        return true; // Welcome step, no validation needed
      case 2:
        // Validate basic profile
        const name = document.getElementById('onboarding-name')?.value.trim();
        const age = document.getElementById('onboarding-age')?.value;

        if (!name) {
          this.showNotification('Please enter your name', 'error');
          return false;
        }
        if (!age || age < 1 || age > 120) {
          this.showNotification('Please enter a valid age', 'error');
          return false;
        }
        return true;
      case 3:
        return true; // Health info is optional
      case 4:
        return true; // Medications are optional
      case 5:
        return true; // Completion step
      default:
        return true;
    }
  }

  async saveBasicProfile() {
    try {
      const profileData = {
        name: this.onboardingData.name,
        age: this.onboardingData.age,
        gender: this.onboardingData.gender || null,
        zip_code: this.onboardingData.zip_code || null
      };

      await apiService.updateUserProfile(profileData);
    } catch (error) {
      console.error('Error saving basic profile:', error);
      this.showNotification('Error saving profile. Please try again.', 'error');
      throw error;
    }
  }

  async saveHealthInfo() {
    try {
      const healthData = {
        allergies: this.onboardingData.allergies,
        medication_history: this.onboardingData.conditions
      };

      await apiService.updateUserProfile(healthData);
    } catch (error) {
      console.error('Error saving health info:', error);
      this.showNotification('Error saving health information.', 'error');
      throw error;
    }
  }

  async saveMedications() {
    try {
      // Save each medication separately
      for (const med of this.onboardingData.medications) {
        await apiService.addMedication({
          drug_name: med,
          dosage: '',
          frequency: 'as_needed',
          time_of_day: []
        });
      }
    } catch (error) {
      console.error('Error saving medications:', error);
      this.showNotification('Error saving medications.', 'error');
      throw error;
    }
  }

  updateStep() {
    // Hide all steps
    document.querySelectorAll('.onboarding-step').forEach(step => {
      step.classList.remove('active');
    });

    // Show current step
    const currentStepElement = document.querySelector(`.onboarding-step[data-step="${this.currentStep}"]`);
    if (currentStepElement) {
      currentStepElement.classList.add('active');
      this.animateStep(this.currentStep);
    }

    // Update progress indicators
    document.querySelectorAll('.progress-step').forEach(step => {
      const stepNum = parseInt(step.dataset.step);
      if (stepNum < this.currentStep) {
        step.classList.add('completed');
        step.classList.remove('active');
      } else if (stepNum === this.currentStep) {
        step.classList.add('active');
        step.classList.remove('completed');
      } else {
        step.classList.remove('active', 'completed');
      }
    });
  }

  animateStep(stepNum) {
    const step = document.querySelector(`.onboarding-step[data-step="${stepNum}"]`);
    if (step) {
      step.style.animation = 'none';
      setTimeout(() => {
        step.style.animation = 'slideInUp 0.5s ease-out';
      }, 10);
    }
  }

  showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
      <span>${message}</span>
    `;

    container.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('show');
    }, 100);

    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// Initialize onboarding manager
const onboardingManager = new OnboardingManager();

// Export for use in other modules
export default onboardingManager;

// Add manual trigger for testing/development
window.showOnboarding = () => onboardingManager.showOnboarding();

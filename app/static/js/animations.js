// animations.js - Add smooth animations to UI elements

class AnimationManager {
  constructor() {
    this.init();
  }

  init() {
    // Add animations on page load
    document.addEventListener('DOMContentLoaded', () => {
      this.animateOnLoad();
      this.setupScrollAnimations();
      this.setupIntersectionObserver();
    });
  }

  animateOnLoad() {
    // Animate hero section
    const heroTitle = document.querySelector('.hero-title');
    if (heroTitle) {
      heroTitle.classList.add('fade-in');
    }

    const heroSubtitle = document.querySelector('.hero-subtitle');
    if (heroSubtitle) {
      setTimeout(() => heroSubtitle.classList.add('fade-in'), 200);
    }

    // Animate search box
    const searchBox = document.querySelector('.enhanced-search');
    if (searchBox) {
      setTimeout(() => searchBox.classList.add('scale-up'), 400);
    }

    // Animate stats with stagger
    const statItems = document.querySelectorAll('.stat-item');
    statItems.forEach((item, index) => {
      setTimeout(() => {
        item.classList.add('bounce-in');
      }, 600 + (index * 150));
    });
  }

  setupScrollAnimations() {
    // Animate elements as they come into view
    const animateOnScroll = () => {
      const elements = document.querySelectorAll('.medication-item, .card, .result-card');

      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight - 100;

        if (isVisible && !el.classList.contains('animated')) {
          el.classList.add('animated', 'fade-in');
        }
      });
    };

    window.addEventListener('scroll', animateOnScroll);
    animateOnScroll(); // Run once on load
  }

  setupIntersectionObserver() {
    // Use Intersection Observer for better performance
    if ('IntersectionObserver' in window) {
      const options = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
      };

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !entry.target.classList.contains('animated')) {
            entry.target.classList.add('animated', 'slide-in-left');
          }
        });
      }, options);

      // Observe all sections
      document.querySelectorAll('.app-section').forEach(section => {
        observer.observe(section);
      });
    }
  }

  // Add animation to dynamically created elements
  static animateElement(element, animationClass = 'fade-in') {
    if (element) {
      element.classList.add(animationClass);
    }
  }

  // Animate list items with stagger
  static animateList(items, baseDelay = 0) {
    items.forEach((item, index) => {
      setTimeout(() => {
        item.classList.add('fade-in');
      }, baseDelay + (index * 100));
    });
  }

  // Add loading spinner
  static showLoadingSpinner(container) {
    if (!container) return;

    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    spinner.style.margin = '20px auto';
    container.innerHTML = '';
    container.appendChild(spinner);
  }

  // Remove loading spinner and show content with animation
  static showContent(container, content, animationClass = 'fade-in') {
    if (!container) return;

    container.innerHTML = content;
    if (animationClass) {
      container.classList.add(animationClass);
    }
  }

  // Pulse animation for notifications
  static pulse(element) {
    if (!element) return;

    element.style.animation = 'none';
    setTimeout(() => {
      element.style.animation = 'pulse 0.5s ease-out';
    }, 10);
  }

  // Shake animation for errors
  static shake(element) {
    if (!element) return;

    element.classList.add('shake');
    setTimeout(() => {
      element.classList.remove('shake');
    }, 600);
  }
}

// Add shake animation to CSS dynamically
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-10px); }
    20%, 40%, 60%, 80% { transform: translateX(10px); }
  }

  .shake {
    animation: shake 0.6s cubic-bezier(.36,.07,.19,.97) both;
  }

  .animated {
    animation-fill-mode: forwards;
  }
`;
document.head.appendChild(style);

// Initialize animation manager
const animationManager = new AnimationManager();

// Export for use in other modules
export default AnimationManager;

// Make it available globally for easy access
window.AnimationManager = AnimationManager;

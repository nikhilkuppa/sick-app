/**
 * Interaction Heatmap
 * Visual matrix showing drug-drug interactions
 * Features: Color-coded severity, detailed info popups, integration with medicine cabinet
 */

// Common drug interaction database (simplified for demo)
// In production, this would come from a comprehensive drug database API
const DRUG_INTERACTIONS = {
  // Pain relievers
  'ibuprofen': {
    'aspirin': { severity: 'high', description: 'Increased risk of bleeding and stomach problems' },
    'naproxen': { severity: 'high', description: 'Increased risk of GI bleeding' },
    'acetaminophen': { severity: 'low', description: 'Generally safe combination' },
    'warfarin': { severity: 'high', description: 'Increased bleeding risk' }
  },
  'aspirin': {
    'ibuprofen': { severity: 'high', description: 'Reduced effectiveness of aspirin' },
    'warfarin': { severity: 'high', description: 'Severe bleeding risk' },
    'acetaminophen': { severity: 'low', description: 'Generally safe combination' }
  },
  'acetaminophen': {
    'ibuprofen': { severity: 'low', description: 'Generally safe combination' },
    'aspirin': { severity: 'low', description: 'Generally safe combination' },
    'warfarin': { severity: 'medium', description: 'May increase warfarin effect' },
    'alcohol': { severity: 'high', description: 'Liver damage risk' }
  },
  'naproxen': {
    'ibuprofen': { severity: 'high', description: 'Increased GI bleeding risk' },
    'warfarin': { severity: 'high', description: 'Increased bleeding risk' },
    'aspirin': { severity: 'high', description: 'Increased bleeding risk' }
  },

  // Cold & flu
  'pseudoephedrine': {
    'phenylephrine': { severity: 'high', description: 'Excessive stimulation, high blood pressure' },
    'caffeine': { severity: 'medium', description: 'Increased jitteriness and anxiety' },
    'guaifenesin': { severity: 'low', description: 'Generally safe combination' }
  },
  'dextromethorphan': {
    'pseudoephedrine': { severity: 'low', description: 'Common combination in cold medicines' },
    'ssri': { severity: 'high', description: 'Risk of serotonin syndrome' }
  },
  'guaifenesin': {
    'pseudoephedrine': { severity: 'low', description: 'Common safe combination' },
    'dextromethorphan': { severity: 'low', description: 'Common safe combination' }
  },

  // Antihistamines
  'diphenhydramine': {
    'alcohol': { severity: 'high', description: 'Severe drowsiness and impairment' },
    'doxylamine': { severity: 'high', description: 'Excessive sedation' },
    'loratadine': { severity: 'medium', description: 'Increased drowsiness' }
  },
  'loratadine': {
    'cetirizine': { severity: 'medium', description: 'No added benefit, increased side effects' },
    'alcohol': { severity: 'medium', description: 'Increased drowsiness' }
  },
  'cetirizine': {
    'loratadine': { severity: 'medium', description: 'No added benefit' },
    'diphenhydramine': { severity: 'medium', description: 'Increased drowsiness' }
  },

  // Digestive
  'omeprazole': {
    'clopidogrel': { severity: 'high', description: 'Reduced effectiveness of clopidogrel' },
    'calcium': { severity: 'medium', description: 'Reduced calcium absorption' }
  },
  'ranitidine': {
    'omeprazole': { severity: 'medium', description: 'No added benefit' }
  },

  // Supplements
  'vitamin-d': {
    'calcium': { severity: 'none', description: 'Beneficial combination' },
    'magnesium': { severity: 'none', description: 'Safe combination' }
  },
  'calcium': {
    'vitamin-d': { severity: 'none', description: 'Beneficial combination' },
    'iron': { severity: 'medium', description: 'Reduced iron absorption' }
  },
  'iron': {
    'calcium': { severity: 'medium', description: 'Take separately for best absorption' },
    'omeprazole': { severity: 'medium', description: 'Reduced iron absorption' }
  }
};

class InteractionHeatmap {
  constructor() {
    this.medicines = [];
    this.selectedCell = null;
    this.init();
  }

  init() {
    // Wait for DOM and medicine cabinet to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }

  setup() {
    // Load medicines from medicine cabinet
    this.loadMedicines();

    // Setup event listeners
    this.setupEventListeners();

    // Render heatmap
    this.render();
  }

  loadMedicines() {
    try {
      // Get medicines from medicine cabinet
      const cabinetData = localStorage.getItem('medicine_cabinet');
      if (cabinetData) {
        const allMeds = JSON.parse(cabinetData);
        // Only include medicines that we have interaction data for
        this.medicines = allMeds.filter(med => this.hasMedicineInDatabase(med.name));
      }
    } catch (error) {
      console.error('Error loading medicines:', error);
      this.medicines = [];
    }
  }

  hasMedicineInDatabase(medicineName) {
    const normalized = this.normalizeMedicineName(medicineName);
    return DRUG_INTERACTIONS.hasOwnProperty(normalized);
  }

  normalizeMedicineName(name) {
    // Convert medicine names to match our database keys
    // Remove dosages, brand names, etc.
    const normalized = name.toLowerCase()
      .replace(/\d+\s?mg/gi, '')
      .replace(/\d+\s?mcg/gi, '')
      .replace(/tablet|capsule|pill|liquid|syrup/gi, '')
      .replace(/brand|generic/gi, '')
      .trim();

    // Common name mappings
    const mappings = {
      'tylenol': 'acetaminophen',
      'advil': 'ibuprofen',
      'motrin': 'ibuprofen',
      'aleve': 'naproxen',
      'benadryl': 'diphenhydramine',
      'claritin': 'loratadine',
      'zyrtec': 'cetirizine',
      'sudafed': 'pseudoephedrine',
      'mucinex': 'guaifenesin',
      'prilosec': 'omeprazole',
      'zantac': 'ranitidine'
    };

    // Check if it matches a known mapping
    for (const [brand, generic] of Object.entries(mappings)) {
      if (normalized.includes(brand)) {
        return generic;
      }
    }

    // Check if it matches any drug in our database
    for (const drug of Object.keys(DRUG_INTERACTIONS)) {
      if (normalized.includes(drug) || drug.includes(normalized)) {
        return drug;
      }
    }

    return normalized;
  }

  getInteraction(med1, med2) {
    const name1 = this.normalizeMedicineName(med1);
    const name2 = this.normalizeMedicineName(med2);

    // Check both directions
    if (DRUG_INTERACTIONS[name1] && DRUG_INTERACTIONS[name1][name2]) {
      return DRUG_INTERACTIONS[name1][name2];
    }
    if (DRUG_INTERACTIONS[name2] && DRUG_INTERACTIONS[name2][name1]) {
      return DRUG_INTERACTIONS[name2][name1];
    }

    // No known interaction
    return { severity: 'none', description: 'No known interaction' };
  }

  getSeverityColor(severity) {
    const colors = {
      'none': '#4ade80',     // Green
      'low': '#86efac',      // Light green
      'medium': '#fbbf24',   // Yellow/Orange
      'high': '#ef4444'      // Red
    };
    return colors[severity] || '#6b7280'; // Gray for unknown
  }

  getSeverityLabel(severity) {
    const labels = {
      'none': 'No Interaction',
      'low': 'Minor',
      'medium': 'Moderate',
      'high': 'Major'
    };
    return labels[severity] || 'Unknown';
  }

  setupEventListeners() {
    // Refresh button
    const refreshBtn = document.getElementById('heatmap-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadMedicines();
        this.render();
        this.showNotification('Heatmap refreshed', 'success');
      });
    }

    // Legend toggle
    const legendBtn = document.getElementById('heatmap-legend-toggle');
    if (legendBtn) {
      legendBtn.addEventListener('click', () => {
        const legend = document.getElementById('heatmap-legend');
        if (legend) {
          legend.classList.toggle('hidden');
        }
      });
    }
  }

  render() {
    const container = document.getElementById('interaction-heatmap-display');
    if (!container) return;

    if (this.medicines.length === 0) {
      container.innerHTML = this.renderEmptyState();
      return;
    }

    if (this.medicines.length === 1) {
      container.innerHTML = this.renderSingleMedicineState();
      return;
    }

    container.innerHTML = this.renderHeatmap();

    // Attach event listeners to cells
    this.attachCellEventListeners();
  }

  renderEmptyState() {
    return `
      <div class="heatmap-empty-state">
        <div class="empty-icon">
          <i class="fas fa-chart-area"></i>
        </div>
        <h3>No Medicines to Analyze</h3>
        <p>Add medicines to your Digital Medicine Cabinet to see potential drug interactions.</p>
        <button class="btn-primary" onclick="document.getElementById('nav-medications').click()">
          <i class="fas fa-pills"></i> Go to Medicine Cabinet
        </button>
      </div>
    `;
  }

  renderSingleMedicineState() {
    return `
      <div class="heatmap-empty-state">
        <div class="empty-icon">
          <i class="fas fa-info-circle"></i>
        </div>
        <h3>Need More Medicines</h3>
        <p>Add at least 2 medicines to see interaction analysis.</p>
        <p class="heatmap-hint">Current: <strong>${this.medicines[0].name}</strong></p>
        <button class="btn-primary" onclick="document.getElementById('nav-medications').click()">
          <i class="fas fa-plus"></i> Add More Medicines
        </button>
      </div>
    `;
  }

  renderHeatmap() {
    const size = this.medicines.length;

    let html = `
      <div class="heatmap-wrapper">
        <div class="heatmap-info">
          <p><i class="fas fa-info-circle"></i> Analyzing ${size} medicine${size > 1 ? 's' : ''} for potential interactions</p>
        </div>

        <div class="heatmap-scroll-container">
          <table class="interaction-heatmap-table">
            <thead>
              <tr>
                <th class="heatmap-corner"></th>
                ${this.medicines.map((med, i) => `
                  <th class="heatmap-header-cell" data-index="${i}">
                    <div class="header-label">${this.truncateName(med.name)}</div>
                  </th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
    `;

    // Generate matrix cells
    this.medicines.forEach((med1, i) => {
      html += `
        <tr>
          <th class="heatmap-row-header" data-index="${i}">
            <div class="header-label">${this.truncateName(med1.name)}</div>
          </th>
      `;

      this.medicines.forEach((med2, j) => {
        if (i === j) {
          // Same medicine - diagonal
          html += `<td class="heatmap-cell heatmap-cell-self"></td>`;
        } else if (i < j) {
          // Upper triangle - show interaction
          const interaction = this.getInteraction(med1.name, med2.name);
          const color = this.getSeverityColor(interaction.severity);

          html += `
            <td class="heatmap-cell heatmap-cell-interactive"
                data-med1="${i}"
                data-med2="${j}"
                data-severity="${interaction.severity}"
                style="background-color: ${color};">
              <span class="severity-icon">${this.getSeverityIcon(interaction.severity)}</span>
            </td>
          `;
        } else {
          // Lower triangle - mirror (leave empty for cleaner look)
          html += `<td class="heatmap-cell heatmap-cell-empty"></td>`;
        }
      });

      html += `</tr>`;
    });

    html += `
            </tbody>
          </table>
        </div>

        <!-- Interaction Detail Panel -->
        <div id="interaction-detail-panel" class="interaction-detail-panel hidden">
          <div class="detail-panel-header">
            <h4>Interaction Details</h4>
            <button class="detail-panel-close" onclick="this.closest('.interaction-detail-panel').classList.add('hidden')">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div id="interaction-detail-content" class="detail-panel-content">
            <!-- Details will be inserted here -->
          </div>
        </div>

        <!-- Legend -->
        <div class="heatmap-legend" id="heatmap-legend">
          <h4><i class="fas fa-info-circle"></i> Severity Legend</h4>
          <div class="legend-items">
            <div class="legend-item">
              <div class="legend-color" style="background-color: ${this.getSeverityColor('none')}"></div>
              <span>No Interaction</span>
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background-color: ${this.getSeverityColor('low')}"></div>
              <span>Minor</span>
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background-color: ${this.getSeverityColor('medium')}"></div>
              <span>Moderate - Monitor</span>
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background-color: ${this.getSeverityColor('high')}"></div>
              <span>Major - Avoid</span>
            </div>
          </div>
        </div>
      </div>
    `;

    return html;
  }

  getSeverityIcon(severity) {
    const icons = {
      'none': '',
      'low': '⚠',
      'medium': '⚠',
      'high': '⚠'
    };
    return icons[severity] || '';
  }

  truncateName(name, maxLength = 15) {
    return name.length > maxLength ? name.substring(0, maxLength) + '...' : name;
  }

  attachCellEventListeners() {
    document.querySelectorAll('.heatmap-cell-interactive').forEach(cell => {
      cell.addEventListener('click', (e) => {
        const med1Index = parseInt(e.currentTarget.dataset.med1);
        const med2Index = parseInt(e.currentTarget.dataset.med2);

        this.showInteractionDetail(med1Index, med2Index);
      });

      cell.addEventListener('mouseenter', (e) => {
        e.currentTarget.style.transform = 'scale(1.1)';
        e.currentTarget.style.zIndex = '10';
      });

      cell.addEventListener('mouseleave', (e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.zIndex = '1';
      });
    });
  }

  showInteractionDetail(med1Index, med2Index) {
    const med1 = this.medicines[med1Index];
    const med2 = this.medicines[med2Index];
    const interaction = this.getInteraction(med1.name, med2.name);

    const panel = document.getElementById('interaction-detail-panel');
    const content = document.getElementById('interaction-detail-content');

    if (!panel || !content) return;

    const severityColor = this.getSeverityColor(interaction.severity);

    content.innerHTML = `
      <div class="interaction-detail-medicines">
        <div class="detail-medicine">
          <i class="fas fa-pills"></i>
          <strong>${med1.name}</strong>
          ${med1.dosage ? `<span class="dosage">${med1.dosage}</span>` : ''}
        </div>
        <div class="interaction-icon" style="color: ${severityColor}">
          <i class="fas fa-exchange-alt"></i>
        </div>
        <div class="detail-medicine">
          <i class="fas fa-pills"></i>
          <strong>${med2.name}</strong>
          ${med2.dosage ? `<span class="dosage">${med2.dosage}</span>` : ''}
        </div>
      </div>

      <div class="interaction-severity" style="background-color: ${severityColor}20; border-left: 4px solid ${severityColor}">
        <div class="severity-badge" style="background-color: ${severityColor}">
          ${this.getSeverityLabel(interaction.severity)}
        </div>
        <p>${interaction.description}</p>
      </div>

      ${interaction.severity === 'high' ? `
        <div class="interaction-warning">
          <i class="fas fa-exclamation-triangle"></i>
          <strong>Warning:</strong> This is a major interaction. Consult your doctor or pharmacist before taking these medications together.
        </div>
      ` : ''}

      ${interaction.severity === 'medium' ? `
        <div class="interaction-caution">
          <i class="fas fa-info-circle"></i>
          <strong>Caution:</strong> Monitor for increased side effects. Consult your healthcare provider if you have concerns.
        </div>
      ` : ''}

      <div class="detail-actions">
        <button class="btn-secondary" onclick="this.closest('.interaction-detail-panel').classList.add('hidden')">
          Close
        </button>
      </div>
    `;

    panel.classList.remove('hidden');
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i>
      <span>${message}</span>
    `;

    const container = document.getElementById('notification-container') || document.body;
    container.appendChild(notification);

    setTimeout(() => notification.classList.add('show'), 100);
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// Initialize the heatmap
let interactionHeatmap;

// Wait for medicine cabinet to be loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      interactionHeatmap = new InteractionHeatmap();
      window.interactionHeatmap = interactionHeatmap;
    }, 500);
  });
} else {
  setTimeout(() => {
    interactionHeatmap = new InteractionHeatmap();
    window.interactionHeatmap = interactionHeatmap;
  }, 500);
}

// Export
export default InteractionHeatmap;

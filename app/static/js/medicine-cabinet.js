/**
 * Medicine Cabinet - Digital Medicine Organization System
 * A localStorage-based visual medicine cabinet for tracking medications
 * Features: Visual organization, expiration tracking, categories, quick access
 */

class MedicineCabinet {
  constructor() {
    this.storageKey = 'medicine_cabinet';
    this.medicines = this.loadMedicines();
    this.categories = ['Pain Relief', 'Cold & Flu', 'Allergy', 'Digestive', 'First Aid', 'Vitamins', 'Prescription', 'Other'];
    this.init();
  }

  init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
    } else {
      this.setupEventListeners();
    }
  }

  setupEventListeners() {
    // Add medicine button
    const addBtn = document.getElementById('cabinet-add-medicine-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.showAddMedicineModal());
    }

    // View toggle buttons (grid vs cabinet view)
    const gridViewBtn = document.getElementById('cabinet-grid-view');
    const cabinetViewBtn = document.getElementById('cabinet-shelf-view');

    if (gridViewBtn) {
      gridViewBtn.addEventListener('click', () => this.switchView('grid'));
    }
    if (cabinetViewBtn) {
      cabinetViewBtn.addEventListener('click', () => this.switchView('cabinet'));
    }

    // Category filter
    const categoryFilter = document.getElementById('cabinet-category-filter');
    if (categoryFilter) {
      categoryFilter.addEventListener('change', (e) => this.filterByCategory(e.target.value));
    }

    // Search
    const searchInput = document.getElementById('cabinet-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.search(e.target.value));
    }

    // Render the cabinet
    this.render();
  }

  loadMedicines() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error loading medicines:', error);
      return [];
    }
  }

  saveMedicines() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.medicines));
    } catch (error) {
      console.error('Error saving medicines:', error);
    }
  }

  addMedicine(medicineData) {
    const medicine = {
      id: Date.now().toString(),
      name: medicineData.name,
      category: medicineData.category || 'Other',
      dosage: medicineData.dosage || '',
      quantity: medicineData.quantity || 0,
      expirationDate: medicineData.expirationDate || null,
      notes: medicineData.notes || '',
      addedDate: new Date().toISOString(),
      color: this.getCategoryColor(medicineData.category)
    };

    this.medicines.push(medicine);
    this.saveMedicines();
    this.render();
    return medicine;
  }

  removeMedicine(medicineId) {
    this.medicines = this.medicines.filter(m => m.id !== medicineId);
    this.saveMedicines();
    this.render();
  }

  updateMedicine(medicineId, updates) {
    const index = this.medicines.findIndex(m => m.id === medicineId);
    if (index !== -1) {
      this.medicines[index] = { ...this.medicines[index], ...updates };
      this.saveMedicines();
      this.render();
    }
  }

  getCategoryColor(category) {
    const colors = {
      'Pain Relief': '#ff6b6b',
      'Cold & Flu': '#4ecdc4',
      'Allergy': '#95e1d3',
      'Digestive': '#f38181',
      'First Aid': '#ff6348',
      'Vitamins': '#feca57',
      'Prescription': '#48dbfb',
      'Other': '#dfe6e9'
    };
    return colors[category] || colors['Other'];
  }

  isExpiringSoon(expirationDate) {
    if (!expirationDate) return false;

    const now = new Date();
    const expDate = new Date(expirationDate);
    const daysUntilExpiration = Math.floor((expDate - now) / (1000 * 60 * 60 * 24));

    return daysUntilExpiration <= 30 && daysUntilExpiration >= 0;
  }

  isExpired(expirationDate) {
    if (!expirationDate) return false;

    const now = new Date();
    const expDate = new Date(expirationDate);

    return expDate < now;
  }

  formatExpirationDate(expirationDate) {
    if (!expirationDate) return 'No expiration date';

    const expDate = new Date(expirationDate);
    const now = new Date();
    const daysUntilExpiration = Math.floor((expDate - now) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiration < 0) {
      return `Expired ${Math.abs(daysUntilExpiration)} days ago`;
    } else if (daysUntilExpiration === 0) {
      return 'Expires today';
    } else if (daysUntilExpiration <= 30) {
      return `Expires in ${daysUntilExpiration} days`;
    } else {
      return `Expires ${expDate.toLocaleDateString()}`;
    }
  }

  switchView(viewType) {
    const container = document.getElementById('medicine-cabinet-display');
    if (!container) return;

    container.dataset.view = viewType;

    // Update active button
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    if (viewType === 'grid') {
      document.getElementById('cabinet-grid-view')?.classList.add('active');
    } else {
      document.getElementById('cabinet-shelf-view')?.classList.add('active');
    }

    this.render();
  }

  filterByCategory(category) {
    this.currentFilter = category;
    this.render();
  }

  search(query) {
    this.currentSearch = query.toLowerCase();
    this.render();
  }

  getFilteredMedicines() {
    let filtered = [...this.medicines];

    // Apply category filter
    if (this.currentFilter && this.currentFilter !== 'all') {
      filtered = filtered.filter(m => m.category === this.currentFilter);
    }

    // Apply search
    if (this.currentSearch) {
      filtered = filtered.filter(m =>
        m.name.toLowerCase().includes(this.currentSearch) ||
        m.category.toLowerCase().includes(this.currentSearch) ||
        (m.notes && m.notes.toLowerCase().includes(this.currentSearch))
      );
    }

    return filtered;
  }

  render() {
    const container = document.getElementById('medicine-cabinet-display');
    if (!container) return;

    const medicines = this.getFilteredMedicines();
    const viewType = container.dataset.view || 'cabinet';

    if (medicines.length === 0) {
      container.innerHTML = this.renderEmptyState();
      return;
    }

    // Group by category for cabinet view
    if (viewType === 'cabinet') {
      container.innerHTML = this.renderCabinetView(medicines);
    } else {
      container.innerHTML = this.renderGridView(medicines);
    }

    // Add event listeners to medicine cards
    this.attachCardEventListeners();
  }

  renderEmptyState() {
    return `
      <div class="cabinet-empty-state">
        <div class="empty-cabinet-icon">
          <i class="fas fa-box-open"></i>
        </div>
        <h3>Your Medicine Cabinet is Empty</h3>
        <p>Start adding medicines to organize your healthcare supplies</p>
        <button class="btn-primary" onclick="medicineCabinet.showAddMedicineModal()">
          <i class="fas fa-plus"></i> Add Your First Medicine
        </button>
      </div>
    `;
  }

  renderCabinetView(medicines) {
    // Group medicines by category
    const grouped = {};
    this.categories.forEach(cat => {
      grouped[cat] = medicines.filter(m => m.category === cat);
    });

    let html = '<div class="medicine-cabinet-shelves">';

    // Render each category as a shelf
    this.categories.forEach(category => {
      const categoryMeds = grouped[category];
      if (categoryMeds.length > 0) {
        html += `
          <div class="cabinet-shelf" data-category="${category}">
            <div class="shelf-label">
              <i class="fas fa-tag"></i>
              <span>${category}</span>
              <span class="shelf-count">${categoryMeds.length}</span>
            </div>
            <div class="shelf-medicines">
              ${categoryMeds.map(med => this.renderMedicineCard(med, 'shelf')).join('')}
            </div>
          </div>
        `;
      }
    });

    html += '</div>';
    return html;
  }

  renderGridView(medicines) {
    return `
      <div class="medicine-grid">
        ${medicines.map(med => this.renderMedicineCard(med, 'grid')).join('')}
      </div>
    `;
  }

  renderMedicineCard(medicine, viewType) {
    const isExpired = this.isExpired(medicine.expirationDate);
    const isExpiringSoon = this.isExpiringSoon(medicine.expirationDate);
    const expirationClass = isExpired ? 'expired' : (isExpiringSoon ? 'expiring-soon' : '');

    return `
      <div class="medicine-card ${viewType}-view ${expirationClass}"
           data-medicine-id="${medicine.id}"
           style="border-left: 4px solid ${medicine.color}">
        <div class="medicine-card-header">
          <div class="medicine-name">
            <i class="fas fa-pills"></i>
            <strong>${medicine.name}</strong>
          </div>
          <div class="medicine-actions">
            <button class="btn-icon" data-action="edit" title="Edit">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icon" data-action="delete" title="Delete">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>

        <div class="medicine-card-body">
          ${medicine.dosage ? `
            <div class="medicine-detail">
              <i class="fas fa-prescription"></i>
              <span>${medicine.dosage}</span>
            </div>
          ` : ''}

          ${medicine.quantity !== undefined && medicine.quantity !== null ? `
            <div class="medicine-detail">
              <i class="fas fa-box"></i>
              <span>${medicine.quantity} ${medicine.quantity === 1 ? 'unit' : 'units'} remaining</span>
            </div>
          ` : ''}

          <div class="medicine-detail expiration-info ${expirationClass}">
            <i class="fas fa-calendar-alt"></i>
            <span>${this.formatExpirationDate(medicine.expirationDate)}</span>
            ${isExpired ? '<i class="fas fa-exclamation-triangle expired-icon"></i>' : ''}
            ${isExpiringSoon ? '<i class="fas fa-exclamation-circle warning-icon"></i>' : ''}
          </div>

          ${medicine.notes ? `
            <div class="medicine-notes">
              <i class="fas fa-sticky-note"></i>
              <span>${medicine.notes}</span>
            </div>
          ` : ''}
        </div>

        <div class="medicine-card-footer">
          <span class="medicine-category-badge" style="background-color: ${medicine.color}20; color: ${medicine.color}">
            ${medicine.category}
          </span>
        </div>
      </div>
    `;
  }

  attachCardEventListeners() {
    // Edit buttons
    document.querySelectorAll('.medicine-card [data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.medicine-card');
        const medicineId = card.dataset.medicineId;
        this.showEditMedicineModal(medicineId);
      });
    });

    // Delete buttons
    document.querySelectorAll('.medicine-card [data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.medicine-card');
        const medicineId = card.dataset.medicineId;
        this.confirmDelete(medicineId);
      });
    });
  }

  showAddMedicineModal() {
    const modal = this.createMedicineModal();
    document.body.appendChild(modal);

    // Focus first input
    setTimeout(() => {
      document.getElementById('medicine-name-input')?.focus();
    }, 100);
  }

  showEditMedicineModal(medicineId) {
    const medicine = this.medicines.find(m => m.id === medicineId);
    if (!medicine) return;

    const modal = this.createMedicineModal(medicine);
    document.body.appendChild(modal);
  }

  createMedicineModal(medicine = null) {
    const isEdit = !!medicine;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content medicine-modal">
        <div class="modal-header">
          <h3><i class="fas fa-pills"></i> ${isEdit ? 'Edit' : 'Add'} Medicine</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="modal-body">
          <form id="medicine-form">
            <div class="form-group">
              <label for="medicine-name-input">Medicine Name *</label>
              <input type="text" id="medicine-name-input" name="name"
                     value="${medicine?.name || ''}" required>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="medicine-category-input">Category</label>
                <select id="medicine-category-input" name="category">
                  ${this.categories.map(cat => `
                    <option value="${cat}" ${medicine?.category === cat ? 'selected' : ''}>
                      ${cat}
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group">
                <label for="medicine-dosage-input">Dosage</label>
                <input type="text" id="medicine-dosage-input" name="dosage"
                       value="${medicine?.dosage || ''}" placeholder="e.g., 500mg">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="medicine-quantity-input">Quantity</label>
                <input type="number" id="medicine-quantity-input" name="quantity"
                       value="${medicine?.quantity || 0}" min="0">
              </div>

              <div class="form-group">
                <label for="medicine-expiration-input">Expiration Date</label>
                <input type="date" id="medicine-expiration-input" name="expirationDate"
                       value="${medicine?.expirationDate || ''}">
              </div>
            </div>

            <div class="form-group">
              <label for="medicine-notes-input">Notes</label>
              <textarea id="medicine-notes-input" name="notes" rows="3"
                        placeholder="Any special instructions or notes...">${medicine?.notes || ''}</textarea>
            </div>
          </form>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">
            Cancel
          </button>
          <button class="btn-primary" id="save-medicine-btn">
            <i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Add'} Medicine
          </button>
        </div>
      </div>
    `;

    // Save button handler
    modal.querySelector('#save-medicine-btn').addEventListener('click', () => {
      const form = modal.querySelector('#medicine-form');
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const formData = new FormData(form);
      const medicineData = {
        name: formData.get('name'),
        category: formData.get('category'),
        dosage: formData.get('dosage'),
        quantity: parseInt(formData.get('quantity')) || 0,
        expirationDate: formData.get('expirationDate') || null,
        notes: formData.get('notes')
      };

      if (isEdit) {
        this.updateMedicine(medicine.id, medicineData);
      } else {
        this.addMedicine(medicineData);
      }

      modal.remove();
      this.showNotification(
        `Medicine ${isEdit ? 'updated' : 'added'} successfully!`,
        'success'
      );
    });

    return modal;
  }

  confirmDelete(medicineId) {
    const medicine = this.medicines.find(m => m.id === medicineId);
    if (!medicine) return;

    if (confirm(`Are you sure you want to delete "${medicine.name}"?`)) {
      this.removeMedicine(medicineId);
      this.showNotification('Medicine deleted successfully', 'success');
    }
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

  // Get statistics
  getStats() {
    return {
      total: this.medicines.length,
      expiringSoon: this.medicines.filter(m => this.isExpiringSoon(m.expirationDate)).length,
      expired: this.medicines.filter(m => this.isExpired(m.expirationDate)).length,
      byCategory: this.categories.reduce((acc, cat) => {
        acc[cat] = this.medicines.filter(m => m.category === cat).length;
        return acc;
      }, {})
    };
  }
}

// Initialize the medicine cabinet
const medicineCabinet = new MedicineCabinet();

// Make it globally available
window.medicineCabinet = medicineCabinet;

// Export for module use
export default medicineCabinet;

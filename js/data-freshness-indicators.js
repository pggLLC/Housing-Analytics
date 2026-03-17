/**
 * Data Freshness Indicators
 * Shows cache age, source, and last update time for all metrics
 * Helps users understand data quality and recency
 */

const DATA_SOURCES = {
  'census-acs': {
    name: 'US Census ACS',
    vintage: 5,  // 5-year rolling average
    updateFrequency: 'Annually (July)',
    url: 'https://www.census.gov/programs-surveys/acs'
  },
  'hud-ami': {
    name: 'HUD Area Median Income',
    vintage: 'Annual',
    updateFrequency: 'Annually (April)',
    url: 'https://www.huduser.gov/portal/datasets/lihtc.html'
  },
  'fred': {
    name: 'Federal Reserve Economic Data',
    vintage: 'Current',
    updateFrequency: 'Weekly',
    url: 'https://fred.stlouisfed.org'
  },
  'chfa-lihtc': {
    name: 'Colorado LIHTC Projects',
    vintage: 'Historical',
    updateFrequency: 'Weekly (approx)',
    url: 'https://gis.dola.colorado.gov/gis/rest/services/CHFA/LIHTC_Projects'
  },
  'car-market': {
    name: 'CAR Market Data',
    vintage: 'Monthly',
    updateFrequency: 'Monthly (1st of month)',
    url: 'https://www.car.org'
  }
};

class DataFreshnessIndicator {
  constructor() {
    this.manifest = null;
    this.cacheTimestamps = new Map();
    this.loadManifest();
  }

  async loadManifest() {
    try {
      const response = await fetch('/data/manifest.json');
      this.manifest = await response.json();
      this.parseManifest();
    } catch (error) {
      console.error('Failed to load manifest:', error);
    }
  }

  parseManifest() {
    if (!this.manifest || !this.manifest.data_sources) return;

    this.manifest.data_sources.forEach(source => {
      if (source.last_updated) {
        this.cacheTimestamps.set(source.name, new Date(source.last_updated));
      }
    });
  }

  /**
   * Get human-readable age of data
   * @param {Date|string} timestamp - When data was last fetched
   * @returns {string} Age description (e.g., "3 days old", "2 months old")
   */
  getDataAge(timestamp) {
    if (!timestamp) return 'Unknown';

    const ts = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const now = new Date();
    const diffMs = now - ts;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffDays < 1) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      return diffHours < 1 ? 'Just updated' : `${diffHours}h old`;
    } else if (diffDays < 30) {
      return `${diffDays}d old`;
    } else if (diffMonths < 12) {
      return `${diffMonths}mo old`;
    } else {
      return `${diffYears}y old`;
    }
  }

  /**
   * Determine data freshness color status
   * @param {number} daysSinceUpdate - Days since last update
   * @param {string} expectedFrequency - 'daily', 'weekly', 'monthly', 'annual'
   * @returns {object} { color, status, icon }
   */
  getDataStatus(daysSinceUpdate, expectedFrequency = 'monthly') {
    const thresholds = {
      'daily': { good: 1, warning: 3, critical: 7 },
      'weekly': { good: 7, warning: 14, critical: 30 },
      'monthly': { good: 35, warning: 60, critical: 90 },
      'annual': { good: 400, warning: 500, critical: 730 }
    };

    const threshold = thresholds[expectedFrequency] || thresholds.monthly;

    if (daysSinceUpdate <= threshold.good) {
      return {
        color: '#0fd4cf',  // teal
        status: 'Fresh',
        icon: '✅',
        class: 'data-fresh'
      };
    } else if (daysSinceUpdate <= threshold.warning) {
      return {
        color: '#FFB81C',  // orange
        status: 'Aging',
        icon: '⚠️',
        class: 'data-aging'
      };
    } else {
      return {
        color: '#E63946',  // red
        status: 'Stale',
        icon: '🔴',
        class: 'data-stale'
      };
    }
  }

  /**
   * Create freshness badge HTML
   * @param {object} options - { source, timestamp, frequency }
   * @returns {string} HTML badge
   */
  createFreshnessBadge(options) {
    const { source, timestamp, frequency = 'monthly', value } = options;

    if (!timestamp) {
      return `<div class="data-freshness-badge data-unknown">
        <span class="icon">❓</span>
        <span class="text">Data age unknown</span>
      </div>`;
    }

    const ts = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const now = new Date();
    const diffMs = now - ts;
    const daysSinceUpdate = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const status = this.getDataStatus(daysSinceUpdate, frequency);

    const sourceInfo = DATA_SOURCES[source];

    return `<div class="data-freshness-badge ${status.class}">
      <div class="freshness-header">
        <span class="icon">${status.icon}</span>
        <span class="status">${status.status}</span>
        <span class="age">${this.getDataAge(ts)}</span>
      </div>
      <div class="freshness-details">
        <div class="detail-row">
          <span class="label">Data:</span>
          <span class="value">${sourceInfo ? sourceInfo.name : source}</span>
        </div>
        <div class="detail-row">
          <span class="label">Last Updated:</span>
          <span class="value">${ts.toLocaleDateString()}</span>
        </div>
        <div class="detail-row">
          <span class="label">Update Frequency:</span>
          <span class="value">${sourceInfo ? sourceInfo.updateFrequency : 'Unknown'}</span>
        </div>
        ${sourceInfo ? `<div class="detail-row">
          <span class="label">Source:</span>
          <a href="${sourceInfo.url}" target="_blank" class="source-link">${sourceInfo.name}</a>
        </div>` : ''}
        <div class="detail-row">
          <button class="btn-refresh" data-source="${source}">🔄 Refresh Now</button>
        </div>
      </div>
    </div>`;
  }

  /**
   * Attach freshness badge to metric element
   * @param {HTMLElement} element - Target element
   * @param {object} options - { source, timestamp, frequency, value }
   */
  attachFreshnessBadge(element, options) {
    if (!element) return;

    const badge = this.createFreshnessBadge(options);
    const wrapper = document.createElement('div');
    wrapper.className = 'metric-with-freshness';
    wrapper.innerHTML = `<div class="metric-value">${options.value || element.innerHTML}</div>${badge}`;

    element.replaceWith(wrapper);

    // Attach refresh handler
    const refreshBtn = wrapper.querySelector('.btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.triggerDataRefresh(options.source));
    }
  }

  /**
   * Trigger workflow to refresh specific data source
   * @param {string} source - Data source name
   */
  async triggerDataRefresh(source) {
    console.log('Refresh triggered for:', source);
    // This would integrate with GitHub Actions API
    // Placeholder for now
    alert(`Refresh queued for ${source}. Check back in 5 minutes.`);
  }
}

// CSS for data freshness badges
const FRESHNESS_STYLES = `<style>
  .data-freshness-badge {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 12px;
    margin-top: 8px;
    font-size: 13px;
    background: var(--color-bg-secondary);
  }

  .data-freshness-badge.data-fresh {
    border-color: #0fd4cf;
    background: rgba(15, 212, 207, 0.05);
  }

  .data-freshness-badge.data-aging {
    border-color: #FFB81C;
    background: rgba(255, 184, 28, 0.05);
  }

  .data-freshness-badge.data-stale {
    border-color: #E63946;
    background: rgba(230, 57, 70, 0.05);
  }

  .data-freshness-badge.data-unknown {
    border-color: var(--color-border);
  }

  .freshness-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    font-weight: 600;
  }

  .freshness-details {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
  }

  .detail-row .label {
    font-weight: 500;
    color: var(--color-text-muted);
  }

  .source-link {
    color: var(--color-accent);
    text-decoration: none;
  }

  .source-link:hover {
    text-decoration: underline;
  }

  .btn-refresh {
    padding: 6px 12px;
    background: var(--color-accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    margin-top: 8px;
  }

  .btn-refresh:hover {
    opacity: 0.8;
  }

  .metric-with-freshness {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .metric-value {
    font-size: 32px;
    font-weight: bold;
    color: var(--color-text);
  }
</style>`;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Add styles
  const styleEl = document.createElement('div');
  styleEl.innerHTML = FRESHNESS_STYLES;
  document.head.appendChild(styleEl);

  // Initialize indicator
  window.dataFreshness = new DataFreshnessIndicator();
});

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataFreshnessIndicator;
}
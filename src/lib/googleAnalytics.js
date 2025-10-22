/**
 * Google Analytics 4 Configuration and Utilities
 *
 * Setup Guide:
 * 1. Get your GA4 Measurement ID from https://analytics.google.com/
 * 2. Replace 'G-XXXXXXXXXX' with your actual Measurement ID in GOOGLE_ANALYTICS_CONFIG
 * 3. Set enabled to true to start tracking
 */

import ReactGA from 'react-ga4';

const isProduction = import.meta.env.MODE === 'production';

export const GOOGLE_ANALYTICS_CONFIG = {
  /**
   * Your Google Analytics 4 Measurement ID
   * Format: G-XXXXXXXXXX
   *
   * Get it from:
   * - Go to https://analytics.google.com/
   * - Admin > Data Streams > Your Stream
   * - Copy the Measurement ID
   */
  measurementId: 'G-XXXXXXXXXX', // Replace with your GA4 Measurement ID

  /**
   * Enable/disable Google Analytics
   * Set to false to disable all tracking
   */
  enabled: false, // Set to true when you add your measurement ID

  /**
   * Track in development environment
   * Set to true if you want to test analytics locally
   * Default: false (only track in production)
   */
  trackInDevelopment: false,

  /**
   * Determines if analytics should run based on environment and config
   */
  get shouldTrack() {
    // Don't track if disabled or no measurement ID
    if (!this.enabled || !this.measurementId || this.measurementId === 'G-XXXXXXXXXX') {
      return false;
    }

    // In development, only track if explicitly enabled
    if (!isProduction && !this.trackInDevelopment) {
      return false;
    }

    return true;
  }
};

/**
 * Initialize Google Analytics
 * Call this once when your app starts
 */
export const initializeGA = () => {
  if (!GOOGLE_ANALYTICS_CONFIG.shouldTrack) {
    console.log('[Google Analytics] Tracking disabled');
    if (!GOOGLE_ANALYTICS_CONFIG.enabled) {
      console.log('[Google Analytics] Reason: Disabled in config');
    } else if (!GOOGLE_ANALYTICS_CONFIG.measurementId || GOOGLE_ANALYTICS_CONFIG.measurementId === 'G-XXXXXXXXXX') {
      console.log('[Google Analytics] Reason: Invalid or missing measurement ID');
    } else if (!GOOGLE_ANALYTICS_CONFIG.trackInDevelopment) {
      console.log('[Google Analytics] Reason: Development environment');
    }
    return;
  }

  try {
    ReactGA.initialize(GOOGLE_ANALYTICS_CONFIG.measurementId, {
      gaOptions: {
        send_page_view: false, // We'll send manually for better control
      },
    });

    console.log('[Google Analytics] Initialized successfully with ID:', GOOGLE_ANALYTICS_CONFIG.measurementId);

    // Send initial page view
    ReactGA.send({
      hitType: 'pageview',
      page: window.location.pathname + window.location.search,
      title: document.title,
    });

    console.log('[Google Analytics] Page view tracked:', window.location.pathname);
  } catch (error) {
    console.error('[Google Analytics] Initialization error:', error);
  }
};

/**
 * Track a custom event
 *
 * @param {string} category - Event category (e.g., 'Chat', 'Model', 'User')
 * @param {string} action - Event action (e.g., 'Send Message', 'Load Model')
 * @param {string} [label] - Optional event label
 * @param {number} [value] - Optional numeric value
 *
 * @example
 * trackEvent('Chat', 'Send Message', 'User Query');
 * trackEvent('Model', 'Load', 'LFM2-700M');
 */
export const trackEvent = (category, action, label, value) => {
  if (!GOOGLE_ANALYTICS_CONFIG.shouldTrack) {
    return;
  }

  try {
    ReactGA.event({
      category,
      action,
      label,
      value,
    });
    console.log('[Google Analytics] Event tracked:', { category, action, label, value });
  } catch (error) {
    console.error('[Google Analytics] Event tracking error:', error);
  }
};

/**
 * Track a page view
 *
 * @param {string} path - The page path to track
 * @param {string} [title] - Optional page title
 *
 * @example
 * trackPageView('/chat', 'Chat Interface');
 */
export const trackPageView = (path, title) => {
  if (!GOOGLE_ANALYTICS_CONFIG.shouldTrack) {
    return;
  }

  try {
    ReactGA.send({
      hitType: 'pageview',
      page: path,
      title: title || document.title,
    });
    console.log('[Google Analytics] Page view tracked:', path);
  } catch (error) {
    console.error('[Google Analytics] Page view tracking error:', error);
  }
};

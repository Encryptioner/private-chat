# Google Analytics Setup Guide

This guide explains how to set up and use Google Analytics 4 (GA4) in the Private Chat application.

## Quick Setup

### Step 1: Get Your Google Analytics Measurement ID

1. Go to [Google Analytics](https://analytics.google.com/)
2. Sign in with your Google account
3. Create a new GA4 property (or use an existing one)
4. Navigate to **Admin** → **Data Streams**
5. Create or select a web data stream
6. Copy your **Measurement ID** (format: `G-XXXXXXXXXX`)

### Step 2: Configure Your Application

Open `src/lib/googleAnalytics.js` and update the configuration:

```javascript
export const GOOGLE_ANALYTICS_CONFIG = {
  measurementId: 'G-YOUR-MEASUREMENT-ID', // Replace with your actual ID
  enabled: true,                           // Set to true to enable tracking
  trackInDevelopment: false,               // Set to true to track in dev mode
  // ...
};
```

### Step 3: Deploy and Verify

1. Build and deploy your application:
   ```bash
   pnpm build
   ```

2. Visit your deployed application
3. Check the browser console for:
   ```
   [Google Analytics] Initialized successfully with ID: G-XXXXXXXXXX
   [Google Analytics] Page view tracked: /
   ```

4. Verify in GA4 dashboard:
   - Go to **Reports** → **Realtime**
   - You should see your active session

## Custom Event Tracking

### Track User Interactions

Use the `trackEvent` function to track custom events:

```javascript
import { trackEvent } from './lib/googleAnalytics';

// Track when user sends a message
trackEvent('Chat', 'Send Message', 'User Query');

// Track model selection
trackEvent('Model', 'Select', 'LFM2-700M');

// Track chat session actions
trackEvent('Session', 'Create', 'New Chat');
trackEvent('Session', 'Delete', 'Chat History');

// Track feature usage
trackEvent('Feature', 'Use', 'Voice Input');
trackEvent('Feature', 'Use', 'Copy Message');
```

### Example Integration in Components

```javascript
import { trackEvent } from './lib/googleAnalytics';

// In your message send handler
const handleSendMessage = (message) => {
  trackEvent('Chat', 'Send Message', message.length > 50 ? 'Long' : 'Short');
  // Your send logic here
};

// In your model loader
const handleLoadModel = (modelName) => {
  trackEvent('Model', 'Load', modelName);
  // Your load logic here
};

// In your chat session management
const handleNewSession = () => {
  trackEvent('Session', 'Create');
  // Your session creation logic
};
```

## Configuration

### Environment-Based Tracking

By default, analytics only tracks in **production**:

- **Development (`pnpm dev`)**: No tracking (unless `trackInDevelopment: true`)
- **Production (deployed)**: Tracking enabled

### Disabling Analytics

To completely disable analytics:

```javascript
export const GOOGLE_ANALYTICS_CONFIG = {
  measurementId: 'G-XXXXXXXXXX',
  enabled: false, // Disable all tracking
  // ...
};
```

## Viewing Analytics Data

### Real-Time Monitoring

1. Go to [analytics.google.com](https://analytics.google.com/)
2. Navigate to **Reports** → **Realtime**
3. View active users, events, and page views

### Event Reports

1. Navigate to **Reports** → **Engagement** → **Events**
2. View all tracked events with their counts
3. Click on any event to see details

## Suggested Events to Track

Here are recommended events for the Private Chat application:

```javascript
// Chat interactions
trackEvent('Chat', 'Send Message', messageType);
trackEvent('Chat', 'Copy Message');
trackEvent('Chat', 'Edit Message');
trackEvent('Chat', 'Delete Message');

// Model management
trackEvent('Model', 'Select', modelName);
trackEvent('Model', 'Load Start', modelName);
trackEvent('Model', 'Load Complete', modelName);
trackEvent('Model', 'Load Error', errorType);

// Session management
trackEvent('Session', 'Create');
trackEvent('Session', 'Switch', sessionId);
trackEvent('Session', 'Delete');
trackEvent('Session', 'Export');

// Features
trackEvent('Feature', 'Voice Input', 'Start');
trackEvent('Feature', 'Voice Input', 'Stop');
trackEvent('Feature', 'Text to Speech', 'Play');
trackEvent('Feature', 'Sidebar', 'Open');
trackEvent('Feature', 'Sidebar', 'Close');

// Performance
trackEvent('Performance', 'Response Time', null, responseTimeMs);
trackEvent('Performance', 'Token Generation', null, tokensPerSecond);
```

## Privacy Considerations

Since this is a privacy-focused application:

1. **No Personal Data**: Only track interaction patterns, not message content
2. **No User Identification**: Don't track user IDs or personal information
3. **Local Processing**: Analytics tracks UI interactions, not the actual chat content processed locally

Example of what NOT to track:
```javascript
// ❌ DON'T track message content
trackEvent('Chat', 'Message', userMessage); // NO!

// ✅ DO track interaction patterns
trackEvent('Chat', 'Send Message', 'User Query'); // YES!
```

## Troubleshooting

### Analytics Not Tracking

**Check browser console:**

1. Open your deployed application
2. Open browser DevTools (F12)
3. Check Console tab for messages

**Success:**
```
[Google Analytics] Initialized successfully with ID: G-XXXXXXXXXX
[Google Analytics] Page view tracked: /
```

**Disabled:**
```
[Google Analytics] Tracking disabled
[Google Analytics] Reason: Development environment
```

### Common Issues

**Issue: "Tracking disabled" in console**

**Solution:**
- If in development: Set `trackInDevelopment: true` in config
- If in production: Check `enabled: true` in config
- Verify measurement ID is valid (format: `G-XXXXXXXXXX`)

**Issue: No data in GA4 dashboard**

**Solutions:**
1. Wait 24-48 hours for initial data
2. Check Realtime reports (shows data immediately)
3. Verify Measurement ID is correct
4. Clear browser cache
5. Check for ad blockers

### Testing in Development

To test analytics locally:

1. Enable development tracking:
   ```javascript
   trackInDevelopment: true
   ```

2. Start dev server:
   ```bash
   pnpm dev
   ```

3. Open browser console to verify initialization

4. **Important:** Set `trackInDevelopment: false` before deploying

## Resources

- [Google Analytics 4 Documentation](https://support.google.com/analytics/answer/10089681)
- [react-ga4 Documentation](https://github.com/PriceRunner/react-ga4)
- [GA4 Help Center](https://support.google.com/analytics)

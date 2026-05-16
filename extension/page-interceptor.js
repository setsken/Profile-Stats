// This script runs IN THE PAGE CONTEXT to intercept fetch requests
// It must be loaded as a file (not inline) due to CSP restrictions

(function() {
  // Debug flag - set to false in production to disable all console logs.
  // Logs route to console.* directly — the previous version called log()
  // recursively from inside log() which would stack-overflow whenever
  // DEBUG was true.
  const DEBUG = false;
  function log(...args) { if (DEBUG) try { console.log('[PS page]', ...args); } catch {} }
  function logError(...args) { if (DEBUG) try { console.error('[PS page]', ...args); } catch {} }

  // Check authentication before installing the fetch hook. PS owns
  // psAuthStatus; we fall back to the legacy ofStatsAuthStatus only when
  // PS hasn't stamped anything yet (first run after install, before the
  // SW broadcast has hit this tab). Without this fallback an SE logout
  // wrote 'not_authenticated' into the shared key and PS's interceptor
  // bailed out — the badge never rendered even though PS was signed in.
  const _ps = localStorage.getItem('psAuthStatus');
  const _se = localStorage.getItem('ofStatsAuthStatus');
  const isAuthenticated = _ps === 'authenticated'
    || (_ps == null && _se === 'authenticated');
  if (!isAuthenticated) {
    log('User not authenticated, interceptor disabled', { ps: _ps, se: _se });
    return;
  }
  
  if (window.__ofStatsInterceptorInstalled) return;
  window.__ofStatsInterceptorInstalled = true;
  
  log('OF Stats: Installing fetch interceptor in page context...');
  
  // Store intercepted profile data
  window.ofStatsProfileData = window.ofStatsProfileData || {};
  
  // Helper function to process user data
  function processUserData(url, data) {
    if (!data || (!data.id && !data.username && !data.name)) return;
    // Skip if this looks like a list/array response
    if (Array.isArray(data)) return;
    // Skip if no username (not a profile response)
    if (!data.username && !data.name) return;
    
    log('OF Stats: Processing user data from:', url);
    
    // Log ALL fields to find hidden data
    log('OF Stats: === ALL RAW DATA FIELDS ===');
    for (const key in data) {
      const val = data[key];
      if (val !== null && val !== undefined && val !== '' && typeof val !== 'object') {
        log('  ' + key + ':', val);
      }
    }
    log('OF Stats: === END RAW DATA ===');
    
    const profileData = {
      id: data.id,
      username: data.username,
      name: data.name,
      // Stats
      subscribersCount: data.subscribersCount,
      subscribedCount: data.subscribedCount,
      postsCount: data.postsCount,
      photosCount: data.photosCount,
      videosCount: data.videosCount,
      audiosCount: data.audiosCount,
      mediasCount: data.mediasCount,
      archivedPostsCount: data.archivedPostsCount,
      favoritesCount: data.favoritesCount,
      favoritedCount: data.favoritedCount,
      finishedStreamsCount: data.finishedStreamsCount,
      // Profile info
      joinDate: data.joinDate,
      firstPublishedPostDate: data.firstPublishedPostDate,
      lastSeen: data.lastSeen,
      isVerified: data.isVerified,
      isPerformer: data.isPerformer,
      subscribePrice: data.subscribePrice,
      location: data.location,
      website: data.website,
      wishlistUrl: data.wishlistUrl || null,
      about: data.about,
      // Subscription info
      subscribedBy: data.subscribedBy,
      subscribedByExpire: data.subscribedByExpire,
      subscribedByExpireDate: data.subscribedByExpireDate,
      subscribedIsExpiredNow: data.subscribedIsExpiredNow,
      subscribedOn: data.subscribedOn,
      subscribedOnDuration: data.subscribedOnDuration,
      // Visual profile
      avatar: data.avatar || null,
      header: data.header || null,
      // Additional
      hasLabels: data.hasLabels,
      canEarn: data.canEarn,
      canPayInternal: data.canPayInternal,
      unprofpilesCount: data.unprofpilesCount,
      hasStream: data.hasStream,
      hasStories: data.hasStories,
      canCommentStory: data.canCommentStory,
      showSubscribersCount: data.showSubscribersCount,
      isFriend: data.isFriend,
      // Raw data for debugging
      _raw: data
    };
    
    const username = (data.username || '').toLowerCase();
    if (username && username !== 'me') {
      window.ofStatsProfileData[username] = profileData;
      
      // Only dispatch event if this profile matches current page URL
      const currentPath = window.location.pathname;
      const pathUsername = currentPath.split('/')[1]?.toLowerCase();
      
      if (!pathUsername || pathUsername === username) {
        log('OF Stats: Dispatching profile data for @' + username + ' (current page)');
        // Dispatch event for content script to pick up
        window.dispatchEvent(new CustomEvent('ofStatsProfileData', { 
          detail: profileData 
        }));
      } else {
        log('OF Stats: Cached profile for @' + username + ' (not current page: /' + pathUsername + ')');
      }
    }
  }
  
  // Check if URL is a user profile request (main profile endpoint only)
  function isUserProfileUrl(url) {
    // Must be users endpoint
    if (!url.includes('/api2/v2/users/')) return false;
    
    // Exclude sub-endpoints
    const excludePatterns = [
      '/posts', '/media', '/stories', '/subscribers', '/subscriptions',
      '/lists', '/friends', '/labels', '/social/', '/highlights',
      '/promotions', '/profile/view'
    ];
    
    for (const pattern of excludePatterns) {
      if (url.includes(pattern)) return false;
    }
    
    // Should match /api2/v2/users/{username} or /api2/v2/users/{id}
    const match = url.match(/\/api2\/v2\/users\/([a-zA-Z0-9_.-]+)(\?|$)/);
    return !!match;
  }
  
  // Try to fetch additional stats from other endpoints
  async function tryFetchHiddenStats(userId, username) {
    log('OF Stats: Trying to fetch hidden stats for user:', userId);
    
    const endpoints = [
      `/api2/v2/users/${userId}/stats`,
      `/api2/v2/users/${username}/stats`,
    ];
    
    for (const endpoint of endpoints) {
      try {
        const response = await fetch('https://onlyfans.com' + endpoint, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          log('OF Stats: Got response from', endpoint, data);
          if (data && data.subscribersCount !== undefined) {
            return data.subscribersCount;
          }
        }
      } catch(e) {
        log('OF Stats: Failed to fetch', endpoint);
      }
    }
    
    return null;
  }
  
  // Intercept fetch API
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    
    const response = await originalFetch.apply(this, args);
    
    try {
      if (isUserProfileUrl(url)) {
        log('OF Stats: [FETCH] Intercepted user profile:', url);
        const clone = response.clone();
        const data = await clone.json();
        processUserData(url, data);
      }
    } catch(e) {
      // Ignore errors
    }
    
    return response;
  };
  
  // Also intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._ofStatsUrl = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      try {
        const url = this._ofStatsUrl || '';
        if (isUserProfileUrl(url)) {
          log('OF Stats: [XHR] Intercepted user profile:', url);
          const data = JSON.parse(this.responseText);
          processUserData(url, data);
        }
      } catch(e) {
        // Ignore errors
      }
    });
    return originalXHRSend.apply(this, args);
  };
  
  log('OF Stats: Fetch + XHR interceptor installed!');
})();

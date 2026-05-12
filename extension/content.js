// Content script for OnlyFans Stats Editor Pro
(function() {
  'use strict';
  
  // Debug flag - set to false in production to disable all console logs
  const DEBUG = false;
  function log(...args) { if (DEBUG) log(...args); }
  function logError(...args) { if (DEBUG) logError(...args); }
  
  log('OF Stats Editor Pro: Content script loaded');
  
  // Check if user is authenticated
  const authStatus = localStorage.getItem('ofStatsAuthStatus');
  const isAuthenticated = authStatus === 'authenticated';
  
  // If not authenticated, only allow message handling for auth sync, but disable all other functionality
  if (!isAuthenticated) {
    log('OF Stats Editor Pro: Not authenticated, plugin features disabled');
    
    // Still listen for messages to allow popup to communicate
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'getModelName') {
        sendResponse({ modelName: null, modelAvatar: null });
      }
      return true;
    });
    return;
  }
  
  // Store original values
  let originalValues = {
    currentBalance: null,
    pendingBalance: null,
    fansCount: null,
    followingCount: null
  };
  
  // Flag to track if we've stored original values
  let originalsStored = false;
  
  // Function to check if current page is our model's profile (where we should apply fake values)
  function isOwnProfilePage() {
    const path = window.location.pathname;
    
    // Check if we're on /my/ pages (definitely own page - stats, settings, etc.)
    if (path.startsWith('/my/')) return true;
    
    // Get our saved model username from localStorage cache
    let cachedSettings = null;
    try {
      const cached = localStorage.getItem('ofStatsCache');
      if (cached) {
        cachedSettings = JSON.parse(cached);
      }
    } catch(e) {}
    
    const ourUsername = cachedSettings && cachedSettings.myModelUsername ? cachedSettings.myModelUsername.toLowerCase() : null;
    
    // Get username from URL
    const pathParts = path.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      const firstPart = pathParts[0].toLowerCase();
      
      // System pages - not a profile page, show fake values
      const systemPages = ['my', 'notifications', 'messages', 'chats', 'settings', 'collections', 'bookmarks', 'lists', 'subscribers', 'subscriptions', 'search', 'explore'];
      if (systemPages.includes(firstPart)) {
        return true;
      }
      
      // This is a profile page (username in URL)
      // ONLY show fake values if this is OUR saved username
      if (ourUsername) {
        const isOwn = firstPart === ourUsername;
        log('OF Stats Editor: isOwnProfilePage check - URL username:', firstPart, ', our username:', ourUsername, ', isOwn:', isOwn);
        return isOwn;
      }
      
      // No saved username yet - don't show fake values on any profile page
      log('OF Stats Editor: isOwnProfilePage - no saved username, returning false for profile page:', firstPart);
      return false;
    }
    
    // Root page or other - allow fake values
    return true;
  }
  
  // Format number with commas (1234567 -> 1,234,567)
  function formatNumber(value) {
    if (!value) return value;
    
    // Remove $ if present, trim spaces
    let cleanValue = value.toString().trim().replace(/^\$/, '').trim();
    
    // If already has commas and looks formatted, return as is
    if (cleanValue.includes(',') && /^[\d,]+\.?\d*$/.test(cleanValue)) {
      return cleanValue;
    }
    
    // Check if it's a valid number (with optional decimal)
    const numMatch = cleanValue.match(/^(\d+)(\.(\d+))?$/);
    if (numMatch) {
      const intPart = numMatch[1];
      const decPart = numMatch[3] || '';
      
      // Add commas to integer part
      const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      
      return decPart ? `${formattedInt}.${decPart}` : formattedInt;
    }
    
    // Return original if can't parse
    return cleanValue;
  }
  
  // Tooltip handling is done entirely in inject-early.js to avoid conflicts
  // Content.js only handles balance/count replacements as fallback
  
  // Convert K/M notation to full number
  function convertToFullNumber(value) {
    if (!value) return '';
    const str = value.toString().trim().toUpperCase();
    
    const kMatch = str.match(/^([\d.]+)\s*K$/i);
    if (kMatch) {
      return Math.round(parseFloat(kMatch[1]) * 1000).toString();
    }
    
    const mMatch = str.match(/^([\d.]+)\s*M$/i);
    if (mMatch) {
      return Math.round(parseFloat(mMatch[1]) * 1000000).toString();
    }
    
    return str.replace(/[^\d]/g, '');
  }
  
  // Start observing body for DOM changes (balance/count replacements only)
  // Tooltip handling is in inject-early.js
  
  // Find balance elements on statements page
  function findBalanceElements() {
    const elements = {
      currentBalance: null,
      pendingBalance: null
    };
    
    // Current Balance - С‚РѕС‡РЅС‹Р№ СЃРµР»РµРєС‚РѕСЂ РґР»СЏ /my/statements/earnings
    elements.currentBalance = document.querySelector('.b-statements__current-balance__value');
    
    // Pending Balance - РёС‰РµРј РїРѕС…РѕР¶РёР№ РєР»Р°СЃСЃ
    elements.pendingBalance = document.querySelector('.b-statements__pending-balance__value');
    
    // Alternative selectors for /my/statistics/statements/earnings page
    if (!elements.currentBalance) {
      const currentCol = document.querySelector('.b-statements-balances__col.m-current');
      if (currentCol) {
        elements.currentBalance = currentCol.querySelector('.b-statements-balances__sum');
      }
    }
    
    if (!elements.pendingBalance) {
      // Find pending balance column (the one without m-current class)
      const allCols = document.querySelectorAll('.b-statements-balances__col');
      allCols.forEach(col => {
        if (!col.classList.contains('m-current')) {
          const sumEl = col.querySelector('.b-statements-balances__sum');
          if (sumEl) elements.pendingBalance = sumEl;
        }
      });
    }
    
    // Р•СЃР»Рё РЅРµ РЅР°С€Р»Рё pending, РїРѕРїСЂРѕР±СѓРµРј Р°Р»СЊС‚РµСЂРЅР°С‚РёРІРЅС‹Рµ СЃРµР»РµРєС‚РѕСЂС‹
    if (!elements.pendingBalance) {
      // РС‰РµРј РїРѕ С‚РµРєСЃС‚Сѓ "Pending balance"
      const allBalanceBlocks = document.querySelectorAll('[class*="balance-block"], [class*="balance_"]');
      allBalanceBlocks.forEach(block => {
        const titleEl = block.querySelector('[class*="title-text"], [class*="__title"]');
        if (titleEl && titleEl.textContent.toLowerCase().includes('pending')) {
          const valueEl = block.querySelector('[class*="value"]');
          if (valueEl) elements.pendingBalance = valueEl;
        }
      });
    }
    
    log('OF Stats Editor: Found balance elements:', {
      currentBalance: elements.currentBalance ? 'found' : 'not found',
      pendingBalance: elements.pendingBalance ? 'found' : 'not found'
    });
    
    return elements;
  }
  
  // Find social stats elements (Fans, Following)
  function findSocialElements() {
    const elements = {
      fansCount: null,
      followingCount: null
    };
    
    // Method 1: Find by data item class
    const dataItems = document.querySelectorAll('.l-sidebar__user-data__item');
    if (dataItems.length >= 1) {
      // First item is usually Fans
      const firstCount = dataItems[0]?.querySelector('.l-sidebar__user-data__item__count');
      if (firstCount) elements.fansCount = firstCount;
      
      // Second item is usually Following  
      if (dataItems.length >= 2) {
        const secondCount = dataItems[1]?.querySelector('.l-sidebar__user-data__item__count');
        if (secondCount) elements.followingCount = secondCount;
      }
    }
    
    // Method 2: Find by attribute data-v
    if (!elements.fansCount) {
      const countElements = document.querySelectorAll('[class*="user-data__item__count"], [class*="count"]');
      countElements.forEach((el, index) => {
        if (index === 0 && !elements.fansCount) {
          elements.fansCount = el;
        } else if (index === 1 && !elements.followingCount) {
          elements.followingCount = el;
        }
      });
    }
    
    // Method 3: Look in header/profile area
    if (!elements.fansCount) {
      const header = document.querySelector('.l-header, [class*="header"], [class*="profile"]');
      if (header) {
        const spans = header.querySelectorAll('span[class*="count"]');
        if (spans.length >= 1) elements.fansCount = spans[0];
        if (spans.length >= 2) elements.followingCount = spans[1];
      }
    }
    
    log('OF Stats Editor: Found social elements:', elements);
    return elements;
  }
  
  // Get model name from page (prioritize sidebar/menu which always shows OUR username)
  function getModelName() {
    // Priority 1: Sidebar user menu - always shows OUR username
    const sidebarSelectors = [
      '.m-native-custom-menu__user-title',  // Mobile/native menu username
      '.l-sidebar__user-name',               // Sidebar username
      '.g-user-username'                     // Global user username in header
    ];
    
    for (const selector of sidebarSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        const name = el.textContent.trim();
        if (name.startsWith('@') || name.length > 0) {
          log('OF Stats Editor: Found OUR model name from sidebar:', name);
          return name;
        }
      }
    }
    
    // Priority 2: Other selectors (may show OTHER model's username if on their profile)
    const fallbackSelectors = [
      '.b-username__text', 
      '.b-username',
      '[class*="username"]'
    ];
    
    for (const selector of fallbackSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        const name = el.textContent.trim();
        if (name.startsWith('@') || name.length > 0) {
          log('OF Stats Editor: Found model name (fallback):', name);
          return name;
        }
      }
    }
    
    return null;
  }
  
  // Get model avatar URL
  function getModelAvatar() {
    // Try to find avatar image
    const avatarSelectors = [
      '.l-sidebar__user-avatar img',
      '.g-avatar img',
      '.b-user-avatar img',
      '[class*="avatar"] img',
      '.m-native-custom-menu__user-avatar img'
    ];
    
    for (const selector of avatarSelectors) {
      const img = document.querySelector(selector);
      if (img && img.src) {
        log('OF Stats Editor: Found avatar:', img.src);
        return img.src;
      }
    }
    
    return null;
  }
  
  // Store original values before modification
  function storeOriginalValues() {
    if (originalsStored) return;
    
    const balanceEls = findBalanceElements();
    const socialEls = findSocialElements();
    
    if (balanceEls.currentBalance) {
      originalValues.currentBalance = balanceEls.currentBalance.textContent.trim();
    }
    if (balanceEls.pendingBalance) {
      originalValues.pendingBalance = balanceEls.pendingBalance.textContent.trim();
    }
    if (socialEls.fansCount) {
      originalValues.fansCount = socialEls.fansCount.textContent.trim();
    }
    if (socialEls.followingCount) {
      originalValues.followingCount = socialEls.followingCount.textContent.trim();
    }
    
    originalsStored = true;
    log('OF Stats Editor: Stored original values:', originalValues);
  }
  
  // Get current balance value as integer (no decimals, no commas)
  function getCurrentBalanceInteger() {
    try {
      // First try to get from cached settings
      const cached = localStorage.getItem('ofStatsCache');
      if (cached) {
        const settings = JSON.parse(cached);
        if (settings.currentBalance) {
          // Remove $, commas, and everything after decimal point
          const cleanValue = settings.currentBalance.toString()
            .replace(/[$,]/g, '')
            .split('.')[0]
            .trim();
          const intValue = parseInt(cleanValue);
          if (!isNaN(intValue) && intValue > 0) {
            return intValue;
          }
        }
      }
      
      // Fallback: read from DOM
      const balanceEl = document.querySelector('.b-statements__current-balance__value');
      if (balanceEl) {
        const text = balanceEl.textContent || '';
        const cleanValue = text.replace(/[$,]/g, '').split('.')[0].trim();
        const intValue = parseInt(cleanValue);
        if (!isNaN(intValue) && intValue > 0) {
          return intValue;
        }
      }
    } catch(e) {
      log('OF Stats Editor: Error getting balance:', e);
    }
    return 0;
  }
  
  // Create and show withdrawal modal
  function showWithdrawalModal() {
    // Remove existing modal if any
    const existingModal = document.getElementById('of-stats-withdrawal-modal');
    if (existingModal) existingModal.remove();
    const existingBackdrop = document.getElementById('of-stats-modal-backdrop');
    if (existingBackdrop) existingBackdrop.remove();
    
    const maxAmountInt = getCurrentBalanceInteger();
    // Format the amount with commas for display (e.g., 1234 -> 1,234)
    const maxAmount = formatNumber(maxAmountInt.toString());
    
    // Make original page button disabled/grey when modal is open (like original OF behavior)
    // Only target the main page button, not buttons inside modals
    document.querySelectorAll('button[data-of-stats-processed]').forEach(btn => {
      if (isWithdrawalButton(btn.textContent)) {
        // Remove all inline styles so OnlyFans CSS can apply disabled styles
        btn.removeAttribute('style');
        btn.setAttribute('disabled', 'disabled');
      }
    });
    
    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'of-stats-modal-backdrop';
    backdrop.className = 'modal-backdrop fade show';
    backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1040;';
    
    // Create modal
    const modal = document.createElement('div');
    modal.id = 'of-stats-withdrawal-modal';
    modal.className = 'modal fade show';
    modal.style.cssText = 'display: block; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 1050; overflow: auto;';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    
    const isRuModal = getPageLanguage() === 'ru';
    const modalTitle = isRuModal ? 'Выплаты вручную' : 'Manual payouts';
    const modalPlaceholder = isRuModal ? 'Сумма выво...' : 'Withdrawal amount';
    const modalMinText = isRuModal ? 'Минимум $20 USD' : 'Minimum $20 USD';
    const modalMaxLabel = isRuModal ? 'Максимум' : 'Max';
    const modalCancel = isRuModal ? 'Отменить' : 'Cancel';
    const modalSubmit = isRuModal ? 'Запрос на вывод' : 'Request withdrawal';

    modal.innerHTML = `
      <div class="modal-dialog modal-sm modal-dialog-centered">
        <span tabindex="0"></span>
        <div id="ModalPayouts___BV_modal_content_" tabindex="-1" class="modal-content">
          <header id="ModalPayouts___BV_modal_header_" class="modal-header">
            <h4 class="modal-title"> ${modalTitle} </h4>
          </header>
          <div id="ModalPayouts___BV_modal_body_" class="modal-body m-reset-body-padding-bottom">
            <form id="of-stats-withdrawal-form">
              <div class="b-inline-form d-flex align-items-start">
                <div class="g-input__wrapper mr-2 flex-fill-1 m-reset-bottom-gap" step="1">
                  <div class="g-input__wrapper input-text-field m-empty m-reset-bottom-gap">
                    <div class="" id="of-stats-input-wrapper">
                      <div class="v-input form-control g-input mb-0 theme--light v-text-field v-text-field--is-booted v-text-field--enclosed v-text-field--outlined v-text-field--placeholder m-placeholder-gap" id="of-stats-v-input">
                        <div class="v-input__control">
                          <div class="v-input__slot">
                            <fieldset aria-hidden="true">
                              <legend style="width: 0px;"><span class="notranslate">\u200B</span></legend>
                            </fieldset>
                            <div class="v-text-field__slot" id="of-stats-text-slot">
                              <input at-attr="input" inputmode="decimal" autocomplete="tip-input" name="" required="required" id="of-stats-tip-input" placeholder="${modalPlaceholder}" type="text">
                            </div>
                          </div>
                          <div class="v-text-field__details">
                            <div class="v-messages theme--light">
                              <div class="v-messages__wrapper"></div>
                            </div>
                          </div>
                        </div>
                        <div class="v-input__append-outer">
                          <div class="g-input__help">
                            <div>${modalMinText}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <button type="button" class="g-btn m-lg m-rounded" id="of-stats-max-btn">
                  <span class="g-spacer-r">${modalMaxLabel}</span>
                  <span class=""> $${maxAmount} </span>
                </button>
              </div>
              <div class="modal-footer">
                <button type="button" class="g-btn m-flat m-btn-gaps m-reset-width" id="of-stats-cancel-btn"> ${modalCancel} </button>
                <button type="submit" class="g-btn m-flat m-btn-gaps m-reset-width" id="of-stats-submit-btn" disabled="disabled"> ${modalSubmit} </button>
              </div>
            </form>
          </div>
        </div>
        <span tabindex="0"></span>
      </div>
    `;
    
    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');
    
    const inputEl = document.getElementById('of-stats-tip-input');
    const submitBtn = document.getElementById('of-stats-submit-btn');
    const maxBtn = document.getElementById('of-stats-max-btn');
    const textSlot = document.getElementById('of-stats-text-slot');
    const vInput = document.getElementById('of-stats-v-input');
    const inputWrapper = document.getElementById('of-stats-input-wrapper');
    const cancelBtn = document.getElementById('of-stats-cancel-btn');
    
    log('OF Stats: Modal elements:', { inputEl, submitBtn, maxBtn, textSlot, vInput, inputWrapper, cancelBtn });
    
    // Function to add $ prefix when there's a value
    const updateInputState = () => {
      try {
        const hasValue = inputEl.value.trim().length > 0;
        const existingPrefix = textSlot.querySelector('.v-text-field__prefix');
        log('OF Stats: updateInputState called, hasValue:', hasValue);
        
        // Р’РђР–РќРћ: РїРѕР»СѓС‡Р°РµРј РєРЅРѕРїРєСѓ РёР· DOM РїРѕ ID, Р° РЅРµ РёР· Р·Р°РјС‹РєР°РЅРёСЏ!
        const currentSubmitBtn = document.getElementById('of-stats-submit-btn');
        if (!currentSubmitBtn) {
          log('OF Stats: Submit button not found in DOM');
          return;
        }
        
        // Р”РѕР±Р°РІР»СЏРµРј CSS РїСЂР°РІРёР»Рѕ РґР»СЏ Р°РєС‚РёРІРЅРѕР№ РєРЅРѕРїРєРё РµСЃР»Рё РµС‰С‘ РЅРµС‚
        let activeStyle = document.getElementById('of-stats-submit-active-style');
        if (!activeStyle) {
          activeStyle = document.createElement('style');
          activeStyle.id = 'of-stats-submit-active-style';
          activeStyle.textContent = `
            #of-stats-submit-btn:not([disabled]):not(.disabled) {
              color: #00aff0 !important;
              opacity: 1 !important;
              pointer-events: auto !important;
              cursor: pointer !important;
              background-color: transparent !important;
            }
            #of-stats-submit-btn:not([disabled]):not(.disabled):hover {
              background-color: rgba(0, 145, 234, 0.06) !important;
              color: #0091ea !important;
            }
            #of-stats-submit-btn[disabled],
            #of-stats-submit-btn.disabled {
              color: #8a96a3 !important;
              opacity: 0.4 !important;
              pointer-events: none !important;
              cursor: default !important;
            }
          `;
          document.head.appendChild(activeStyle);
        }
        
        if (hasValue) {
          // Add $ prefix if not exists
          if (!existingPrefix) {
            const prefix = document.createElement('div');
            prefix.className = 'v-text-field__prefix';
            prefix.textContent = '$';
            textSlot.prepend(prefix);
          }
          // Update classes for filled state
          inputWrapper.className = 'm-filled';
          vInput.className = 'v-input form-control g-input mb-0 v-input--is-label-active v-input--is-dirty theme--light v-text-field v-text-field--prefix v-text-field--is-booted v-text-field--enclosed v-text-field--outlined v-text-field--placeholder m-placeholder-gap';
          // Enable submit button - СѓР±РёСЂР°РµРј Р’РЎРЃ С‡С‚Рѕ РґРµР»Р°РµС‚ РєРЅРѕРїРєСѓ РЅРµР°РєС‚РёРІРЅРѕР№
          currentSubmitBtn.removeAttribute('disabled');
          currentSubmitBtn.removeAttribute('aria-disabled');
          currentSubmitBtn.classList.remove('disabled');
          currentSubmitBtn.removeAttribute('style'); // РЈРґР°Р»СЏРµРј style Р°С‚СЂРёР±СѓС‚
          currentSubmitBtn.style.cssText = ''; // РћС‡РёС‰Р°РµРј style РѕР±СЉРµРєС‚
          log('OF Stats: Submit button ENABLED via CSS rules, current className:', currentSubmitBtn.className);
        } else {
          // Remove $ prefix
          if (existingPrefix) {
            existingPrefix.remove();
          }
          // Reset classes
          inputWrapper.className = '';
          vInput.className = 'v-input form-control g-input mb-0 theme--light v-text-field v-text-field--is-booted v-text-field--enclosed v-text-field--outlined v-text-field--placeholder m-placeholder-gap';
          // Disable submit button - РґРѕР±Р°РІР»СЏРµРј disabled, СЃС‚РёР»Рё С‡РµСЂРµР· CSS
          currentSubmitBtn.setAttribute('disabled', 'disabled');
          currentSubmitBtn.classList.add('disabled');
          currentSubmitBtn.removeAttribute('style'); // РЈРґР°Р»СЏРµРј style Р°С‚СЂРёР±СѓС‚
          currentSubmitBtn.style.cssText = ''; // РћС‡РёС‰Р°РµРј style РѕР±СЉРµРєС‚
          log('OF Stats: Submit button DISABLED via CSS rules');
        }
      } catch (e) {
        logError('OF Stats: updateInputState error:', e);
      }
    };
    
    // Set initial disabled state for submit button (СЃС‚РёР»Рё С‡РµСЂРµР· CSS)
    submitBtn.classList.add('disabled');
    log('OF Stats: Initial disabled state set');
    
    // Listen for input changes
    inputEl.addEventListener('input', updateInputState);
    
    // Обработчики фокуса — синяя рамка при клике на поле ввода
    inputEl.addEventListener('focus', () => {
      if (vInput) {
        vInput.classList.add('v-input--is-focused');
        vInput.classList.add('primary--text');
      }
      const fieldset = modal.querySelector('#of-stats-v-input fieldset');
      if (fieldset) {
        fieldset.style.borderColor = '#00aff0';
      }
    });
    inputEl.addEventListener('blur', () => {
      if (vInput) {
        vInput.classList.remove('v-input--is-focused');
        vInput.classList.remove('primary--text');
      }
      const fieldset = modal.querySelector('#of-stats-v-input fieldset');
      if (fieldset) {
        fieldset.style.borderColor = '';
      }
    });
    
    // Event handlers
    const closeModal = () => {
      modal.remove();
      backdrop.remove();
      document.body.classList.remove('modal-open');
      // Restore original page button to active state
      document.querySelectorAll('button[data-of-stats-processed]').forEach(btn => {
        if (isWithdrawalButton(btn.textContent)) {
          btn.removeAttribute('disabled');
          // Remove inline styles - button will use OnlyFans default active styles
          btn.removeAttribute('style');
        }
      });
    };
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    
    // Cancel button
    cancelBtn.addEventListener('click', closeModal);
    
    // Max button - fill input with max amount and disable button
    maxBtn.addEventListener('click', () => {
      log('=== OF Stats: MAX BUTTON CLICKED - FULL DIAGNOSTICS ===');
      inputEl.value = maxAmount;
      // Disable the Max button after click
      maxBtn.setAttribute('disabled', 'disabled');
      
      // Р”РРђР“РќРћРЎРўРРљРђ: РЎРѕСЃС‚РѕСЏРЅРёРµ Р”Рћ РёР·РјРµРЅРµРЅРёР№
      log('1. Submit button BEFORE changes:');
      log('   - ID:', submitBtn.id);
      log('   - className:', submitBtn.className);
      log('   - disabled attr:', submitBtn.getAttribute('disabled'));
      log('   - style attr:', submitBtn.getAttribute('style'));
      const beforeStyles = window.getComputedStyle(submitBtn);
      log('   - computed color:', beforeStyles.color);
      log('   - computed opacity:', beforeStyles.opacity);
      log('   - computed background:', beforeStyles.background);
      
      // Р”РРђР“РќРћРЎРўРРљРђ: Cancel button РґР»СЏ СЃСЂР°РІРЅРµРЅРёСЏ
      log('2. Cancel button for comparison:');
      log('   - ID:', cancelBtn.id);
      log('   - className:', cancelBtn.className);
      const cancelStyles = window.getComputedStyle(cancelBtn);
      log('   - computed color:', cancelStyles.color);
      log('   - computed opacity:', cancelStyles.opacity);
      
      // CSS СЃС‚РёР»Рё СѓР¶Рµ РґРѕР±Р°РІР»РµРЅС‹ РІ updateInputState, РЅРµ РґСѓР±Р»РёСЂСѓРµРј
      log('3. CSS styles managed by updateInputState');
      
      // РџСЂРёРјРµРЅСЏРµРј РёР·РјРµРЅРµРЅРёСЏ Рє РєРЅРѕРїРєРµ
      submitBtn.removeAttribute('disabled');
      submitBtn.removeAttribute('aria-disabled');
      submitBtn.classList.remove('disabled');
      submitBtn.removeAttribute('style'); // РЈРґР°Р»СЏРµРј inline СЃС‚РёР»Рё - CSS РїСЂР°РІРёР»Р° СЃРґРµР»Р°СЋС‚ РѕСЃС‚Р°Р»СЊРЅРѕРµ
      
      // Р”РРђР“РќРћРЎРўРРљРђ: РЎРѕСЃС‚РѕСЏРЅРёРµ РџРћРЎР›Р• РёР·РјРµРЅРµРЅРёР№
      log('4. Submit button AFTER changes:');
      log('   - className:', submitBtn.className);
      log('   - disabled attr:', submitBtn.getAttribute('disabled'));
      log('   - style attr:', submitBtn.getAttribute('style'));
      const afterStyles = window.getComputedStyle(submitBtn);
      log('   - computed color:', afterStyles.color);
      log('   - computed opacity:', afterStyles.opacity);
      log('   - computed background:', afterStyles.background);
      log('   - computed backgroundColor:', afterStyles.backgroundColor);
      
      // РџСЂРѕРІРµСЂСЏРµРј РµСЃС‚СЊ Р»Рё РґСЂСѓРіРёРµ СЃС‚РёР»Рё РєРѕС‚РѕСЂС‹Рµ РїРµСЂРµРѕРїСЂРµРґРµР»СЏСЋС‚
      log('5. Checking all stylesheets for #of-stats-submit-btn rules:');
      try {
        for (let i = 0; i < document.styleSheets.length; i++) {
          try {
            const rules = document.styleSheets[i].cssRules || document.styleSheets[i].rules;
            if (rules) {
              for (let j = 0; j < rules.length; j++) {
                if (rules[j].selectorText && rules[j].selectorText.includes('of-stats-submit-btn')) {
                  log('   Found rule:', rules[j].selectorText, rules[j].cssText);
                }
              }
            }
          } catch (e) {
            // Cross-origin stylesheets will throw
          }
        }
      } catch (e) {
        log('   Could not check stylesheets:', e.message);
      }
      
      log('=== END DIAGNOSTICS ===');
      
      // Update input state (add $ prefix)
      updateInputState();

      // === РЇР”Р•Р РќРђРЇ Р—РђРњР•РќРђ submitBtn ===
      // Р—Р°С‰РёС‚Р° РѕС‚ РїРѕРІС‚РѕСЂРЅРѕР№ Р·Р°РјРµРЅС‹
      // Р‘РµСЂС‘Рј submitBtn РёР· DOM РїРѕ id (Р°РєС‚СѓР°Р»СЊРЅС‹Р№)
      const freshSubmitBtn = document.getElementById('of-stats-submit-btn');
      if (freshSubmitBtn && !freshSubmitBtn.dataset.ofStatsReplaced) {
        const newSubmitBtn = freshSubmitBtn.cloneNode(true);
        // РЈР±РёСЂР°РµРј Р’РЎР• inline СЃС‚РёР»Рё - Р±СѓРґРµРј РїРѕР»Р°РіР°С‚СЊСЃСЏ РЅР° CSS РїСЂР°РІРёР»Р°
        newSubmitBtn.removeAttribute('style');
        newSubmitBtn.style.cssText = ''; // Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕ РѕС‡РёС‰Р°РµРј style РѕР±СЉРµРєС‚
        newSubmitBtn.classList.remove('disabled');
        newSubmitBtn.removeAttribute('disabled');
        newSubmitBtn.removeAttribute('aria-disabled');
        newSubmitBtn.removeAttribute('data-of-stats-processed'); // РЈР±РёСЂР°РµРј Р°С‚СЂРёР±СѓС‚ СЃС‚СЂР°РЅРёС‡РЅРѕР№ РєРЅРѕРїРєРё
        newSubmitBtn.id = 'of-stats-submit-btn';
        // РўРѕС‡РЅРѕ С‚Р°РєРёРµ Р¶Рµ РєР»Р°СЃСЃС‹ РєР°Рє Сѓ Cancel
        newSubmitBtn.className = 'g-btn m-flat m-btn-gaps m-reset-width';
        if (freshSubmitBtn.onclick) newSubmitBtn.onclick = freshSubmitBtn.onclick;
        newSubmitBtn.dataset.ofStatsReplaced = '1';
        if (freshSubmitBtn.parentNode) {
          freshSubmitBtn.parentNode.replaceChild(newSubmitBtn, freshSubmitBtn);
          log('OF Stats: Submit button FULLY REPLACED - no inline styles, CSS rules only');
        } else {
          log('OF Stats: Submit button parentNode is null, cannot replace!');
        }
      } else if (freshSubmitBtn) {
        log('OF Stats: Submit button already replaced, skipping.');
      } else {
        log('OF Stats: Submit button not found in DOM!');
      }

      // РЇР”Р•Р РќРћ: РІСЃРµРіРґР° РґРµР»Р°РµРј submitBtn Р°РєС‚РёРІРЅРѕР№ РїРѕСЃР»Рµ MAX (РµС‰С‘ СЂР°Р·, РґР°Р¶Рµ РµСЃР»Рё updateInputState РёР»Рё С‡С‚Рѕ-С‚Рѕ РµС‰С‘ СЃР±СЂРѕСЃРёР»Рѕ)
      const forceBtn = document.getElementById('of-stats-submit-btn');
      if (forceBtn) {
        // РЈР±РёСЂР°РµРј disabled Р°С‚СЂРёР±СѓС‚ Рё РєР»Р°СЃСЃ
        forceBtn.removeAttribute('disabled');
        forceBtn.classList.remove('disabled');
        // РЈРґР°Р»СЏРµРј РІСЃРµ inline СЃС‚РёР»Рё - РєРЅРѕРїРєР° Р±СѓРґРµС‚ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ С‚РѕР»СЊРєРѕ CSS РєР»Р°СЃСЃС‹ РєР°Рє Cancel
        forceBtn.removeAttribute('style');
        // РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ РѕС‡РёС‰Р°РµРј style РѕР±СЉРµРєС‚
        forceBtn.style.cssText = '';
        // РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРј С‚РѕС‡РЅРѕ С‚Р°РєРёРµ Р¶Рµ РєР»Р°СЃСЃС‹ РєР°Рє Сѓ Cancel
        forceBtn.className = 'g-btn m-flat m-btn-gaps m-reset-width';
        // РЈР±РµР¶РґР°РµРјСЃСЏ С‡С‚Рѕ aria-disabled С‚РѕР¶Рµ СѓР±СЂР°РЅ
        forceBtn.removeAttribute('aria-disabled');
        // РЈР±РёСЂР°РµРј data-of-stats-processed РµСЃР»Рё РµСЃС‚СЊ (СЌС‚Рѕ РґР»СЏ СЃС‚СЂР°РЅРёС‡РЅРѕР№ РєРЅРѕРїРєРё)
        forceBtn.removeAttribute('data-of-stats-processed');
        
        // Р”РѕР±Р°РІР»СЏРµРј CSS РїСЂР°РІРёР»Рѕ РґР»СЏ Р°РєС‚РёРІРЅРѕРіРѕ СЃРѕСЃС‚РѕСЏРЅРёСЏ
        let activeStyle = document.getElementById('of-stats-submit-active-style');
        if (!activeStyle) {
          activeStyle = document.createElement('style');
          activeStyle.id = 'of-stats-submit-active-style';
          activeStyle.textContent = `
            #of-stats-submit-btn:not([disabled]):not(.disabled) {
              color: #00aff0 !important;
              opacity: 1 !important;
              pointer-events: auto !important;
              cursor: pointer !important;
              background-color: transparent !important;
            }
            #of-stats-submit-btn:not([disabled]):not(.disabled):hover {
              background-color: rgba(0, 145, 234, 0.06) !important;
              color: #0091ea !important;
            }
          `;
          document.head.appendChild(activeStyle);
        }
        
        // Р¤РёРЅР°Р»СЊРЅР°СЏ РїСЂРѕРІРµСЂРєР° - Р»РѕРі СЃРѕСЃС‚РѕСЏРЅРёСЏ
        log('OF Stats: Submit button FINAL STATE after MAX:');
        log('   - className:', forceBtn.className);
        log('   - disabled attr:', forceBtn.getAttribute('disabled'));
        log('   - style attr:', forceBtn.getAttribute('style'));
        log('   - style.cssText:', forceBtn.style.cssText);
        log('OF Stats: Submit button FORCED ENABLE after MAX completed');
      }
    });
    
    // Form submit
    document.getElementById('of-stats-withdrawal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = inputEl.value;
      log('OF Stats Editor: Withdrawal requested for $' + amount);
      closeModal();
    });
    
    log('OF Stats Editor: Withdrawal modal opened with max $' + maxAmount);
  }
  
  // Activate withdrawal button
  function activateWithdrawButton() {
    document.querySelectorAll('button').forEach(btn => {
      if (isWithdrawalButton(btn.textContent)) {
        // Skip if already processed
        if (btn.getAttribute('data-of-stats-processed')) return;
        btn.setAttribute('data-of-stats-processed', 'true');
        
        // Just remove disabled, let OnlyFans CSS handle the active styling
        btn.removeAttribute('disabled');
        
        // Clone to remove existing event listeners
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        // Add our click handler
        newBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showWithdrawalModal();
        }, true);
        
        log('OF Stats Editor: Withdrawal button activated');
      }
    });
  }
  
  // Format percentage value
  function formatTopCreatorsPercentage(value) {
    if (!value) return value;
    
    // Remove % if present
    let cleanValue = value.toString().trim().replace('%', '').trim();
    
    // Parse as float
    let num = parseFloat(cleanValue);
    if (isNaN(num)) return value;
    
    // If less than 1%, format with 2 decimal places
    if (num < 1) {
      return num.toFixed(2) + '%';
    }
    
    // Otherwise, remove unnecessary decimals
    if (Number.isInteger(num)) {
      return num + '%';
    }
    
    // Keep decimals as entered, but add %
    return cleanValue + '%';
  }
  
  // Check if current page is an earnings-related page
  function isEarningsPage() {
    const path = window.location.pathname;
    return path.includes('/my/statements/earnings') || path.includes('/my/stats/earnings') || path.includes('/my/statistics/statements/earnings');
  }

  // Detect page language (ru / en)
  function getPageLanguage() {
    const htmlLang = (document.documentElement.lang || '').toLowerCase();
    if (htmlLang.startsWith('ru')) return 'ru';
    // Fallback: check for known Russian UI text on the page
    const body = document.body ? (document.body.textContent || '').substring(0, 3000) : '';
    if (body.includes('Статистика') || body.includes('Заявления') || body.includes('Заработок')) return 'ru';
    return 'en';
  }

  // Get localized Top Creators text
  function getTopCreatorsText(formattedPercentage) {
    if (getPageLanguage() === 'ru') {
      return 'ВЫ НАХОДИТЕСЬ В ТОП% ' + formattedPercentage.replace('%', '') + 'ВСЕХ СОЗДАТЕЛЕЙ!';
    }
    return 'YOU ARE IN THE TOP ' + formattedPercentage + ' OF ALL CREATORS!';
  }

  // Check if text is "All time" in any language
  function isAllTimeText(text) {
    var t = text.trim().toLowerCase();
    return t === 'all time' || t === 'все время' || t === 'за все время' || t === 'всё время';
  }

  // Check if text content looks like a Top Creators block (any language)
  function isTopCreatorsText(textContent) {
    const t = textContent.toUpperCase();
    return (t.includes('TOP') && t.includes('CREATORS')) ||
           (t.includes('ТОП') && t.includes('СОЗДАТЕЛЕЙ'));
  }

  // Check if button text is a withdrawal button (EN or RU)
  function isWithdrawalButton(btnText) {
    const t = btnText.toLowerCase().trim();
    return t.includes('request withdrawal') || t.includes('запрос на вывод');
  }

  // Check if label is Gross (EN or RU variants)
  function isGrossLabel(name) {
    return name === 'gross' || name === 'валовой' || name === 'гросс';
  }

  // Check if label is Net (EN or RU)
  function isNetLabel(name) {
    return name === 'net' || name === 'чистая';
  }

  // Get localized earnings description
  function getEarningsDescription(type, userId, username) {
    const isRu = getPageLanguage() === 'ru';
    if (type === 'tip') {
      return (isRu ? 'Чаевые от' : 'Tip from') + ' <a href="https://onlyfans.com/' + userId + '">' + username + '</a>';
    }
    return (isRu ? 'Оплата за сообщение от' : 'Payment for message from') + ' <a href="https://onlyfans.com/' + userId + '">' + username + '</a>';
  }

  // Russian pluralization for days
  function getRuDaysWord(n) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
    return 'дней';
  }

  // Get localized status tooltip text
  function getStatusTooltipText(status, daysRemaining) {
    const isRu = getPageLanguage() === 'ru';
    if (status === 'complete') return isRu ? 'Завершить' : 'Complete';
    if (status === 'reversed') return isRu ? 'Перевернутый' : 'Reversed';
    // pending
    if (isRu) {
      return 'Заработок станет доступен в ' + daysRemaining + ' течение нескольких дней';
    }
    return 'Earning will become available in ' + daysRemaining + ' day' + (daysRemaining !== 1 ? 's' : '');
  }
  
  // Apply Top Creators - find existing block and replace percentage, or create new
  function applyTopCreatorsBanner(percentage) {
    // Only apply on earnings pages
    if (!isEarningsPage()) {
      return false;
    }
    
    // Format the percentage
    const formattedPercentage = formatTopCreatorsPercentage(percentage);
    const localizedText = getTopCreatorsText(formattedPercentage);
    
    // Check for b-top-rated style block first (on /my/statistics/statements/earnings)
    const topRatedBlock = document.querySelector('.b-top-rated');
    if (topRatedBlock) {
      const textEl = topRatedBlock.querySelector('.b-top-rated__text');
      if (textEl) {
        textEl.textContent = ' ' + localizedText + ' ';
        log('OF Stats Editor: Updated b-top-rated percentage to', formattedPercentage);
        return true;
      }
    }
    
    // Find existing Top Creators block by looking for g-box with star icon and "TOP" text
    const allGBoxes = document.querySelectorAll('.g-box.m-with-icon.m-panel');
    let found = false;
    
    allGBoxes.forEach(box => {
      const textContent = box.textContent || '';
      // Check if this is the Top Creators block (any language)
      if (isTopCreatorsText(textContent)) {
        // Find the paragraph element with the text
        const paragraph = box.querySelector('p, .g-box__header p');
        if (paragraph) {
          // Replace percentage in the text
          paragraph.innerHTML = localizedText;
          found = true;
          log('OF Stats Editor: Updated Top Creators percentage to', formattedPercentage);
        }
      }
    });
    
    // If not found, create the block
    if (!found) {
      createTopCreatorsBlock(formattedPercentage);
    }
    
    return true;
  }
  
  // Check if we're on statistics/statements/earnings page (different UI)
  function isStatisticsStatementsEarningsPage() {
    return window.location.pathname.includes('/my/statistics/statements/earnings');
  }
  
  // Create Top Creators block matching OF style
  function createTopCreatorsBlock(formattedPercentage) {
    // Only create on earnings pages
    if (!isEarningsPage()) {
      return;
    }
    
    // Use different structure for /my/statistics/statements/earnings page
    if (isStatisticsStatementsEarningsPage()) {
      createTopCreatorsBlockStatistics(formattedPercentage);
      return;
    }
    
    // Remove any previously created block
    const existing = document.getElementById('of-stats-top-creators');
    if (existing) existing.remove();
    
    // Create the block with OF structure - using use href for star icon
    const block = document.createElement('div');
    block.id = 'of-stats-top-creators';
    block.className = 'g-box m-with-icon m-panel';
    block.innerHTML = `
      <div class="g-box__header">
        <svg class="g-box__icon g-icon" aria-hidden="true">
          <use href="#icon-star6" xlink:href="#icon-star6"></use>
        </svg>
        <p>${getTopCreatorsText(formattedPercentage)}</p>
      </div>
    `;
    
    // Add minimal styles to match OF (their CSS will handle most of it)
    if (!document.getElementById('of-stats-top-creators-style')) {
      const style = document.createElement('style');
      style.id = 'of-stats-top-creators-style';
      style.textContent = `
        #of-stats-top-creators {
          position: relative;
          border-radius: 6px;
          margin: 0 0 12px;
          width: 100%;
          font-size: 13px;
          overflow: hidden;
        }
        #of-stats-top-creators::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          bottom: 0;
          border: 1px solid rgba(138, 150, 163, .25);
          border-radius: 6px;
          pointer-events: none;
          z-index: 1;
        }
        #of-stats-top-creators .g-box__header {
          background: rgba(0, 175, 240, .12);
          padding: 10px 17px 10px 52px;
          font-size: 13px;
          font-weight: 500;
          border-radius: 6px;
          text-transform: uppercase;
          width: 100%;
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: flex-start;
        }
        #of-stats-top-creators .g-box__icon {
          position: absolute;
          top: 50%;
          left: 16px;
          transform: translateY(-50%);
          width: 24px;
          height: 24px;
          display: inline-block;
          fill: currentColor;
          line-height: 1;
          flex: 0 0 24px;
        }
        #of-stats-top-creators .g-box__icon use {
          color: #fa0;
        }
        #of-stats-top-creators .g-box__header p {
          margin: 0;
          line-height: 16px;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Find where to insert - look for balance section or statements container
    const balanceSection = document.querySelector('.b-make-modal-w, .l-sidebar__user__balance, [class*="balance"]');
    if (balanceSection && balanceSection.parentNode) {
      balanceSection.parentNode.insertBefore(block, balanceSection);
      log('OF Stats Editor: Created Top Creators block');
    } else {
      // Try main content area
      const mainContent = document.querySelector('.g-main-content, .b-payout__wrapper, main');
      if (mainContent) {
        mainContent.insertBefore(block, mainContent.firstChild);
        log('OF Stats Editor: Created Top Creators block in main content');
      }
    }
  }
  
  // Create Top Creators block for /my/statistics/statements/earnings page (b-top-rated style)
  function createTopCreatorsBlockStatistics(formattedPercentage) {
    // Check if existing block
    if (document.getElementById('of-stats-top-creators-rated')) return;
    const localizedText = getTopCreatorsText(formattedPercentage);
    if (document.querySelector('.b-top-rated')) {
      // Update existing block
      const textEl = document.querySelector('.b-top-rated .b-top-rated__text');
      if (textEl) {
        textEl.textContent = ' ' + localizedText + ' ';
      }
      return;
    }
    
    const block = document.createElement('div');
    block.id = 'of-stats-top-creators-rated';
    block.className = 'b-top-rated m-bordered';
    block.innerHTML = `
      <svg class="b-top-rated__icon g-icon" aria-hidden="true">
        <use href="#icon-star-on" xlink:href="#icon-star-on"></use>
      </svg>
      <span class="b-top-rated__text"> ${localizedText} </span>
    `;
    
    // Add styles
    if (!document.getElementById('of-stats-top-creators-rated-style')) {
      const style = document.createElement('style');
      style.id = 'of-stats-top-creators-rated-style';
      style.textContent = `
        #of-stats-top-creators-rated.b-top-rated {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(0, 175, 240, .12);
          border: 1px solid rgba(138, 150, 163, .25);
          border-radius: 6px;
          padding: 10px 16px;
          margin-bottom: 12px;
          font-size: 13px;
          font-weight: 500;
          text-transform: uppercase;
        }
        #of-stats-top-creators-rated .b-top-rated__icon {
          width: 24px;
          height: 24px;
          flex-shrink: 0;
          fill: #fa0;
        }
        #of-stats-top-creators-rated .b-top-rated__text {
          line-height: 1.2;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Try multiple insertion points
    const balancesSection = document.querySelector('.b-statements-balances');
    if (balancesSection && balancesSection.parentNode) {
      balancesSection.parentNode.insertBefore(block, balancesSection);
      log('OF Stats Editor: Created b-top-rated block before balances');
    } else {
      const mainContent = document.querySelector('.g-main-content');
      if (mainContent && mainContent.firstElementChild) {
        mainContent.insertBefore(block, mainContent.firstElementChild);
        log('OF Stats Editor: Created b-top-rated block in main content');
      }
    }
  }
  
  // Remove Top Creators block
  function removeTopCreatorsBanner() {
    const created = document.getElementById('of-stats-top-creators');
    if (created) {
      created.remove();
      log('OF Stats Editor: Removed created Top Creators block');
    }
    const createdRated = document.getElementById('of-stats-top-creators-rated');
    if (createdRated) {
      createdRated.remove();
      log('OF Stats Editor: Removed created b-top-rated block');
    }
  }

  // ==================== EARNINGS GENERATOR ====================
  
  // Realistic usernames based on real patterns
  const realUsernames = [
    // Short names (most common)
    'Dan', 'Alex', 'John', 'Jake', 'Mike', 'Chris', 'Matt', 'Nick', 'Tom', 'Ben',
    'Sam', 'Joe', 'Rob', 'Dave', 'Steve', 'Mark', 'Paul', 'Ryan', 'Tony', 'James',
    'Viktor', 'Nader', 'Joel', 'Robbin', 'Marty', 'Jale', 'Cristian', 'Sean', 'Kris',
    'Charlie', 'Jan', 'Jindra', 'Kairi', 'ElDano', 'Kowal', 'Clone', 'Fastburn',
    // Internet style names
    'MrXhot', 'Mongalio', 'HadTraNer', 'Nomore', 'djwkflsla', 'JayWDRM', 'PonasBybis',
    'TheRealKing', 'szamsik', 'hotbillybob', 'Clone_Soldat', 'Lx1', 'BigBoss',
    // With numbers
    'Mike92', 'Chris85', 'Alex2001', 'John88', 'Dave87', 'Matt99', 'James82',
    'Rob94', 'Tom00', 'Nick91', 'hotbillybob1903', 'Gamer2020', 'Player1',
    // Gamer/cool tags  
    'DarkKnight', 'ShadowX', 'IceMan', 'WolfPack', 'StormRider', 'NightOwl',
    'RedFox', 'BlackHawk', 'SilentKing', 'PhantomX', 'IronWolf', 'GhostRider',
    'ThunderX', 'Viper', 'Falcon', 'Blaze', 'Reaper', 'Hunter', 'Warrior',
    // Compound names
    'BigDave', 'LilSam', 'MrJames', 'TheReal', 'JustMike', 'OnlyAlex',
    'CoolCat', 'ChillGuy', 'HappyDude', 'LazyBear', 'WildCard', 'LuckyStar',
    // Location/hobby style
    'NYCGuy', 'LAKid', 'TexasBoy', 'Skater', 'Surfer', 'Biker', 'Gamer',
    'Traveler', 'Photographer', 'Artist', 'Musician', 'Boxer', 'Wrestler',
    // Mixed style
    'xXShadowXx', 'Pr0Player', 'EpicWin', 'TryHard', 'NoobMaster', 'EzMode',
    // Simple variations
    'Johnny', 'Mikey', 'Danny', 'Sammy', 'Bobby', 'Jimmy', 'Tommy', 'Billy',
    'Ricky', 'Franky', 'Eddie', 'Freddy', 'Teddy', 'Kenny', 'Jerry', 'Larry'
  ];
  
  // Track used usernames to avoid repeats in session
  let usedUsernames = new Set();
  
  // Generate random user ID for link
  function generateUserId() {
    return 'u' + Math.floor(Math.random() * 900000000 + 100000000);
  }
  
  // Generate realistic username
  function generateUsername() {
    // Reset if we've used too many (80% of pool)
    if (usedUsernames.size > realUsernames.length * 0.8) {
      usedUsernames.clear();
    }
    
    // 8% chance for numeric ID style username
    if (Math.random() < 0.08) {
      return 'u' + Math.floor(Math.random() * 900000000 + 100000000);
    }
    
    // Pick a random username that hasn't been used recently
    let attempts = 0;
    let username;
    do {
      username = realUsernames[Math.floor(Math.random() * realUsernames.length)];
      attempts++;
    } while (usedUsernames.has(username) && attempts < 20);
    
    // Small variation sometimes (10% chance)
    if (Math.random() < 0.10) {
      const rand = Math.random();
      if (rand < 0.5) {
        // Add small number at end
        username = username + Math.floor(Math.random() * 99 + 1);
      } else {
        // Add year-like number
        username = username + (1980 + Math.floor(Math.random() * 45));
      }
    }
    
    usedUsernames.add(username);
    return username;
  }
  
  // Generate random amount with distribution (lower amounts more common)
  function generateAmount() {
    const rand = Math.random();
    
    // Distribution: smaller amounts more frequent
    if (rand < 0.35) {
      // $5-$15 (35% chance)
      return 5 + Math.floor(Math.random() * 11);
    } else if (rand < 0.60) {
      // $15-$30 (25% chance)
      return 15 + Math.floor(Math.random() * 16);
    } else if (rand < 0.80) {
      // $30-$50 (20% chance)
      return 30 + Math.floor(Math.random() * 21);
    } else if (rand < 0.92) {
      // $50-$100 (12% chance)
      return 50 + Math.floor(Math.random() * 51);
    } else {
      // $100-$150 (8% chance)
      return 100 + Math.floor(Math.random() * 51);
    }
  }
  
  // Generate transaction type (Payment more common than Tip)
  function generateTransactionType() {
    // 70% Payment for message, 30% Tip
    return Math.random() < 0.70 ? 'payment' : 'tip';
  }
  
  // Format date for display
  function formatDate(date) {
    const isRu = getPageLanguage() === 'ru';
    const months = isRu
      ? ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
  
  // Format time for display
  function formatTime(date) {
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }
  
  // Get or generate earnings data - uses localStorage to persist across page reloads
  // pendingCount = transactions within 7 days (status: pending/loading)
  // completeCount = transactions older than 7 days (status: complete ~98%, reversed ~2%)
  function getOrGenerateTransactions(pendingCount, completeCount = 0) {
    const totalCount = pendingCount + completeCount;
    const cacheKey = 'ofStatsEarningsData';
    const keyKey = 'ofStatsEarningsKey';
    // Include today's date in cache key to regenerate when day changes
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    const currentKey = 'earnings_v7_' + pendingCount + '_' + completeCount + '_' + todayStr;
    
    try {
      const savedKey = localStorage.getItem(keyKey);
      const savedData = localStorage.getItem(cacheKey);
      
      // If key matches and data exists, use cached data
      if (savedKey === currentKey && savedData) {
        const parsed = JSON.parse(savedData);
        // Restore Date objects
        for (let i = 0; i < parsed.length; i++) {
          parsed[i].date = new Date(parsed[i].date);
        }
        return parsed;
      }
    } catch(e) {}
    
    // Generate new data
    const generated = [];
    const now = new Date();
    
    // Calculate the cutoff date (7 days ago at start of day)
    // If today is Jan 16, pending can be Jan 9-16 (16 - 7 = 9)
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    cutoffDate.setHours(0, 0, 0, 0);
    
    // Generate PENDING transactions (last 7 days = 8 calendar days: today + 7 days back)
    // Create array of available days for pending
    const pendingDays = [];
    for (let d = 0; d <= 7; d++) {  // 0-7 = 8 days (e.g., Jan 9-16)
      const dayDate = new Date(now);
      dayDate.setDate(dayDate.getDate() - d);
      dayDate.setHours(0, 0, 0, 0);
      pendingDays.push(dayDate);
    }
    
    // Distribute pending transactions evenly across all 8 days
    const numPendingDays = pendingDays.length; // 8 days
    const basePerDay = Math.floor(pendingCount / numPendingDays);
    const extraTrans = pendingCount % numPendingDays;
    
    const transPerDay = [];
    for (let d = 0; d < numPendingDays; d++) {
      // Give extra transactions to earlier days (more recent)
      const dayTrans = basePerDay + (d < extraTrans ? 1 : 0);
      transPerDay.push(dayTrans);
    }
    
    // Generate transactions for each pending day
    for (let dayIndex = 0; dayIndex < numPendingDays; dayIndex++) {
      const dayTransCount = transPerDay[dayIndex];
      if (dayTransCount <= 0) continue;
      
      const dayStart = new Date(pendingDays[dayIndex]);
      dayStart.setHours(0, 0, 0, 0);
      
      // Generate times for this day, spread throughout the day
      for (let t = 0; t < dayTransCount; t++) {
        // Spread evenly with some randomness
        const hourSlot = 23 - Math.floor((t / dayTransCount) * 24);
        const hour = Math.max(0, Math.min(23, hourSlot + Math.floor(Math.random() * 2 - 1)));
        const minute = Math.floor(Math.random() * 60);
        
        const transactionDate = new Date(dayStart);
        transactionDate.setHours(hour, minute, Math.floor(Math.random() * 60), 0);
        
        const amount = generateAmount();
        const fee = amount * 0.20;
        const net = amount * 0.80;
        const type = generateTransactionType();
        const username = generateUsername();
        const userId = generateUserId();
        
        generated.push({
          date: transactionDate,
          amount: amount,
          fee: fee,
          net: net,
          type: type,
          username: username,
          userId: userId,
          status: 'pending'
        });
      }
    }
    
    // Debug log for pending date range
    if (pendingDays.length > 0) {
      const firstPending = pendingDays[0];
      const lastPending = pendingDays[pendingDays.length - 1];
      log('OF Stats Editor: Pending date range: ' + formatDate(lastPending) + ' to ' + formatDate(firstPending) + ' (' + pendingDays.length + ' days, ' + pendingCount + ' transactions)');
    }
    
    // Generate COMPLETE transactions (older than 7 days)
    // Pending is last 7 days (e.g., Jan 9-16), so complete starts from day 8 (Jan 8)
    if (completeCount > 0) {
      // Calculate how many days we need for complete transactions
      const daysNeeded = Math.max(Math.ceil(completeCount / 10), 7); // At least spread over a week
      
      // Create array of available days for complete (starting 8 days ago)
      const completeDays = [];
      for (let cd = 8; cd < 8 + daysNeeded; cd++) {
        const cDayDate = new Date(now);
        cDayDate.setDate(cDayDate.getDate() - cd);
        cDayDate.setHours(0, 0, 0, 0);
        completeDays.push(cDayDate);
      }
      
      // Debug log for complete date range
      if (completeDays.length > 0) {
        const firstComplete = completeDays[0];
        const lastComplete = completeDays[completeDays.length - 1];
        log('OF Stats Editor: Complete date range: ' + formatDate(lastComplete) + ' to ' + formatDate(firstComplete) + ' (' + completeDays.length + ' days, ' + completeCount + ' transactions)');
      }
      
      // Distribute complete transactions across days
      let remainingComplete = completeCount;
      const completePerDay = [];
      
      for (let cd = 0; cd < completeDays.length; cd++) {
        if (cd < completeDays.length - 1) {
          const cDayTrans = Math.ceil(remainingComplete / (completeDays.length - cd) * (0.8 + Math.random() * 0.4));
          const finalTrans = Math.max(1, Math.min(cDayTrans, remainingComplete));
          completePerDay.push(finalTrans);
          remainingComplete -= finalTrans;
        } else {
          completePerDay.push(remainingComplete);
        }
      }
      
      // Generate transactions for each complete day
      for (let cDayIndex = 0; cDayIndex < completeDays.length; cDayIndex++) {
        const cDayTransCount = completePerDay[cDayIndex];
        if (cDayTransCount <= 0) continue;
        
        const cDayStart = new Date(completeDays[cDayIndex]);
        
        for (let ct = 0; ct < cDayTransCount; ct++) {
          const cHour = Math.max(0, Math.min(23, 23 - Math.floor((ct / cDayTransCount) * 24) + Math.floor(Math.random() * 2 - 1)));
          const cMinute = Math.floor(Math.random() * 60);
          
          const transactionDate = new Date(cDayStart);
          transactionDate.setHours(cHour, cMinute, Math.floor(Math.random() * 60), 0);
          
          const amount = generateAmount();
          const fee = amount * 0.20;
          const net = amount * 0.80;
          const type = generateTransactionType();
          const username = generateUsername();
          const userId = generateUserId();
          
          // ~2% chance for "reversed", ~98% chance for "complete"
          const status = Math.random() < 0.02 ? 'reversed' : 'complete';
          
          generated.push({
            date: transactionDate,
            amount: amount,
            fee: fee,
            net: net,
            type: type,
            username: username,
            userId: userId,
            status: status
          });
        }
      }
    }
    
    // Sort by date descending (newest first)
    generated.sort((a, b) => b.date - a.date);
    
    // Save to localStorage
    try {
      localStorage.setItem(keyKey, currentKey);
      localStorage.setItem(cacheKey, JSON.stringify(generated));
    } catch(e) {}
    
    return generated;
  }
  
  // Calculate days remaining until earning becomes available (max 6 days)
  function calculateDaysRemaining(transactionDate) {
    const now = new Date();
    const transDate = new Date(transactionDate);
    
    // Set both to start of day for accurate day calculation
    now.setHours(0, 0, 0, 0);
    transDate.setHours(0, 0, 0, 0);
    
    // Calculate days since transaction
    const diffTime = now.getTime() - transDate.getTime();
    const daysSince = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    // Earnings become available after 7 days, but we show max 6 days remaining
    const daysRemaining = Math.max(1, 6 - daysSince);
    
    return daysRemaining;
  }
  
  // Create HTML row for a transaction
  function createTransactionRow(transaction) {
    const tr = document.createElement('tr');
    // Force visibility even if global CSS tries to hide
    tr.style.opacity = '1';
    tr.setAttribute('data-of-stats', 'true');
    
    const description = transaction.type === 'tip' 
      ? getEarningsDescription('tip', transaction.userId, transaction.username)
      : getEarningsDescription('payment', transaction.userId, transaction.username);
    
    // Determine icon and aria-label based on status
    let iconName, ariaLabel;
    const status = transaction.status || 'pending';
    
    if (status === 'complete') {
      iconName = 'icon-done';
      ariaLabel = getStatusTooltipText('complete', 0);
    } else if (status === 'reversed') {
      iconName = 'icon-undo';
      ariaLabel = getStatusTooltipText('reversed', 0);
    } else {
      // pending/loading - calculate days remaining based on transaction date
      iconName = 'icon-loading';
      const daysRemaining = calculateDaysRemaining(transaction.date);
      ariaLabel = getStatusTooltipText('pending', daysRemaining);
    }
    
    tr.innerHTML = `
      <td class="b-table__date">
        <span class="b-table__date__date"><span title=""> ${formatDate(transaction.date)} </span></span>
        <span class="b-table__date__time"><span title=""> ${formatTime(transaction.date)} </span></span>
      </td>
      <td data-title="Amount" class="b-table__amount">
        <span class=""> $${transaction.amount.toFixed(2)} </span>
      </td>
      <td data-title="Fee" class="b-table__fee">
        <span class=""> $${transaction.fee.toFixed(2)} </span>
      </td>
      <td data-title="Net" class="b-table__net">
        <strong><span class=""> $${transaction.net.toFixed(2)} </span></strong>
      </td>
      <td class="b-table__desc">
        <span>${description}</span>
        <span tabindex="0" class="b-table__status-tip has-tooltip" data-original-title="null" aria-label="${ariaLabel}">
          <svg class="g-icon" data-icon-name="${iconName}" aria-hidden="true">
            <use href="#${iconName}" xlink:href="#${iconName}"></use>
          </svg>
        </span>
      </td>
      <td class="b-table__status">
        <span tabindex="0" class="b-table__status-tip has-tooltip" data-original-title="null" aria-label="${ariaLabel}">
          <svg class="g-icon" data-icon-name="${iconName}" aria-hidden="true">
            <use href="#${iconName}" xlink:href="#${iconName}"></use>
          </svg>
        </span>
      </td>
    `;
    
    return tr;
  }
  
  // Apply earnings generation
  // pendingCount = pending transactions (last 7 days, loading icon)
  // completeCount = complete transactions (older than 7 days, done/undo icon)
  function applyEarningsGeneration(pendingCount, completeCount = 0) {
    if ((!pendingCount || pendingCount <= 0) && (!completeCount || completeCount <= 0)) return false;
    
    // Only apply on earnings page
    if (!window.location.pathname.includes('/my/statements/earnings')) {
      return false;
    }
    
    // Check if already applied by inject-early.js
    if (window.ofStatsEarningsApplied) {
      log('OF Stats Editor: Earnings already applied by inject-early');
      return true;
    }
    
    const table = document.querySelector('table.b-table.m-responsive.m-earnings');
    if (!table) {
      log('OF Stats Editor: Earnings table not found');
      return false;
    }
    
    const tbody = table.querySelector('tbody');
    if (!tbody) {
      log('OF Stats Editor: Earnings tbody not found');
      return false;
    }
    
    // Wait for table to have some rows first (natural loading), then replace
    const existingRows = tbody.querySelectorAll('tr');
    if (existingRows.length === 0) {
      // Table not loaded yet, wait and retry
      setTimeout(() => applyEarningsGeneration(pendingCount, completeCount), 100);
      return false;
    }
    
    // Mark as applied
    window.ofStatsEarningsApplied = true;
    
    // Get cached or generate new transactions
    const transactions = getOrGenerateTransactions(pendingCount, completeCount);
    const totalCount = transactions.length;
    
    // Clear existing rows
    tbody.innerHTML = '';
    
    // Create loading spinner row (for infinite scroll) - exact OnlyFans structure
    const loadingRow = document.createElement('tr');
    loadingRow.setAttribute('data-of-stats-loading', 'true');
    loadingRow.innerHTML = `
      <td colspan="6" class="w-100">
        <div class="infinite-loading-container">
          <div class="infinite-status-prompt" style="">
            <div class="b-posts_preloader">
              <svg data-icon-name="icon-loading" aria-hidden="true" class="g-icon">
                <use href="#icon-loading" xlink:href="#icon-loading"></use>
              </svg>
            </div>
          </div>
          <div class="infinite-status-prompt" style="display: none;"><div></div></div>
          <div class="infinite-status-prompt" style="display: none;"><div></div></div>
          <div class="infinite-status-prompt" style="color: rgb(102, 102, 102); font-size: 14px; padding: 10px 0px; display: none;">
            Opps, something went wrong :(
            <br><button class="btn-try-infinite">Retry</button>
          </div>
        </div>
      </td>
    `;
    
    // Add generated rows (first 30)
    const initialCount = Math.min(30, transactions.length);
    for (let i = 0; i < initialCount; i++) {
      tbody.appendChild(createTransactionRow(transactions[i]));
    }
    
    // Add loading row at the end
    tbody.appendChild(loadingRow);
    
    // Hide spinner if all data is loaded
    if (initialCount >= transactions.length) {
      loadingRow.style.display = 'none';
    }
    
    // Store current index for infinite scroll
    window.ofStatsEarningsIndex = initialCount;
    window.ofStatsEarningsTransactions = transactions;
    
    // Setup scroll listener for loading more
    setupEarningsScrollListener(tbody, loadingRow);
    
    log(`OF Stats Editor: Generated ${initialCount} earnings rows (${totalCount} total: ${pendingCount} pending + ${completeCount} complete)`);
    return true;
  }
  
  // Flag to prevent multiple loads at once
  let isLoadingMoreContent = false;
  
  // Setup scroll listener for infinite loading with spinner animation
  function setupEarningsScrollListener(tbody, loadingRow) {
    // Remove old handler if exists
    if (window.ofStatsScrollHandler) {
      window.removeEventListener('scroll', window.ofStatsScrollHandler);
    }
    
    log('OF Stats Editor: Setting up scroll handler');
    
    window.ofStatsScrollHandler = function() {
      if (isLoadingMoreContent) return;
      
      const trans = window.ofStatsEarningsTransactions;
      const idx = window.ofStatsEarningsIndex || 0;
      if (!trans || idx >= trans.length) return;
      
      const scrollY = window.scrollY || window.pageYOffset;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      
      // Trigger early (400px from bottom) so user doesn't see loading
      if (scrollY + windowHeight >= documentHeight - 400) {
        log('OF Stats Editor: Bottom reached, loading more...');
        isLoadingMoreContent = true;
        
        // Show loading spinner
        if (loadingRow) {
          loadingRow.style.display = '';
        }
        
        // Quick load (2x faster)
        const loadDelay = 300 + Math.random() * 200; // 300-500ms
        
        setTimeout(() => {
          // Add next batch of 10 rows
          const endIdx = Math.min(idx + 10, trans.length);
          for (let j = idx; j < endIdx; j++) {
            const row = createTransactionRow(trans[j]);
            if (loadingRow) {
              tbody.insertBefore(row, loadingRow);
            } else {
              tbody.appendChild(row);
            }
          }
          window.ofStatsEarningsIndex = endIdx;
          log(`OF Stats Editor: Loaded more (${endIdx}/${trans.length})`);
          
          // Hide spinner if no more data
          if (endIdx >= trans.length && loadingRow) {
            loadingRow.style.display = 'none';
          }
          
          // Reset flag immediately to allow next load
          isLoadingMoreContent = false;
        }, loadDelay);
      }
    };
    
    window.addEventListener('scroll', window.ofStatsScrollHandler, { passive: true });
    log('OF Stats Editor: Scroll listener added');
  }

  // Load more earnings on scroll - now integrated into setupEarningsScrollListener
  function loadMoreEarnings() {
    // Handler is in setupEarningsScrollListener
  }
  
  // Remove generated earnings
  function removeGeneratedEarnings() {
    window.ofStatsEarningsIndex = 0;
    window.ofStatsEarningsTransactions = null;
    
    if (window.ofStatsScrollHandler) {
      window.removeEventListener('scroll', window.ofStatsScrollHandler);
      window.ofStatsScrollHandler = null;
    }
  }

  // ==================== END EARNINGS GENERATOR ====================

  // Apply modifications to the page
  // forceApply = true when called from Apply Changes button, false when called from MutationObserver
  async function applyModifications(settings, forceApply = false) {
    log('OF Stats Editor: Applying modifications:', settings, 'forceApply:', forceApply);
    
    if (!settings.enabled) {
      restoreOriginalValues();
      // Clear localStorage cache when disabled
      try {
        localStorage.removeItem('ofStatsCache');
      } catch(e) {}
      showElements();
      return { success: true, message: 'Modifications disabled' };
    }
    
    // Check subscription before applying
    const subActive = await isSubscriptionActive();
    if (!subActive) {
      log('OF Stats Editor: Subscription not active, restoring original values');
      restoreOriginalValues();
      // Clear localStorage cache
      try {
        localStorage.removeItem('ofStatsCache');
      } catch(e) {}
      showElements();
      return { success: false, message: 'Subscription expired' };
    }
    
    storeOriginalValues();
    
    const balanceEls = findBalanceElements();
    const socialEls = findSocialElements();
    
    let modified = 0;
    
    // Apply balance changes
    if (settings.currentBalance && settings.currentBalance.trim()) {
      if (balanceEls.currentBalance) {
        const rawValue = settings.currentBalance.trim();
        const formattedValue = formatNumber(rawValue);
        balanceEls.currentBalance.textContent = `$${formattedValue}`;
        modified++;
        log('OF Stats Editor: Updated current balance to', formattedValue);
      }
    }
    
    if (settings.pendingBalance && settings.pendingBalance.trim()) {
      if (balanceEls.pendingBalance) {
        const rawValue = settings.pendingBalance.trim();
        const formattedValue = formatNumber(rawValue);
        balanceEls.pendingBalance.textContent = `$${formattedValue}`;
        modified++;
        log('OF Stats Editor: Updated pending balance to', formattedValue);
      }
    }
    
    // Apply social stats changes
    if (settings.fansCount && settings.fansCount.trim()) {
      if (socialEls.fansCount) {
        socialEls.fansCount.textContent = ` ${settings.fansCount.trim()} `;
        modified++;
        log('OF Stats Editor: Updated fans count to', settings.fansCount);
        
        // Update aria-label for tooltip
        const parent = socialEls.fansCount.closest('.l-sidebar__user-data__item');
        if (parent) {
          const ariaValue = settings.fansCount.replace(/[^\d]/g, '') || settings.fansCount;
          parent.setAttribute('aria-label', ariaValue);
        }
      }
      
      // Also update profile page Fans button count (main page) - ONLY on our own profile
      const isOwn = isOwnProfilePage();
      log('OF Stats Editor: Checking if should update profile fans - isOwnProfilePage:', isOwn);
      if (isOwn) {
        const profileFansButtons = document.querySelectorAll('button.b-profile__sections__item');
        profileFansButtons.forEach(btn => {
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          if (label.includes('fans')) {
            const countSpan = btn.querySelector('span.b-profile__sections__count');
            if (countSpan) {
              countSpan.textContent = settings.fansCount.trim();
              modified++;
              log('OF Stats Editor: Updated profile fans count to', settings.fansCount);
            }
          }
        });
      } else {
        log('OF Stats Editor: Skipping profile fans update - not our profile page');
      }
    }
    
    if (settings.followingCount && settings.followingCount.trim()) {
      if (socialEls.followingCount) {
        socialEls.followingCount.textContent = ` ${settings.followingCount.trim()} `;
        modified++;
        log('OF Stats Editor: Updated following count to', settings.followingCount);
        
        // Update aria-label for tooltip
        const parent = socialEls.followingCount.closest('.l-sidebar__user-data__item');
        if (parent) {
          const ariaValue = settings.followingCount.replace(/[^\d]/g, '') || settings.followingCount;
          parent.setAttribute('aria-label', ariaValue);
        }
      }
      
      // Also update profile page Following button count (main page) - ONLY on our own profile
      if (isOwnProfilePage()) {
        const profileFollowingButtons = document.querySelectorAll('button.b-profile__sections__item');
        profileFollowingButtons.forEach(btn => {
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          if (label.includes('following')) {
            const countSpan = btn.querySelector('span.b-profile__sections__count');
            if (countSpan) {
              countSpan.textContent = settings.followingCount.trim();
              modified++;
              log('OF Stats Editor: Updated profile following count to', settings.followingCount);
            }
          }
        });
      }
    }
    
    // Apply Top Creators banner
    if (settings.topCreators && settings.topCreators.trim()) {
      applyTopCreatorsBanner(settings.topCreators.trim());
      modified++;
    } else {
      removeTopCreatorsBanner();
    }
    
    // Apply Earnings generation
    const pendingCount = settings.earningsCount ? parseInt(settings.earningsCount) : 0;
    const completeCount = settings.earningsCompleteCount ? parseInt(settings.earningsCompleteCount) : 0;
    
    if (pendingCount > 0 || completeCount > 0) {
      // Reset earnings applied flag if forceApply to regenerate rows with correct tooltips
      if (forceApply) {
        window.ofStatsEarningsApplied = false;
      }
      
      // Apply for /my/statements/earnings page
      if (applyEarningsGeneration(pendingCount, completeCount)) {
        modified++;
      }
      
      // Apply for /my/statistics/statements/earnings page (via inject-early.js function)
      // Only call if forceApply=true OR not already applied (check for data-of-stats-applied attribute)
      if (isStatisticsStatementsEarningsPage() && typeof window.ofStatsApplyStatisticsEarningsPage === 'function') {
        const wrapper = document.querySelector('.b-statistics-page-content__wrapper');
        const alreadyApplied = wrapper && wrapper.getAttribute('data-of-stats-applied') === 'true';
        
        if (forceApply || !alreadyApplied) {
          log('OF Stats Editor: Applying statistics/statements/earnings page via inject-early function, forceApply=' + forceApply);
          // Pass forceApply as second argument - only regenerate charts when user explicitly clicks Apply
          window.ofStatsApplyStatisticsEarningsPage(settings, forceApply);
          modified++;
        }
      }
      
      // Init status tooltips for existing elements
      if (typeof window.ofStatsInitStatusTooltips === 'function') {
        setTimeout(function() {
          window.ofStatsInitStatusTooltips();
        }, 100);
      }
    } else {
      // No Earnings counts set, but still apply /my/statistics/statements/earnings page
      // It will generate data automatically from /my/stats/earnings data
      if (isStatisticsStatementsEarningsPage() && typeof window.ofStatsApplyStatisticsEarningsPage === 'function') {
        const wrapper = document.querySelector('.b-statistics-page-content__wrapper');
        const alreadyApplied = wrapper && wrapper.getAttribute('data-of-stats-applied') === 'true';
        
        if (forceApply || !alreadyApplied) {
          log('OF Stats Editor: Applying statistics/statements/earnings page (auto-generated) via inject-early function, forceApply=' + forceApply);
          // Pass forceApply as second argument - only regenerate charts when user explicitly clicks Apply
          window.ofStatsApplyStatisticsEarningsPage(settings, forceApply);
          modified++;
        }
      }
      
      removeGeneratedEarnings();
    }
    
    // Activate withdrawal button
    activateWithdrawButton();
    
    // Show elements after all modifications
    showElements();
    
    // Cache settings to localStorage for instant next load
    try {
      localStorage.setItem('ofStatsCache', JSON.stringify(settings));
    } catch(e) {}
    
    // Notify inject-early.js about settings change (it uses in-memory cachedSettings)
    try {
      window.dispatchEvent(new CustomEvent('ofStatsSettingsChanged', { detail: settings }));
    } catch(e) {}
    
    return { 
      success: true, 
      modified: modified,
      message: `Modified ${modified} elements` 
    };
  }
  
  // Show elements after modifications (cleanup any hiding)
  function showElements() {
    // Remove any hiding styles if present
    const hideStyle = document.getElementById('of-stats-hide-early');
    if (hideStyle) {
      hideStyle.remove();
    }
    log('OF Stats Editor: Modifications complete');
  }
  
  // Restore original values
  function restoreOriginalValues() {
    log('OF Stats Editor: Restoring original values');
    
    // Clear all localStorage caches
    try {
      localStorage.removeItem('ofStatsCache');
      localStorage.removeItem('ofStatsEarningStats');
      localStorage.removeItem('ofStatsEarningsData');
    } catch(e) {}
    
    const balanceEls = findBalanceElements();
    const socialEls = findSocialElements();
    
    if (originalValues.currentBalance && balanceEls.currentBalance) {
      balanceEls.currentBalance.textContent = originalValues.currentBalance;
    }
    if (originalValues.pendingBalance && balanceEls.pendingBalance) {
      balanceEls.pendingBalance.textContent = originalValues.pendingBalance;
    }
    if (originalValues.fansCount && socialEls.fansCount) {
      socialEls.fansCount.textContent = originalValues.fansCount;
    }
    if (originalValues.followingCount && socialEls.followingCount) {
      socialEls.followingCount.textContent = originalValues.followingCount;
    }
    
    // Remove Top Creators banner
    removeTopCreatorsBanner();
    
    // Remove generated content from /my/statistics/statements/earnings page
    if (isStatisticsStatementsEarningsPage()) {
      const wrapper = document.querySelector('.b-statistics-page-content__wrapper');
      if (wrapper) {
        wrapper.querySelectorAll('[data-of-stats-generated]').forEach(el => el.remove());
        wrapper.removeAttribute('data-of-stats-applied');
      }
      document.querySelectorAll('.b-useful-data[data-of-stats-processed]').forEach(el => {
        el.removeAttribute('data-of-stats-processed');
      });
    }
    
    // Remove generated earnings from /my/statements/earnings page
    removeGeneratedEarnings();
    
    return { success: true };
  }
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log('OF Stats Editor: Received message:', request.action);
    
    try {
      switch (request.action) {
        case 'getModelName':
          const modelName = getModelName();
          const avatarUrl = getModelAvatar();
          sendResponse({ modelName: modelName, avatarUrl: avatarUrl, success: true });
          break;
          
        case 'applyChanges':
          applyModifications(request.settings, true).then(applyResult => {
            sendResponse(applyResult);
          });
          return true; // Keep message channel open for async
          
        case 'resetChanges':
          const resetResult = restoreOriginalValues();
          sendResponse(resetResult);
          break;
          
        case 'getStatus':
          sendResponse({ 
            ready: true,
            modelName: getModelName(),
            success: true
          });
          break;
          
        case 'ping':
          sendResponse({ pong: true, success: true });
          break;
          
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      logError('OF Stats Editor: Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
    
    return true; // Keep the message channel open for async response
  });
  
  // Check if subscription is active
  // SECURITY: We trust the server's isActive flag to prevent clock manipulation attacks
  async function isSubscriptionActive() {
    try {
      const result = await chrome.storage.local.get(['ofStatsSubscription', 'ofStatsSubscriptionActive']);
      
      // SECURITY: Use the server-validated active flag
      // This flag is set by popup.js after verifying with server
      // Server calculates isActive using: expires_at > NOW() (server time)
      if (result.ofStatsSubscriptionActive === false) {
        return false;
      }
      
      // Check server's isActive flag from subscription data
      if (result.ofStatsSubscription) {
        const sub = result.ofStatsSubscription;
        
        // Trust server's isActive boolean (calculated with server time)
        if (typeof sub.isActive === 'boolean') {
          return sub.isActive;
        }
        
        // Fallback: check status field (set by server)
        if (sub.status === 'expired' || sub.status === 'trial_expired') {
          return false;
        }
      }
      
      return true;
    } catch (e) {
      // Don't log errors in production
      return true; // Default to active if can't check
    }
  }
  
  // Auto-apply saved settings on page load
  async function autoApplySettings() {
    try {
      // Check subscription first
      const subActive = await isSubscriptionActive();
      if (!subActive) {
        log('OF Stats Editor: Subscription not active, not applying fake values');
        restoreOriginalValues();
        return;
      }
      
      const result = await chrome.storage.local.get('ofStatsSettings');
      const settings = result.ofStatsSettings;
      
      if (settings && settings.enabled) {
        log('OF Stats Editor: Auto-applying saved settings');
        await applyModifications(settings);
      }
    } catch (error) {
      log('OF Stats Editor: Could not auto-apply settings', error);
    }
  }
  
  // Initialize
  function init() {
    log('OF Stats Editor Pro: Initializing...');
    
    // Track URL for SPA navigation
    let lastUrl = window.location.href;
    
    // Helper to check if URL is an earnings page
    function isEarningsUrl(url) {
      return url.includes('/my/statements/earnings') || 
             url.includes('/my/statistics/statements/earnings') ||
             url.includes('/my/stats/earnings');
    }
    
    // Check URL changes and reset earnings when navigating
    function checkUrlForEarnings() {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        const wasEarnings = isEarningsUrl(lastUrl);
        const isEarnings = isEarningsUrl(currentUrl);
        lastUrl = currentUrl;
        
        // Reset earnings state when navigating away
        if (wasEarnings && !isEarnings) {
          window.ofStatsEarningsApplied = false;
          window.ofStatsEarningsIndex = 0;
          if (window.ofStatsTbodyObserver) {
            window.ofStatsTbodyObserver.disconnect();
          }
        }
        
        // Re-apply when navigating to earnings (don't reset index - use cached data)
        if (isEarnings) {
          window.ofStatsEarningsApplied = false;
          // Don't reset ofStatsEarningsIndex - keep using cached data
          // Re-read settings from localStorage cache and apply immediately
          autoApplySettings();
        }
      }
    }
    
    // Poll for URL changes
    setInterval(checkUrlForEarnings, 200);
    window.addEventListener('popstate', () => setTimeout(checkUrlForEarnings, 50));
    
    // Apply immediately when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoApplySettings);
    } else {
      autoApplySettings();
    }
    
    // Also observe for dynamic content changes (SPA navigation)
    const observer = new MutationObserver((mutations) => {
      // Check if profile sections were added
      let hasProfileSections = false;
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            if (node.classList && (
                node.classList.contains('b-profile__sections__item') ||
                node.querySelector && node.querySelector('.b-profile__sections__item')
            )) {
              hasProfileSections = true;
            }
          }
        });
      });
      
      // If profile sections were added, apply immediately (with subscription check)
      if (hasProfileSections) {
        isSubscriptionActive().then(async subActive => {
          if (!subActive) return;
          try {
            const result = await chrome.storage.local.get('ofStatsSettings');
            const settings = result.ofStatsSettings;
            if (settings && settings.enabled) {
              await applyModifications(settings);
            }
          } catch (e) {}
        }).catch(() => {});
        return;
      }
      
      // Debounce - but shorter delay for other changes
      clearTimeout(observer.timeout);
      observer.timeout = setTimeout(async () => {
        try {
          // Check subscription first
          const subActive = await isSubscriptionActive();
          if (!subActive) {
            return;
          }
          
          const result = await chrome.storage.local.get('ofStatsSettings');
          const settings = result.ofStatsSettings;
          if (settings && settings.enabled) {
            await applyModifications(settings);
          }
        } catch (e) {
          // Ignore errors during observation
        }
      }, 200); // Reduced from 300ms to 200ms
    });
    
    // Start observing when body is available
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
          childList: true,
          subtree: true
        });
      });
    }
  }
  
  init();
})();

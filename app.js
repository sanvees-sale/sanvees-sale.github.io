/**
 * ==========================================================================
 * SANVEE'S CLOUD POS & PROFIT TRACKER
 * GOOGLE SHEETS DATABASE POWERED FRONTEND ENGINE
 * ==========================================================================
 */

// Global State
let products = [];
let sales = [];
let dailyCosts = {};
let selectedProdId = null;
let undoStack = [];
let parsedRestoreData = null;
let isSyncInProgress = false;
let autoSyncInterval = null;

// Dynamic Auth Credentials (synced with Google Sheet SystemAuth)
let authCredentials = {
  admin: "project420",
  staff: "staff123"
};

// Google Sheet Configuration
const DEFAULT_SHEET_URL = "https://script.google.com/macros/s/AKfycbxMn73q5bv69RBZsaSkrn5NKQdHgkrY_Rmbk8WC7VkAjISrk5cPBDoC5uHpTivEjDLy/exec";
const STORAGE_KEY_SHEET_URL = "sanvee_google_sheet_api_url";
const STORAGE_KEY_DB_CACHE = "sanvee_pos_local_db_cache";

function getSheetApiUrl() {
  return localStorage.getItem(STORAGE_KEY_SHEET_URL) || DEFAULT_SHEET_URL;
}

function setSheetApiUrl(url) {
  localStorage.setItem(STORAGE_KEY_SHEET_URL, url.trim());
}

// ==========================================================================
// LOCAL STORAGE CACHING (Instant Load & Offline Resiliency)
// ==========================================================================
function saveLocalCache() {
  try {
    const payload = {
      products: products,
      sales: sales,
      dailyCosts: dailyCosts,
      systemAuth: authCredentials,
      cachedAt: Date.now()
    };
    localStorage.setItem(STORAGE_KEY_DB_CACHE, JSON.stringify(payload));
  } catch (err) {
    console.warn("LocalStorage cache full or error:", err);
  }
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DB_CACHE);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data) {
      if (Array.isArray(data.products)) products = data.products;
      if (Array.isArray(data.sales)) sales = data.sales;
      if (data.dailyCosts && typeof data.dailyCosts === 'object') dailyCosts = data.dailyCosts;
      if (data.systemAuth) {
        if (data.systemAuth.admin) authCredentials.admin = String(data.systemAuth.admin);
        if (data.systemAuth.staff) authCredentials.staff = String(data.systemAuth.staff);
      }
      return true;
    }
  } catch (err) {
    console.error("Error loading cache:", err);
  }
  return false;
}

// Load cache immediately on startup for zero-delay rendering
loadLocalCache();

// ==========================================================================
// SYNC STATUS INDICATOR
// ==========================================================================
function updateSyncStatus(status, message) {
  const dot = document.getElementById('sync-indicator-dot');
  const text = document.getElementById('sync-status-text');
  const icon = document.getElementById('sync-icon');

  if (!dot || !text) return;

  if (status === 'syncing') {
    dot.className = "inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-amber-400 animate-ping flex-shrink-0";
    text.innerText = message || "Syncing with Sheet...";
    if (icon) icon.classList.add('fa-spin');
  } else if (status === 'connected') {
    dot.className = "inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)] flex-shrink-0";
    text.innerText = message || "Google Sheet Synced";
    if (icon) icon.classList.remove('fa-spin');
  } else if (status === 'offline') {
    dot.className = "inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-slate-400 flex-shrink-0";
    text.innerText = message || "Offline (Local Cache)";
    if (icon) icon.classList.remove('fa-spin');
  } else if (status === 'error') {
    dot.className = "inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] flex-shrink-0";
    text.innerText = message || "Sync Error (Check URL)";
    if (icon) icon.classList.remove('fa-spin');
  }
}

// ==========================================================================
// GOOGLE SHEETS API SERVICE
// ==========================================================================
const GoogleSheetDB = {
  async request(action, data = {}) {
    const url = getSheetApiUrl();
    if (!url) {
      updateSyncStatus('offline', 'Setup Google Sheet URL');
      return { status: 'offline', message: 'No Sheet URL configured' };
    }

    // Use text/plain POST payload to bypass CORS preflight issues with Google Apps Script
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: action, data: data })
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    return await res.json();
  },

  async fetchAll() {
    if (isSyncInProgress) return;
    const url = getSheetApiUrl();
    if (!url) {
      updateSyncStatus('offline', 'Setup Sheet in Settings');
      return;
    }

    isSyncInProgress = true;
    updateSyncStatus('syncing', 'Syncing Google Sheet...');

    try {
      const res = await this.request('getAll');
      if (res && res.status === 'success' && res.data) {
        products = res.data.products || [];
        sales = res.data.sales || [];
        dailyCosts = res.data.dailyCosts || {};
        if (res.data.systemAuth) {
          if (res.data.systemAuth.admin) authCredentials.admin = String(res.data.systemAuth.admin);
          if (res.data.systemAuth.staff) authCredentials.staff = String(res.data.systemAuth.staff);
        }

        saveLocalCache();
        updateSyncStatus('connected', 'Google Sheet Synced');
        renderAllViews();
      } else {
        updateSyncStatus('error', res.message || 'Error fetching data');
      }
    } catch (err) {
      console.error("Google Sheet fetch error:", err);
      updateSyncStatus('error', 'Connection Failed');
    } finally {
      isSyncInProgress = false;
    }
  },

  async addProduct(prod) {
    products.push(prod);
    saveLocalCache();
    renderProductSelector();
    renderDailyView();
    try {
      await this.request('addProduct', prod);
      updateSyncStatus('connected', 'Product Added');
    } catch (err) {
      console.error("Failed to add product to cloud:", err);
      updateSyncStatus('error', 'Saved locally (Cloud retry needed)');
    }
  },

  async updateProduct(prod) {
    const idx = products.findIndex(p => String(p.id) === String(prod.id));
    if (idx !== -1) {
      products[idx] = Object.assign(products[idx], prod);
      saveLocalCache();
      renderAllViews();
    }
    try {
      await this.request('updateProduct', prod);
      updateSyncStatus('connected', 'Product Updated');
    } catch (err) {
      console.error("Failed to update product in cloud:", err);
    }
  },

  async deleteProduct(prodId) {
    products = products.filter(p => String(p.id) !== String(prodId));
    sales = sales.filter(s => String(s.productId) !== String(prodId) && (!s.id || !s.id.endsWith('_' + prodId)));
    saveLocalCache();
    renderAllViews();
    try {
      await this.request('deleteProduct', { id: prodId });
      updateSyncStatus('connected', 'Product Deleted');
    } catch (err) {
      console.error("Failed to delete product from cloud:", err);
    }
  },

  async saveSale(sale) {
    const idx = sales.findIndex(s => s.id === sale.id);
    if (idx !== -1) {
      sales[idx] = Object.assign(sales[idx], sale);
    } else {
      sales.push(sale);
    }
    saveLocalCache();
    renderAllViews();
    try {
      await this.request('saveSale', sale);
      updateSyncStatus('connected', 'Sale Saved');
    } catch (err) {
      console.error("Failed to save sale to cloud:", err);
    }
  },

  async batchUpdateSales(salesList) {
    salesList.forEach(item => {
      const idx = sales.findIndex(s => s.id === item.id);
      if (idx !== -1) {
        sales[idx] = Object.assign(sales[idx], item);
      } else {
        sales.push(item);
      }
    });
    saveLocalCache();
    renderAllViews();
    try {
      await this.request('batchUpdateSales', { sales: salesList });
      updateSyncStatus('connected', 'Sales Batch Updated');
    } catch (err) {
      console.error("Failed to batch update sales:", err);
    }
  },

  async setDailyCost(date, cost) {
    dailyCosts[date] = Number(cost) || 0;
    saveLocalCache();
    renderAllViews();
    try {
      await this.request('setDailyCost', { date: date, cost: cost });
      updateSyncStatus('connected', 'Cost Saved');
    } catch (err) {
      console.error("Failed to save daily cost to cloud:", err);
    }
  },

  async updateAuth(adminPass, staffPass) {
    authCredentials.admin = String(adminPass);
    authCredentials.staff = String(staffPass);
    saveLocalCache();
    try {
      await this.request('updateAuth', { admin: adminPass, staff: staffPass });
      updateSyncStatus('connected', 'Passwords Updated');
      return true;
    } catch (err) {
      console.error("Failed to update passwords in cloud:", err);
      return false;
    }
  },

  async restoreDatabase(payload) {
    updateSyncStatus('syncing', 'Restoring Database...');
    try {
      const res = await this.request('restoreDatabase', payload);
      if (res && res.status === 'success') {
        if (payload.products) products = Array.isArray(payload.products) ? payload.products : Object.values(payload.products);
        if (payload.sales) sales = Array.isArray(payload.sales) ? payload.sales : Object.values(payload.sales);
        if (payload.dailyCosts) dailyCosts = payload.dailyCosts;
        if (payload.systemAuth) {
          if (payload.systemAuth.admin) authCredentials.admin = String(payload.systemAuth.admin);
          if (payload.systemAuth.staff) authCredentials.staff = String(payload.systemAuth.staff);
        }
        saveLocalCache();
        renderAllViews();
        updateSyncStatus('connected', 'Database Restored');
        return true;
      }
      throw new Error(res.message || 'Restore failed');
    } catch (err) {
      console.error("Restore error:", err);
      updateSyncStatus('error', 'Restore Failed');
      throw err;
    }
  },

  async batchSyncAll(payload) {
    updateSyncStatus('syncing', 'Syncing batch to Google Sheet...');
    try {
      const res = await this.request('batchSyncAll', payload);
      if (res && res.status === 'success') {
        updateSyncStatus('connected', 'Google Sheet Synced');
        return res;
      }
      throw new Error(res ? res.message : 'Sync failed');
    } catch (err) {
      console.error("Batch sync to Sheet error:", err);
      updateSyncStatus('error', 'Sheet Sync Failed');
      throw err;
    }
  }
};

// ==========================================================================
// HIGH PERFORMANCE CANVAS IMAGE COMPRESSOR
// (Resizes & Compresses images to fit lightweight in Google Sheets)
// ==========================================================================
function compressImageFile(file, maxWidth = 380, maxHeight = 380, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = function (e) {
      const img = new Image();
      img.onerror = reject;
      img.onload = function () {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ==========================================================================
// UNIFIED FINANCIAL & QUANTITY HELPERS
// ==========================================================================
function getRecordQty(s) {
  if (!s) return 0;
  if (typeof s.monthlyQty === 'number' && s.monthlyQty > 0) {
    return s.monthlyQty;
  }
  const parsedMonthly = parseInt(s.monthlyQty);
  if (!isNaN(parsedMonthly) && parsedMonthly > 0) {
    return parsedMonthly;
  }
  if (typeof s.qty === 'number' && s.qty > 0) {
    return s.qty;
  }
  const parsedQty = parseInt(s.qty);
  return (!isNaN(parsedQty) && parsedQty > 0) ? parsedQty : 0;
}

function getRecordGross(s, prod) {
  if (!s) return 0;
  const q = getRecordQty(s);
  if (q <= 0) return 0;

  if (typeof s.monthlyGrossProfit === 'number' && s.monthlyGrossProfit > 0) {
    return s.monthlyGrossProfit;
  }
  if (typeof s.grossProfit === 'number' && s.grossProfit > 0) {
    return s.grossProfit;
  }
  if (prod && typeof prod.selling === 'number' && typeof prod.buying === 'number') {
    return (prod.selling - prod.buying) * q;
  }
  if (typeof s.selling === 'number' && typeof s.buying === 'number') {
    return (s.selling - s.buying) * q;
  }
  return 0;
}

function getTodayString() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function formatDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DEFAULT_FALLBACK_THUMBNAIL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23fef3c7'%3E%3Crect width='100' height='100' rx='16' fill='%23fef3c7'/%3E%3Cpath d='M30 65 L45 45 L58 58 L68 46 L80 65 Z' fill='%23f59e0b'/%3E%3Ccircle cx='40' cy='35' r='7' fill='%23f59e0b'/%3E%3C/svg%3E";

function getProductForSale(s) {
  if (!s) return null;
  const pId = String(s.productId || (s.id ? s.id.split('_')[1] : ''));
  if (pId) {
    const byId = products.find(p => String(p.id) === pId);
    if (byId) return byId;
  }
  if (s.desc || s.selling) {
    const byDetails = products.find(p => (s.desc && p.desc === s.desc) || (p.selling === s.selling && p.buying === s.buying));
    if (byDetails) return byDetails;
  }
  return null;
}

function getImageForSale(s, prod) {
  if (prod && prod.image && prod.image.trim().length > 10) return prod.image;
  if (s && s.image && s.image.trim().length > 10) return s.image;
  return DEFAULT_FALLBACK_THUMBNAIL;
}

// ==========================================================================
// ROLE & PERMISSIONS MANAGEMENT
// ==========================================================================
function getCurrentUserRole() {
  const storedRole = sessionStorage.getItem('userRole');
  if (storedRole) return storedRole;
  if (sessionStorage.getItem('isLoggedIn') === 'true') {
    return 'admin';
  }
  return 'staff';
}

function applyRolePermissions() {
  const role = getCurrentUserRole();
  const badgeText = document.getElementById('role-badge-text');
  const badgeEl = document.getElementById('header-role-badge');
  const body = document.body;

  body.classList.remove('role-admin', 'role-staff');

  if (role === 'admin') {
    body.classList.add('role-admin');
    if (badgeText) badgeText.innerText = 'Admin (Full Access)';
    if (badgeEl) {
      badgeEl.className = 'px-2 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black flex items-center gap-1 shadow-sm bg-amber-500/20 text-amber-400 border border-amber-500/30';
    }
  } else {
    body.classList.add('role-staff');
    if (badgeText) badgeText.innerText = 'Staff (Daily Entry Only)';
    if (badgeEl) {
      badgeEl.className = 'px-2 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black flex items-center gap-1 shadow-sm bg-indigo-500/20 text-indigo-300 border border-indigo-500/30';
    }
    switchTab('daily');
  }
}

// ==========================================================================
// AUTH LOGIN SYSTEM
// ==========================================================================
document.getElementById('form-login').addEventListener('submit', (e) => {
  e.preventDefault();
  const user = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value.trim();

  if (user === 'admin' && pass === authCredentials.admin) {
    sessionStorage.setItem('isLoggedIn', 'true');
    sessionStorage.setItem('userRole', 'admin');
    checkAuth();
  } else if (user === 'staff' && pass === authCredentials.staff) {
    sessionStorage.setItem('isLoggedIn', 'true');
    sessionStorage.setItem('userRole', 'staff');
    checkAuth();
  } else {
    document.getElementById('login-error').classList.remove('hidden');
  }
});

function checkAuth() {
  const loggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
  if (loggedIn) {
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    applyRolePermissions();
    initAppSession();
  } else {
    document.getElementById('login-modal').classList.remove('hidden');
    document.getElementById('app-content').classList.add('hidden');
    if (autoSyncInterval) clearInterval(autoSyncInterval);
  }
}

function handleLogout() {
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('userRole');
  checkAuth();
}

function initAppSession() {
  renderAllViews();
  GoogleSheetDB.fetchAll();

  // Polling every 15 seconds for multi-device sync
  if (autoSyncInterval) clearInterval(autoSyncInterval);
  autoSyncInterval = setInterval(() => {
    GoogleSheetDB.fetchAll();
  }, 15000);
}

// ==========================================================================
// GOOGLE SHEET SETTINGS MODAL
// ==========================================================================
function openSheetConfigModal() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Only Admin can configure Google Sheet settings.');
  }
  const modal = document.getElementById('sheet-config-modal');
  const input = document.getElementById('input-sheet-url');
  const statusBox = document.getElementById('sheet-test-status');

  if (modal) {
    if (input) input.value = getSheetApiUrl();
    if (statusBox) statusBox.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closeSheetConfigModal() {
  const modal = document.getElementById('sheet-config-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

async function testSheetConnection() {
  const input = document.getElementById('input-sheet-url');
  const statusBox = document.getElementById('sheet-test-status');
  const testBtn = document.getElementById('btn-test-sheet-conn');
  const url = input ? input.value.trim() : '';

  if (!url) {
    if (statusBox) {
      statusBox.className = "p-3 rounded-xl text-xs font-bold bg-rose-50 border border-rose-200 text-rose-700 block";
      statusBox.innerHTML = '<i class="fa-solid fa-circle-exclamation mr-1"></i> Please paste your Apps Script Web App URL first.';
    }
    return;
  }

  if (testBtn) {
    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing...';
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "ping" })
    });
    const data = await res.json();

    if (data && (data.status === 'success' || data.message)) {
      statusBox.className = "p-3 rounded-xl text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-800 block";
      statusBox.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-600 mr-1"></i> Success! Connected to Google Sheet Database.';
    } else {
      throw new Error(data.message || "Invalid response");
    }
  } catch (err) {
    statusBox.className = "p-3 rounded-xl text-xs font-bold bg-rose-50 border border-rose-200 text-rose-700 block";
    statusBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-600 mr-1"></i> Connection failed: ${err.message}. Make sure the Web App is deployed as 'Anyone'.`;
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.innerHTML = '<i class="fa-solid fa-plug"></i> Test Connection';
    }
  }
}

document.getElementById('form-sheet-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = document.getElementById('input-sheet-url').value.trim();
  if (!url) return alert('Please enter a valid Google Apps Script Web App URL.');

  setSheetApiUrl(url);
  closeSheetConfigModal();
  alert('✅ Google Sheet Database URL saved successfully!');
  GoogleSheetDB.fetchAll();
});

function triggerManualSync() {
  GoogleSheetDB.fetchAll();
}

// ==========================================================================
// 1-CLICK FULL DATABASE JSON BACKUP & RESTORE
// ==========================================================================
function exportDatabaseToJson() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Only Admin can export database backups.');
  }

  const backupPayload = {
    meta: {
      appName: "Sanvee POS & Profit Tracker",
      databaseBackend: "Google Sheets",
      exportedAt: new Date().toISOString(),
      version: "3.0"
    },
    products: products,
    sales: sales,
    dailyCosts: dailyCosts,
    systemAuth: authCredentials
  };

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupPayload, null, 2));
  const now = new Date();
  const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeFormatted = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  const filename = `sanvee_pos_backup_${dateFormatted}_${timeFormatted}.json`;

  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", filename);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();

  alert(`✅ Full database backup downloaded successfully as:\n${filename}\n\nKeep this file safe in your Google Drive or computer!`);
}

function openRestoreModal() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Only Admin can restore database.');
  }
  const modal = document.getElementById('restore-modal');
  if (modal) {
    document.getElementById('input-restore-file').value = '';
    document.getElementById('restore-preview-box').classList.add('hidden');
    document.getElementById('btn-confirm-restore').disabled = true;
    parsedRestoreData = null;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closeRestoreModal() {
  const modal = document.getElementById('restore-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function previewBackupFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (evt) {
    try {
      const data = JSON.parse(evt.target.result);
      const prods = data.products ? (Array.isArray(data.products) ? data.products : Object.values(data.products)) : [];
      const sls = data.sales ? (Array.isArray(data.sales) ? data.sales : Object.values(data.sales)) : [];
      const costs = data.dailyCosts ? (typeof data.dailyCosts === 'object' ? Object.keys(data.dailyCosts) : []) : [];

      document.getElementById('preview-prod-count').innerText = `${prods.length} Items`;
      document.getElementById('preview-sales-count').innerText = `${sls.length} Records`;
      document.getElementById('preview-costs-count').innerText = `${costs.length} Days`;

      parsedRestoreData = data;
      document.getElementById('restore-preview-box').classList.remove('hidden');
      document.getElementById('btn-confirm-restore').disabled = false;
    } catch (err) {
      alert('Invalid JSON file. Please select a valid Sanvee POS backup JSON file.');
      document.getElementById('restore-preview-box').classList.add('hidden');
      document.getElementById('btn-confirm-restore').disabled = true;
      parsedRestoreData = null;
    }
  };
  reader.readAsText(file);
}

async function executeDatabaseRestore() {
  if (!parsedRestoreData) {
    return alert('Please select a valid backup JSON file first.');
  }

  if (!confirm('⚠️ WARNING: Restoring will overwrite existing Google Sheets cloud data with the contents of this backup file. Are you sure you want to proceed?')) {
    return;
  }

  const btn = document.getElementById('btn-confirm-restore');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Restoring to Google Sheet...';

  try {
    await GoogleSheetDB.restoreDatabase(parsedRestoreData);
    alert('🎉 Database successfully restored to Google Sheets!');
    closeRestoreModal();
  } catch (err) {
    alert('Error restoring database to Google Sheets: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Restore to Cloud';
  }
}

// ==========================================================================
// CHANGE PASSWORD MODAL & HANDLERS
// ==========================================================================
function openPasswordModal() {
  const modal = document.getElementById('password-modal');
  if (modal) {
    const adminInput = document.getElementById('input-new-admin-pass');
    const staffInput = document.getElementById('input-new-staff-pass');
    if (adminInput) adminInput.value = authCredentials.admin || 'project420';
    if (staffInput) staffInput.value = authCredentials.staff || 'staff123';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closePasswordModal() {
  const modal = document.getElementById('password-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

const formChangePass = document.getElementById('form-change-password');
if (formChangePass) {
  formChangePass.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (getCurrentUserRole() !== 'admin') {
      return alert('Access Denied: Only Admin can change passwords.');
    }

    const newAdmin = document.getElementById('input-new-admin-pass').value.trim();
    const newStaff = document.getElementById('input-new-staff-pass').value.trim();

    if (!newAdmin || !newStaff) {
      return alert('Passwords cannot be empty.');
    }

    const success = await GoogleSheetDB.updateAuth(newAdmin, newStaff);
    if (success) {
      alert('✅ Admin & Staff passwords successfully updated in Google Sheet!');
      closePasswordModal();
    } else {
      alert('⚠️ Passwords updated locally, but failed to sync to Google Sheet.');
    }
  });
}

// ==========================================================================
// PRODUCT MANAGEMENT (ADD / EDIT / DELETE)
// ==========================================================================
document.getElementById('form-add-product').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = document.getElementById('input-prod-file').files[0];
  if (!file) return alert('Please select a product image file.');

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Optimizing & Uploading...';
  }

  try {
    // Compress image to lightweight thumbnail suitable for Google Sheets
    const compressedImageBase64 = await compressImageFile(file, 380, 380, 0.75);

    const id = Date.now();
    const buy = parseFloat(document.getElementById('input-prod-buy').value) || 0;
    const sell = parseFloat(document.getElementById('input-prod-sell').value) || 0;

    const newProd = {
      id: id,
      image: compressedImageBase64,
      buying: buy,
      selling: sell,
      grossProfitUnit: sell - buy,
      desc: document.getElementById('input-prod-desc').value.trim() || 'Collection'
    };

    await GoogleSheetDB.addProduct(newProd);
    e.target.reset();
    alert('✅ Product image and details successfully uploaded to Google Sheet database!');
  } catch (err) {
    console.error("Add product error:", err);
    alert('Error processing image: ' + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up mr-1.5"></i> Upload Product to Catalog';
    }
  }
});

function openEditModal(e, id) {
  if (e) e.stopPropagation();
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Product editing is restricted to Admin only.');
  }

  const prod = products.find(p => String(p.id) === String(id));
  if (!prod) return;

  document.getElementById('edit-prod-id').value = prod.id;
  document.getElementById('edit-prod-buy').value = prod.buying;
  document.getElementById('edit-prod-sell').value = prod.selling;
  document.getElementById('edit-prod-desc').value = prod.desc || '';

  const modal = document.getElementById('edit-product-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeEditModal() {
  const modal = document.getElementById('edit-product-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

document.getElementById('form-edit-product').addEventListener('submit', (e) => {
  e.preventDefault();
  if (getCurrentUserRole() !== 'admin') return;

  const id = parseInt(document.getElementById('edit-prod-id').value);
  const buy = parseFloat(document.getElementById('edit-prod-buy').value) || 0;
  const sell = parseFloat(document.getElementById('edit-prod-sell').value) || 0;
  const desc = document.getElementById('edit-prod-desc').value.trim();

  GoogleSheetDB.updateProduct({
    id: id,
    buying: buy,
    selling: sell,
    grossProfitUnit: sell - buy,
    desc: desc
  });

  closeEditModal();
});

function deleteProduct(e, id) {
  if (e) e.stopPropagation();
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Product deletion is restricted to Admin only.');
  }

  if (!confirm('Permanently delete this product from Google Sheets catalog and sales history?')) return;

  GoogleSheetDB.deleteProduct(id);

  if (String(selectedProdId) === String(id)) {
    clearProductSelection();
  }
}

// ==========================================================================
// SALES RECORDING & ENTRIES
// ==========================================================================
document.getElementById('form-sale-entry').addEventListener('submit', (e) => {
  e.preventDefault();
  const qty = parseInt(document.getElementById('input-sale-qty').value);
  if (isNaN(qty) || qty < 0) return alert('Please enter a valid quantity');
  const date = document.getElementById('input-sale-date').value || getTodayString();

  if (!selectedProdId) {
    return alert('Please select a product picture first.');
  }

  const prod = products.find(p => String(p.id) === String(selectedProdId));
  if (!prod) return alert('Product not found.');

  const saleId = `${date}_${prod.id}`;
  const existingSale = sales.find(s => s.id === saleId);

  saveUndoSnapshot(date);

  const gross = (prod.selling - prod.buying) * qty;
  const prevMonthlyQty = existingSale ? (existingSale.monthlyQty !== undefined ? existingSale.monthlyQty : 0) : 0;
  const prevMonthlyGross = existingSale ? (existingSale.monthlyGrossProfit !== undefined ? existingSale.monthlyGrossProfit : 0) : 0;

  const saleData = {
    id: saleId,
    productId: prod.id,
    image: prod.image,
    buying: prod.buying,
    selling: prod.selling,
    desc: prod.desc,
    qty: qty,
    grossProfit: gross,
    monthlyQty: prevMonthlyQty,
    monthlyGrossProfit: prevMonthlyGross,
    date: date
  };

  GoogleSheetDB.saveSale(saleData);
});

function updateSaleQty(prodId, newQtyStr) {
  const qty = parseInt(newQtyStr);
  if (isNaN(qty) || qty < 0) return;

  const date = document.getElementById('input-sale-date').value || getTodayString();
  const prod = products.find(p => String(p.id) === String(prodId));
  if (!prod) return;

  const saleId = `${date}_${prod.id}`;
  const existingSale = sales.find(s => s.id === saleId);

  saveUndoSnapshot(date);

  const gross = (prod.selling - prod.buying) * qty;
  const prevMonthlyQty = existingSale ? (existingSale.monthlyQty !== undefined ? existingSale.monthlyQty : 0) : 0;
  const prevMonthlyGross = existingSale ? (existingSale.monthlyGrossProfit !== undefined ? existingSale.monthlyGrossProfit : 0) : 0;

  const saleData = {
    id: saleId,
    productId: prod.id,
    image: prod.image,
    buying: prod.buying,
    selling: prod.selling,
    desc: prod.desc,
    qty: qty,
    grossProfit: gross,
    monthlyQty: prevMonthlyQty,
    monthlyGrossProfit: prevMonthlyGross,
    date: date
  };

  GoogleSheetDB.saveSale(saleData);
}

function selectProductCard(id) {
  selectedProdId = id;
  document.getElementById('selected-prod-id').value = id;

  renderProductSelector();

  const date = document.getElementById('input-sale-date').value || getTodayString();
  const existingSale = sales.find(s => s.date === date && (String(s.productId) === String(id) || (s.id && s.id.endsWith('_' + id))));
  const qtyInput = document.getElementById('input-sale-qty');
  const btnSubmit = document.getElementById('btn-sale-submit');

  if (existingSale) {
    const currentQ = getRecordQty(existingSale);
    qtyInput.value = currentQ;
    btnSubmit.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Update Sale Qty (${currentQ} Pcs)`;
  } else {
    qtyInput.value = 1;
    btnSubmit.innerHTML = `<i class="fa-solid fa-plus"></i> Add / Update Sale Entry`;
  }
}

function clearProductSelection() {
  selectedProdId = null;
  document.getElementById('selected-prod-id').value = '';
  document.querySelectorAll('.prod-select-card').forEach(c => {
    c.classList.remove('border-amber-500', 'bg-amber-50', 'ring-2', 'ring-amber-400');
    c.classList.add('border-slate-100', 'bg-white');
  });
  document.getElementById('input-sale-qty').value = 1;
  const btnSubmit = document.getElementById('btn-sale-submit');
  if (btnSubmit) {
    btnSubmit.innerHTML = `<i class="fa-solid fa-plus"></i> Add / Update Sale Entry`;
  }
}

document.addEventListener('click', (e) => {
  const form = document.getElementById('form-sale-entry');
  const editModal = document.getElementById('edit-product-modal');
  const passModal = document.getElementById('password-modal');
  const restoreModal = document.getElementById('restore-modal');
  const sheetModal = document.getElementById('sheet-config-modal');

  if (
    selectedProdId &&
    form &&
    !form.contains(e.target) &&
    (!editModal || !editModal.contains(e.target)) &&
    (!passModal || !passModal.contains(e.target)) &&
    (!restoreModal || !restoreModal.contains(e.target)) &&
    (!sheetModal || !sheetModal.contains(e.target))
  ) {
    clearProductSelection();
  }
});

// ==========================================================================
// UNDO, MONTHLY SAVE, RESET & CLEAR SALES
// ==========================================================================
function saveUndoSnapshot(date) {
  const currentSales = sales.filter(s => s.date === date);
  undoStack.push({
    date: date,
    salesSnapshot: JSON.parse(JSON.stringify(currentSales))
  });
}

function performUndo() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Undo action is restricted to Admin.');
  }
  if (undoStack.length === 0) {
    alert('No history available to undo!');
    return;
  }
  const lastState = undoStack.pop();
  GoogleSheetDB.batchUpdateSales(lastState.salesSnapshot);
}

function saveTodayToMonthly() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Saving to Monthly is restricted to Admin.');
  }

  const date = document.getElementById('input-sale-date').value || getTodayString();
  const todaysSales = sales.filter(s => s.date === date);

  if (todaysSales.length === 0) {
    return alert('No sales data to save for selected date!');
  }

  const updatedSales = todaysSales.map(s => ({
    ...s,
    monthlyQty: s.qty,
    monthlyGrossProfit: s.grossProfit
  }));

  GoogleSheetDB.batchUpdateSales(updatedSales);
  alert(`✅ Sales data for ${date} successfully saved to Monthly Report in Google Sheets!`);
}

function resetDayWiseData() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Resetting data is restricted to Admin.');
  }

  const targetDate = document.getElementById('input-monthly-date-filter').value;
  if (!targetDate) {
    return alert('Please select a date in "Specific Date Filter" first to reset its data to 0!');
  }

  if (!confirm(`Reset saved monthly report data for ${targetDate} to 0 in Google Sheets?`)) return;

  const daySales = sales.filter(s => s.date === targetDate);
  const resetSales = daySales.map(s => ({
    ...s,
    qty: 0,
    grossProfit: 0,
    monthlyQty: 0,
    monthlyGrossProfit: 0
  }));

  GoogleSheetDB.batchUpdateSales(resetSales);
  alert(`✅ Saved data for ${targetDate} successfully reset to 0!`);
}

function clearDateFilter() {
  document.getElementById('input-monthly-date-filter').value = '';
  document.getElementById('input-monthly-cost-edit').value = '';
  renderMonthlyView();
}

function clearTodaySale() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Clearing sales is restricted to Admin.');
  }

  const date = document.getElementById('input-sale-date').value || getTodayString();
  const todaysSales = sales.filter(s => s.date === date);
  if (todaysSales.length === 0) return alert('No sales recorded for this date!');

  if (confirm('Reset daily sales for this date to 0 in Google Sheets?')) {
    saveUndoSnapshot(date);
    const resetSales = todaysSales.map(s => ({
      ...s,
      qty: 0,
      grossProfit: 0,
      monthlyQty: 0,
      monthlyGrossProfit: 0
    }));
    GoogleSheetDB.batchUpdateSales(resetSales);
  }
}

// ==========================================================================
// RENDERERS: PRODUCT SELECTOR & DAILY VIEW
// ==========================================================================
function renderProductSelector() {
  const grid = document.getElementById('product-grid-selector');
  const date = document.getElementById('input-sale-date').value || getTodayString();
  const role = getCurrentUserRole();

  if (!grid) return;

  if (products.length === 0) {
    grid.innerHTML = `<p class="col-span-full text-[11px] text-slate-400 text-center py-4 font-semibold">No products uploaded yet. Add a product above to start.</p>`;
    return;
  }

  grid.innerHTML = products.map(p => {
    const todayQty = sales
      .filter(s => s.date === date && (String(s.productId) === String(p.id) || (s.id && s.id.endsWith('_' + p.id))))
      .reduce((sum, item) => sum + getRecordQty(item), 0);

    const isSelected = String(selectedProdId) === String(p.id);
    const selectedClass = isSelected ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-400' : 'border-slate-100 bg-white';

    const adminOverlay = role === 'admin' ? `
      <div class="absolute top-1 right-1 flex flex-col gap-1 transition-opacity duration-200 z-50 opacity-0 group-hover:opacity-100 pointer-events-auto">
         <button type="button" onclick="event.stopPropagation(); openEditModal(event, '${p.id}')" class="bg-blue-500/95 text-white p-1.5 rounded hover:bg-blue-600 shadow-md backdrop-blur-sm cursor-pointer" title="Edit Product"><i class="fa-solid fa-pen text-[10px]"></i></button>
         <button type="button" onclick="event.stopPropagation(); deleteProduct(event, '${p.id}')" class="bg-rose-500/95 text-white p-1.5 rounded hover:bg-rose-600 shadow-md backdrop-blur-sm cursor-pointer" title="Delete Product"><i class="fa-solid fa-trash text-[10px]"></i></button>
      </div>
    ` : '';

    return `
      <div onclick="selectProductCard('${p.id}')" id="prod-card-${p.id}" class="prod-select-card relative cursor-pointer border rounded-xl p-1.5 flex flex-col items-center transition-all hover:border-amber-400 hover:shadow-md shadow-sm ${selectedClass} group">
        <img src="${p.image || DEFAULT_FALLBACK_THUMBNAIL}" class="img-selector object-cover rounded-lg border border-slate-100" alt="Product Image">
        <span class="text-[10px] font-black text-slate-800 mt-1.5">৳${p.selling}</span>
        ${todayQty > 0 ? `<span class="absolute top-1 left-1 bg-amber-500 text-slate-900 font-black text-[9px] px-1.5 py-0.5 rounded-md shadow">${todayQty}</span>` : ''}
        ${adminOverlay}
      </div>
    `;
  }).join('');
}

function renderDailyView() {
  const date = document.getElementById('input-sale-date').value || getTodayString();
  const summaryDateEl = document.getElementById('summary-header-date');
  if (summaryDateEl) summaryDateEl.innerText = `Date: ${date}`;
  const role = getCurrentUserRole();

  const tbody = document.getElementById('tbody-daily-sales');
  if (!tbody) return;

  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 text-xs font-semibold">No products added yet.</td></tr>`;
  } else {
    let totalQty = 0;
    let totalGrossProfit = 0;

    tbody.innerHTML = products.map((p, idx) => {
      const s = sales.find(item => item.date === date && (String(item.productId) === String(p.id) || (item.id && item.id.endsWith('_' + p.id))));
      const qty = getRecordQty(s);
      const grossProfit = getRecordGross(s, p);

      totalQty += qty;
      totalGrossProfit += grossProfit;

      const priceBadges = `
        <div class="text-[11px] font-semibold text-slate-600 flex gap-1.5 items-center">
          <span class="bg-amber-100/80 text-amber-900 px-2 py-0.5 rounded shadow-sm border border-amber-200 font-bold">Sell: ৳${p.selling}</span>
          <span class="text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">Buy: ৳${p.buying}</span>
        </div>
      `;

      const financialCol = role === 'admin' ? `
        <td class="admin-only p-2.5 sm:p-4 font-black text-xs sm:text-sm text-slate-800">৳ ${grossProfit}</td>
      ` : '';

      const actionCol = role === 'admin' ? `
        <td class="admin-only p-2.5 sm:p-4 text-center no-print">
          <button onclick="deleteProduct(event, '${p.id}')" class="text-rose-400 hover:text-white bg-rose-50 hover:bg-rose-500 p-1.5 sm:p-2 transition-colors rounded-lg shadow-sm border border-rose-100 hover:border-rose-500 cursor-pointer" title="Delete Product"><i class="fa-solid fa-trash-can text-xs"></i></button>
        </td>
      ` : '';

      return `
        <tr class="hover:bg-slate-100/50 transition-colors border-b border-slate-50" data-sell-price="${p.selling}">
          <td class="p-2.5 sm:p-4 text-center font-bold text-slate-400 text-xs">${idx + 1}</td>
          <td class="p-2.5 sm:p-4"><img src="${p.image || DEFAULT_FALLBACK_THUMBNAIL}" class="img-compact shadow-sm border border-slate-100 object-cover rounded-lg" alt="Thumbnail"></td>
          <td class="p-2.5 sm:p-4">
            <div class="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
              <span class="text-[11px] sm:text-xs font-bold text-slate-500">Qty:</span>
              <input type="number" min="0" value="${qty}" onchange="updateSaleQty(${p.id}, this.value)" class="w-14 sm:w-16 border border-slate-200 rounded-lg p-1 text-xs font-black text-slate-900 bg-amber-50 text-center outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition-all">
              <span class="text-[11px] sm:text-xs font-bold text-slate-400">Pcs</span>
            </div>
            ${priceBadges}
          </td>
          ${financialCol}
          <td class="p-2.5 sm:p-4 text-xs text-slate-600 leading-relaxed font-medium">${p.desc || ''}</td>
          ${actionCol}
        </tr>
      `;
    }).join('');

    const costingInput = document.getElementById('input-daily-costing');
    const costing = parseFloat(costingInput ? costingInput.value : 0) || 0;
    const perProdCost = totalQty > 0 ? (costing / totalQty).toFixed(2) : 0;
    const totalProfit = totalGrossProfit - costing;

    document.getElementById('summary-qty').innerText = `${totalQty} Pcs`;

    if (role === 'admin') {
      document.getElementById('summary-gross-profit').innerText = `৳ ${totalGrossProfit}`;
      document.getElementById('summary-costing').innerText = `৳ ${costing}`;
      document.getElementById('summary-per-product-cost').innerText = `৳ ${perProdCost}`;
      document.getElementById('summary-total-profit').innerText = `৳ ${totalProfit}`;
    }
  }

  filterDailyTableByPrice();
}

// ==========================================================================
// RENDERERS: MONTHLY VIEW
// ==========================================================================
function renderMonthlyView() {
  if (getCurrentUserRole() !== 'admin') return;

  const monthFilter = document.getElementById('input-monthly-filter').value;
  const dateFilter = document.getElementById('input-monthly-date-filter').value;

  let filteredSales = sales.filter(s => s.date && s.date.startsWith(monthFilter));
  if (dateFilter) {
    filteredSales = filteredSales.filter(s => s.date === dateFilter);
  }

  const activeFilteredSales = filteredSales.filter(s => getRecordQty(s) > 0);
  const tbody = document.getElementById('tbody-monthly-sales');
  if (!tbody) return;

  if (activeFilteredSales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-xs font-semibold">No monthly records found for selected filter.</td></tr>`;
  } else {
    tbody.innerHTML = activeFilteredSales.map((s, idx) => {
      const prod = getProductForSale(s);
      const imgSrc = getImageForSale(s, prod);
      const q = getRecordQty(s);
      const g = getRecordGross(s, prod);
      const sellPrice = s.selling || (prod ? prod.selling : 0);
      const buyPrice = s.buying || (prod ? prod.buying : 0);
      const desc = s.desc || (prod ? prod.desc : '');
      const pId = prod ? prod.id : (s.productId || (s.id ? s.id.split('_')[1] : ''));

      return `
        <tr class="hover:bg-slate-100/50 transition-colors border-b border-slate-50">
          <td class="p-2.5 sm:p-4 text-center font-bold text-slate-400 text-xs">${idx + 1}</td>
          <td class="p-2.5 sm:p-4 font-extrabold text-slate-700 bg-slate-50/50 text-[11px] sm:text-xs">${s.date}</td>
          <td class="p-2.5 sm:p-4"><img src="${imgSrc}" class="img-compact shadow-sm border border-slate-100 object-cover rounded-lg" alt="Thumbnail"></td>
          <td class="p-2.5 sm:p-4">
            <div class="text-[11px] sm:text-xs font-black text-slate-800 bg-slate-100 px-2 py-0.5 sm:py-1 rounded inline-block mb-1">Qty: ${q} Pcs</div>
            <div class="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 sm:mt-1 font-semibold">Sell: ৳${sellPrice} <span class="text-slate-300 mx-1">|</span> Buy: ৳${buyPrice}</div>
          </td>
          <td class="p-2.5 sm:p-4 font-black text-xs sm:text-sm text-indigo-700">৳ ${g}</td>
          <td class="p-2.5 sm:p-4 text-xs text-slate-600 leading-relaxed font-medium">${desc}</td>
          <td class="p-2.5 sm:p-4 text-center no-print">
            <button onclick="deleteProduct(event, '${pId}')" class="text-rose-400 hover:text-white bg-rose-50 hover:bg-rose-500 p-1.5 sm:p-2 transition-colors rounded-lg shadow-sm border border-rose-100 hover:border-rose-500 cursor-pointer" title="Delete Product Completely">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  let totalMonthlyQty = 0;
  let totalMonthlyGross = 0;
  activeFilteredSales.forEach(s => {
    const prod = getProductForSale(s);
    totalMonthlyQty += getRecordQty(s);
    totalMonthlyGross += getRecordGross(s, prod);
  });

  let totalMonthlyCosting = 0;
  if (dateFilter) {
    totalMonthlyCosting = dailyCosts[dateFilter] || 0;
  } else {
    Object.keys(dailyCosts).forEach(d => {
      if (d.startsWith(monthFilter)) {
        totalMonthlyCosting += parseFloat(dailyCosts[d]) || 0;
      }
    });
  }

  const elMQty = document.getElementById('m-stat-qty');
  const elMGross = document.getElementById('m-stat-gross');
  const elMCost = document.getElementById('m-stat-costing');
  const elMNet = document.getElementById('m-stat-net');

  if (elMQty) elMQty.innerText = `${totalMonthlyQty} Pcs`;
  if (elMGross) elMGross.innerText = `৳ ${totalMonthlyGross}`;
  if (elMCost) elMCost.innerText = `৳ ${totalMonthlyCosting}`;
  if (elMNet) elMNet.innerText = `৳ ${totalMonthlyGross - totalMonthlyCosting}`;
}

// ==========================================================================
// RENDERERS: RANGE DAILY REPORTS (TAB 4)
// ==========================================================================
function generateRangeDailyReports() {
  if (getCurrentUserRole() !== 'admin') return;

  const fromStr = document.getElementById('input-range-from') ? document.getElementById('input-range-from').value : '';
  const toStr = document.getElementById('input-range-to') ? document.getElementById('input-range-to').value : '';
  const showFilter = document.getElementById('select-range-filter') ? document.getElementById('select-range-filter').value : 'sales_only';
  const container = document.getElementById('range-reports-container');

  if (!container || !fromStr || !toStr) return;

  const startDate = new Date(fromStr + 'T00:00:00');
  const endDate = new Date(toStr + 'T00:00:00');

  if (startDate > endDate) {
    container.innerHTML = `<p class="col-span-full text-center text-rose-500 font-bold py-8">From Date must be earlier than or equal to To Date!</p>`;
    return;
  }

  const summaryDatesEl = document.getElementById('range-summary-dates');
  if (summaryDatesEl) {
    summaryDatesEl.innerText = `${fromStr} to ${toStr}`;
  }

  let totalDaysCount = 0;
  let rangeTotalQty = 0;
  let rangeTotalGross = 0;
  let rangeTotalCost = 0;

  let dayCardsHtml = [];
  let cur = new Date(startDate);
  let datesList = [];

  while (cur <= endDate) {
    datesList.push(formatDateString(cur));
    cur.setDate(cur.getDate() + 1);
  }

  datesList.forEach(dStr => {
    const dateObj = new Date(dStr + 'T00:00:00');
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
    const daySales = sales.filter(s => s.date === dStr);

    let dayQty = 0;
    let dayGrossProfit = 0;
    let itemsList = [];

    daySales.forEach(s => {
      const q = getRecordQty(s);
      if (q > 0) {
        const prod = getProductForSale(s) || {
          id: s.productId || (s.id ? s.id.split('_')[1] : ''),
          image: s.image || '',
          selling: s.selling || 0,
          buying: s.buying || 0,
          desc: s.desc || ''
        };
        const imgSrc = getImageForSale(s, prod);
        const itemProfit = getRecordGross(s, prod);

        dayQty += q;
        dayGrossProfit += itemProfit;
        itemsList.push({
          product: prod,
          image: imgSrc,
          qty: q,
          gross: itemProfit
        });
      }
    });

    const dayCost = parseFloat(dailyCosts[dStr]) || 0;
    const dayNetProfit = dayGrossProfit - dayCost;

    if (showFilter === 'sales_only' && dayQty === 0 && dayCost === 0) {
      return;
    }

    totalDaysCount++;
    rangeTotalQty += dayQty;
    rangeTotalGross += dayGrossProfit;
    rangeTotalCost += dayCost;

    const itemsTableRows = itemsList.length > 0 ? itemsList.map((item, idx) => `
      <tr class="border-b border-slate-100 text-[10px]">
        <td class="p-1 text-center text-slate-400 font-bold">${idx + 1}</td>
        <td class="p-1"><img src="${item.image}" class="report-table-img shadow-xs object-cover rounded" alt="Pic"></td>
        <td class="p-1">
          <div class="font-extrabold text-slate-800">৳${item.product.selling} <span class="text-[9px] text-slate-400 font-normal">/ ৳${item.product.buying}</span></div>
          <div class="text-[9px] text-slate-500 truncate max-w-[110px]">${item.product.desc || ''}</div>
        </td>
        <td class="p-1 text-center font-black text-amber-700 bg-amber-50/50 rounded">${item.qty} Pcs</td>
        <td class="p-1 text-right font-black text-emerald-700">৳${item.gross}</td>
      </tr>
    `).join('') : `
      <tr><td colspan="5" class="p-3 text-center text-slate-400 text-[10px] font-semibold">No sales entries recorded for this date.</td></tr>
    `;

    dayCardsHtml.push(`
      <div class="daily-report-card border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-xs">
        <div class="bg-slate-900 text-white px-3 py-2 flex justify-between items-center border-b border-slate-800">
          <div class="flex items-center gap-1.5 font-extrabold text-xs tracking-wide">
            <span class="bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded text-[10px] font-black">SANVEE'S</span>
            <span>Date: ${dStr}</span>
            <span class="text-slate-400 text-[10px] font-normal">(${dayName})</span>
          </div>
          <div class="text-[11px] text-emerald-400 font-black">Net: ৳${dayNetProfit}</div>
        </div>

        <div class="grid grid-cols-4 bg-slate-50 border-b border-slate-200 text-center divide-x divide-slate-200 text-[10px] py-1.5 font-bold">
          <div><span class="text-slate-400 block text-[9px] uppercase">Qty</span><span class="text-slate-900 font-black">${dayQty} Pcs</span></div>
          <div><span class="text-slate-400 block text-[9px] uppercase">Profit</span><span class="text-slate-900 font-black">৳${dayGrossProfit}</span></div>
          <div><span class="text-slate-400 block text-[9px] uppercase">Costing</span><span class="text-rose-600 font-black">৳${dayCost}</span></div>
          <div><span class="text-slate-400 block text-[9px] uppercase">Net Profit</span><span class="text-emerald-700 font-black">৳${dayNetProfit}</span></div>
        </div>

        <div class="p-2 flex-1 overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead class="bg-slate-100/70 text-slate-500 text-[9px] uppercase font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-1 text-center w-6">#</th>
                <th class="p-1 w-10">Pic</th>
                <th class="p-1">Price</th>
                <th class="p-1 text-center">Qty</th>
                <th class="p-1 text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              ${itemsTableRows}
            </tbody>
          </table>
        </div>
      </div>
    `);
  });

  const elDays = document.getElementById('range-total-days');
  const elQty = document.getElementById('range-total-qty');
  const elGross = document.getElementById('range-total-gross');
  const elCost = document.getElementById('range-total-cost');
  const elNet = document.getElementById('range-total-net');

  if (elDays) elDays.innerText = `${totalDaysCount} Days`;
  if (elQty) elQty.innerText = `${rangeTotalQty} Pcs`;
  if (elGross) elGross.innerText = `৳ ${rangeTotalGross}`;
  if (elCost) elCost.innerText = `৳ ${rangeTotalCost}`;
  if (elNet) elNet.innerText = `৳ ${rangeTotalGross - rangeTotalCost}`;

  if (dayCardsHtml.length === 0) {
    container.innerHTML = `<div class="col-span-full p-8 text-center bg-white rounded-3xl border border-slate-100 text-slate-400 text-xs font-semibold">No sales records found for the selected date range.</div>`;
  } else {
    container.innerHTML = dayCardsHtml.join('');
  }
}

// ==========================================================================
// RENDERERS: GRAND TOTAL LIFETIME SUMMARY (TAB 3)
// ==========================================================================
function renderGrandTotalView() {
  if (getCurrentUserRole() !== 'admin') return;

  let productStats = {};

  products.forEach(p => {
    productStats[String(p.id)] = {
      id: p.id,
      image: p.image || '',
      selling: p.selling || 0,
      buying: p.buying || 0,
      desc: p.desc || '',
      lifetimeQty: 0,
      lifetimeGross: 0
    };
  });

  sales.forEach(s => {
    const q = getRecordQty(s);
    if (q <= 0) return;

    const prod = getProductForSale(s);
    const pId = prod ? String(prod.id) : String(s.productId || (s.id ? s.id.split('_')[1] : ''));
    const g = getRecordGross(s, prod);

    if (pId) {
      if (!productStats[pId]) {
        productStats[pId] = {
          id: pId,
          image: getImageForSale(s, prod),
          selling: s.selling || (prod ? prod.selling : 0),
          buying: s.buying || (prod ? prod.buying : 0),
          desc: s.desc || (prod ? prod.desc : ''),
          lifetimeQty: 0,
          lifetimeGross: 0
        };
      } else {
        if (!productStats[pId].image || productStats[pId].image.length < 10) {
          productStats[pId].image = getImageForSale(s, prod);
        }
      }
      productStats[pId].lifetimeQty += q;
      productStats[pId].lifetimeGross += g;
    }
  });

  let grandQty = 0;
  let grandGross = 0;

  Object.values(productStats).forEach(p => {
    grandQty += p.lifetimeQty;
    grandGross += p.lifetimeGross;
  });

  let grandCosting = 0;
  Object.values(dailyCosts).forEach(c => {
    grandCosting += parseFloat(c) || 0;
  });

  const elGQty = document.getElementById('g-stat-qty');
  const elGGross = document.getElementById('g-stat-gross');
  const elGCost = document.getElementById('g-stat-costing');
  const elGNet = document.getElementById('g-stat-net');

  if (elGQty) elGQty.innerText = `${grandQty} Pcs`;
  if (elGGross) elGGross.innerText = `৳ ${grandGross}`;
  if (elGCost) elGCost.innerText = `৳ ${grandCosting}`;
  if (elGNet) elGNet.innerText = `৳ ${grandGross - grandCosting}`;

  const tbody = document.getElementById('tbody-grand-total-sales');
  if (!tbody) return;

  let soldProducts = Object.values(productStats).filter(p => p.lifetimeQty > 0);
  soldProducts.sort((a, b) => b.lifetimeQty - a.lifetimeQty);

  if (soldProducts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400 text-xs font-semibold">No lifetime sales records found.</td></tr>`;
  } else {
    tbody.innerHTML = soldProducts.map((p, idx) => `
      <tr class="hover:bg-slate-100/50 transition-colors border-b border-slate-50">
        <td class="p-2.5 sm:p-4 text-center font-bold text-slate-400 text-xs">${idx + 1}</td>
        <td class="p-2.5 sm:p-4"><img src="${p.image || DEFAULT_FALLBACK_THUMBNAIL}" class="img-compact shadow-sm border border-slate-100 object-cover rounded-lg" alt="Picture"></td>
        <td class="p-2.5 sm:p-4">
          <div class="text-xs sm:text-sm font-black text-amber-600 bg-amber-50 px-2 py-0.5 sm:py-1 inline-block rounded border border-amber-100 mb-1">Total Sold: ${p.lifetimeQty} Pcs</div>
          <div class="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 sm:mt-1 font-semibold">Sell: ৳${p.selling} <span class="text-slate-300 mx-1">|</span> Buy: ৳${p.buying}</div>
        </td>
        <td class="p-2.5 sm:p-4 font-black text-xs sm:text-base text-emerald-600">৳ ${p.lifetimeGross}</td>
        <td class="p-2.5 sm:p-4 text-xs text-slate-600 font-medium">${p.desc || ''}</td>
      </tr>
    `).join('');
  }
}

// Master Render Function
function renderAllViews() {
  renderProductSelector();
  renderDailyView();
  if (getCurrentUserRole() === 'admin') {
    renderMonthlyView();
    renderGrandTotalView();
    generateRangeDailyReports();
  }
  if (selectedProdId) {
    selectProductCard(selectedProdId);
  }
}

// ==========================================================================
// PRICE SEARCH & TAB NAVIGATION
// ==========================================================================
function filterDailyTableByPrice() {
  const input = document.getElementById('input-price-search');
  const searchValue = input ? input.value.trim() : '';
  const tbody = document.getElementById('tbody-daily-sales');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');
  rows.forEach(row => {
    if (!searchValue) {
      row.style.display = '';
      return;
    }
    const sellPrice = row.getAttribute('data-sell-price');
    if (sellPrice === searchValue) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

function clearPriceSearch() {
  const input = document.getElementById('input-price-search');
  if (input) {
    input.value = '';
    filterDailyTableByPrice();
  }
}

function switchTab(tab) {
  const role = getCurrentUserRole();
  if (role === 'staff' && tab !== 'daily') {
    tab = 'daily';
  }

  document.body.setAttribute('data-active-tab', tab);

  const dailyBtn = document.getElementById('tab-daily-btn');
  const monthlyBtn = document.getElementById('tab-monthly-btn');
  const reportsBtn = document.getElementById('tab-reports-btn');
  const totalBtn = document.getElementById('tab-total-btn');

  const dailySec = document.getElementById('tab-daily');
  const monthlySec = document.getElementById('tab-monthly');
  const reportsSec = document.getElementById('tab-reports');
  const totalSec = document.getElementById('tab-total');

  dailySec.classList.add('hidden');
  monthlySec.classList.add('hidden');
  reportsSec.classList.add('hidden');
  totalSec.classList.add('hidden');

  dailySec.classList.remove('fade-in');
  monthlySec.classList.remove('fade-in');
  reportsSec.classList.remove('fade-in');
  totalSec.classList.remove('fade-in');
  void dailySec.offsetWidth;

  const baseBtnClass = "flex-1 py-2.5 sm:py-3 text-center border-b-2 border-transparent text-slate-400 hover:text-white hover:bg-slate-800/30 flex justify-center items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap px-3 cursor-pointer text-[11px] sm:text-xs";
  const activeBtnClass = "flex-1 py-2.5 sm:py-3 text-center border-b-2 border-amber-500 text-amber-400 bg-slate-900/60 font-bold flex justify-center items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap px-3 cursor-pointer text-[11px] sm:text-xs";

  dailyBtn.className = baseBtnClass;
  monthlyBtn.className = baseBtnClass;
  reportsBtn.className = baseBtnClass;
  totalBtn.className = baseBtnClass;

  if (tab === 'daily') {
    dailySec.classList.remove('hidden');
    dailySec.classList.add('fade-in');
    dailyBtn.className = activeBtnClass;
  } else if (tab === 'monthly' && role === 'admin') {
    monthlySec.classList.remove('hidden');
    monthlySec.classList.add('fade-in');
    monthlyBtn.className = activeBtnClass;
  } else if (tab === 'reports' && role === 'admin') {
    reportsSec.classList.remove('hidden');
    reportsSec.classList.add('fade-in');
    reportsBtn.className = activeBtnClass;
    generateRangeDailyReports();
  } else if (tab === 'total' && role === 'admin') {
    totalSec.classList.remove('hidden');
    totalSec.classList.add('fade-in');
    totalBtn.className = activeBtnClass;
  }
}

// ==========================================================================
// PRINTING CONTROLLERS
// ==========================================================================
function printDailyReport() {
  if (getCurrentUserRole() !== 'admin') return alert('Access Denied: Printing is restricted to Admin.');
  switchTab('daily');
  setTimeout(() => window.print(), 150);
}

function printMonthlyReport() {
  if (getCurrentUserRole() !== 'admin') return alert('Access Denied: Printing is restricted to Admin.');
  switchTab('monthly');
  setTimeout(() => window.print(), 150);
}

function printRangeReports() {
  if (getCurrentUserRole() !== 'admin') return alert('Access Denied: Printing is restricted to Admin.');
  switchTab('reports');
  setTimeout(() => window.print(), 150);
}

function printGrandTotalReport() {
  if (getCurrentUserRole() !== 'admin') return alert('Access Denied: Printing is restricted to Admin.');
  switchTab('total');
  setTimeout(() => window.print(), 150);
}

function printCurrentTab() {
  if (getCurrentUserRole() !== 'admin') return alert('Access Denied: Printing is restricted to Admin.');

  const dailySec = document.getElementById('tab-daily');
  const monthlySec = document.getElementById('tab-monthly');
  const reportsSec = document.getElementById('tab-reports');
  const totalSec = document.getElementById('tab-total');

  if (dailySec && !dailySec.classList.contains('hidden')) {
    printDailyReport();
  } else if (monthlySec && !monthlySec.classList.contains('hidden')) {
    printMonthlyReport();
  } else if (reportsSec && !reportsSec.classList.contains('hidden')) {
    printRangeReports();
  } else if (totalSec && !totalSec.classList.contains('hidden')) {
    printGrandTotalReport();
  } else {
    window.print();
  }
}

// ==========================================================================
// GLOBAL EVENT LISTENERS & INITIALIZATION
// ==========================================================================
window.openPasswordModal = openPasswordModal;
window.closePasswordModal = closePasswordModal;
window.exportDatabaseToJson = exportDatabaseToJson;
window.openRestoreModal = openRestoreModal;
window.closeRestoreModal = closeRestoreModal;
window.previewBackupFile = previewBackupFile;
window.executeDatabaseRestore = executeDatabaseRestore;
window.openSheetConfigModal = openSheetConfigModal;
window.closeSheetConfigModal = closeSheetConfigModal;
window.testSheetConnection = testSheetConnection;
window.triggerManualSync = triggerManualSync;
window.switchTab = switchTab;
window.handleLogout = handleLogout;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.deleteProduct = deleteProduct;
window.updateSaleQty = updateSaleQty;
window.selectProductCard = selectProductCard;
window.clearTodaySale = clearTodaySale;
window.saveTodayToMonthly = saveTodayToMonthly;
window.resetDayWiseData = resetDayWiseData;
window.clearDateFilter = clearDateFilter;
window.performUndo = performUndo;
window.filterDailyTableByPrice = filterDailyTableByPrice;
window.clearPriceSearch = clearPriceSearch;
window.printDailyReport = printDailyReport;
window.printMonthlyReport = printMonthlyReport;
window.printRangeReports = printRangeReports;
window.printGrandTotalReport = printGrandTotalReport;
window.printCurrentTab = printCurrentTab;

// Initialize Date Pickers
const todayStr = getTodayString();
const saleDateInput = document.getElementById('input-sale-date');
if (saleDateInput) saleDateInput.value = todayStr;

const monthlyFilterInput = document.getElementById('input-monthly-filter');
if (monthlyFilterInput) monthlyFilterInput.value = todayStr.substring(0, 7);

// Initialize Range Default: 19th of last month to yesterday
function initDefaultReportRange() {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  let prevMonthYear = now.getFullYear();
  let prevMonth = now.getMonth() - 1;
  if (prevMonth < 0) {
    prevMonth = 11;
    prevMonthYear--;
  }
  const lastMonth19 = new Date(prevMonthYear, prevMonth, 19);

  const fromInput = document.getElementById('input-range-from');
  const toInput = document.getElementById('input-range-to');
  if (fromInput && toInput) {
    fromInput.value = formatDateString(lastMonth19);
    toInput.value = formatDateString(yesterday);
  }
}
initDefaultReportRange();

// Event listeners for dates & inputs
if (saleDateInput) {
  saleDateInput.addEventListener('change', () => {
    const selectedDate = saleDateInput.value || todayStr;
    const costInput = document.getElementById('input-daily-costing');
    if (costInput) {
      costInput.value = dailyCosts[selectedDate] || 0;
    }
    renderProductSelector();
    renderDailyView();
  });
}

const dailyCostingInput = document.getElementById('input-daily-costing');
if (dailyCostingInput) {
  dailyCostingInput.addEventListener('change', (e) => {
    if (getCurrentUserRole() !== 'admin') return;
    const selectedDate = (saleDateInput && saleDateInput.value) || todayStr;
    const val = parseFloat(e.target.value) || 0;
    GoogleSheetDB.setDailyCost(selectedDate, val);
  });
}

if (monthlyFilterInput) {
  monthlyFilterInput.addEventListener('change', renderMonthlyView);
}

const monthlyDateFilterInput = document.getElementById('input-monthly-date-filter');
if (monthlyDateFilterInput) {
  monthlyDateFilterInput.addEventListener('change', (e) => {
    const dateVal = e.target.value;
    const mCostEdit = document.getElementById('input-monthly-cost-edit');
    if (mCostEdit) {
      mCostEdit.value = dateVal ? (dailyCosts[dateVal] || 0) : '';
    }
    renderMonthlyView();
  });
}

const monthlyCostEditInput = document.getElementById('input-monthly-cost-edit');
if (monthlyCostEditInput) {
  monthlyCostEditInput.addEventListener('change', (e) => {
    if (getCurrentUserRole() !== 'admin') return;
    const targetDate = monthlyDateFilterInput.value;
    if (!targetDate) return;
    const val = parseFloat(e.target.value) || 0;
    GoogleSheetDB.setDailyCost(targetDate, val);
  });
}

// Modal Backdrop Click Closers
['password-modal', 'restore-modal', 'edit-product-modal', 'sheet-config-modal'].forEach(modalId => {
  const el = document.getElementById(modalId);
  if (el) {
    el.addEventListener('click', (e) => {
      if (e.target === el) {
        if (modalId === 'password-modal') closePasswordModal();
        if (modalId === 'restore-modal') closeRestoreModal();
        if (modalId === 'edit-product-modal') closeEditModal();
        if (modalId === 'sheet-config-modal') closeSheetConfigModal();
      }
    });
  }
});

// Run Initial Auth Check
checkAuth();
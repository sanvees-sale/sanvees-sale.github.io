// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyBvrbLXqMHsTG2N3eePFFO900luktM4W60",
  authDomain: "sanveepos.firebaseapp.com",
  databaseURL: "https://sanveepos-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sanveepos",
  storageBucket: "sanveepos.firebasestorage.app",
  messagingSenderId: "708358963481",
  appId: "1:708358963481:web:4fd9b8fa5b47093e6ac588",
  measurementId: "G-HF7TLQFK4Y"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let products = [];
let sales = [];
let dailyCosts = {};
let selectedProdId = null;
let undoStack = [];
let parsedRestoreData = null;

// Dynamic Cloud Auth Credentials (synced from Firebase /systemAuth)
let authCredentials = {
  admin: "project420",
  staff: "staff123"
};

// Listen to Cloud Password updates in Realtime
db.ref('systemAuth').on('value', snap => {
  const data = snap.val();
  if (data) {
    if (data.admin) authCredentials.admin = String(data.admin);
    if (data.staff) authCredentials.staff = String(data.staff);
  }
});

// Unified Helper Functions for Consistent Quantities and Financials across ALL tabs
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

// ROLE MANAGEMENT
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
      badgeEl.className = 'px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm bg-amber-500/20 text-amber-400 border border-amber-500/30';
    }
  } else {
    body.classList.add('role-staff');
    if (badgeText) badgeText.innerText = 'Staff (Daily Entry Only)';
    if (badgeEl) {
      badgeEl.className = 'px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm bg-indigo-500/20 text-indigo-300 border border-indigo-500/30';
    }
    // Force staff to daily entry tab
    switchTab('daily');
  }
}

// AUTH LOGIN SYSTEM (Checked against cloud dynamic passwords)
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
    initCloudSync();
  } else {
    document.getElementById('login-modal').classList.remove('hidden');
    document.getElementById('app-content').classList.add('hidden');
  }
}

function handleLogout() {
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('userRole');
  checkAuth();
}

checkAuth();

// ==========================================
// 1-CLICK FULL DATABASE JSON BACKUP & RESTORE
// ==========================================
function exportDatabaseToJson() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Only Admin can export database backups.');
  }

  db.ref('/').once('value').then(snapshot => {
    const rawData = snapshot.val() || {};
    const backupPayload = {
      meta: {
        appName: "Sanvee POS & Profit Tracker",
        exportedAt: new Date().toISOString(),
        version: "2.0"
      },
      products: rawData.products || {},
      sales: rawData.sales || {},
      dailyCosts: rawData.dailyCosts || {},
      systemAuth: rawData.systemAuth || { admin: "project420", staff: "staff123" }
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupPayload, null, 2));
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const timeFormatted = `${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
    const filename = `sanvee_pos_backup_${dateFormatted}_${timeFormatted}.json`;

    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    alert(`✅ Full database backup downloaded successfully as:\n${filename}\n\nKeep this file safe in your Google Drive or computer!`);
  }).catch(err => {
    alert('Error exporting database: ' + err.message);
  });
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
  reader.onload = function(evt) {
    try {
      const data = JSON.parse(evt.target.result);
      
      // Support both structured backups (with meta) and raw Firebase exports
      const prods = data.products ? (Array.isArray(data.products) ? data.products : Object.values(data.products)) : [];
      const sls = data.sales ? (Array.isArray(data.sales) ? data.sales : Object.values(data.sales)) : [];
      const costs = data.dailyCosts ? Object.keys(data.dailyCosts) : [];

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

function executeDatabaseRestore() {
  if (!parsedRestoreData) {
    return alert('Please select a valid backup JSON file first.');
  }

  if (!confirm('⚠️ WARNING: Restoring will overwrite existing cloud data with the contents of this backup file. Are you sure you want to proceed?')) {
    return;
  }

  const updates = {};
  if (parsedRestoreData.products) updates['products'] = parsedRestoreData.products;
  if (parsedRestoreData.sales) updates['sales'] = parsedRestoreData.sales;
  if (parsedRestoreData.dailyCosts) updates['dailyCosts'] = parsedRestoreData.dailyCosts;
  if (parsedRestoreData.systemAuth) updates['systemAuth'] = parsedRestoreData.systemAuth;

  db.ref('/').update(updates).then(() => {
    alert('🎉 Database successfully restored from backup file!');
    closeRestoreModal();
  }).catch(err => {
    alert('Error restoring database: ' + err.message);
  });
}

// CHANGE PASSWORD MODAL & HANDLERS
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

// Attach globally
window.openPasswordModal = openPasswordModal;
window.closePasswordModal = closePasswordModal;
window.exportDatabaseToJson = exportDatabaseToJson;
window.openRestoreModal = openRestoreModal;
window.closeRestoreModal = closeRestoreModal;
window.previewBackupFile = previewBackupFile;
window.executeDatabaseRestore = executeDatabaseRestore;
window.switchTab = switchTab;
window.handleLogout = handleLogout;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;

const btnOpenPass = document.getElementById('btn-open-passwords');
if (btnOpenPass) {
  btnOpenPass.addEventListener('click', openPasswordModal);
}

const passModalEl = document.getElementById('password-modal');
if (passModalEl) {
  passModalEl.addEventListener('click', (e) => {
    if (e.target === passModalEl) {
      closePasswordModal();
    }
  });
}

const restoreModalEl = document.getElementById('restore-modal');
if (restoreModalEl) {
  restoreModalEl.addEventListener('click', (e) => {
    if (e.target === restoreModalEl) {
      closeRestoreModal();
    }
  });
}

const editModalEl = document.getElementById('edit-product-modal');
if (editModalEl) {
  editModalEl.addEventListener('click', (e) => {
    if (e.target === editModalEl) {
      closeEditModal();
    }
  });
}

const formChangePass = document.getElementById('form-change-password');
if (formChangePass) {
  formChangePass.addEventListener('submit', (e) => {
    e.preventDefault();
    if (getCurrentUserRole() !== 'admin') {
      return alert('Access Denied: Only Admin can change passwords.');
    }

    const newAdmin = document.getElementById('input-new-admin-pass').value.trim();
    const newStaff = document.getElementById('input-new-staff-pass').value.trim();

    if (!newAdmin || !newStaff) {
      return alert('Passwords cannot be empty.');
    }

    db.ref('systemAuth').set({
      admin: newAdmin,
      staff: newStaff,
      updatedAt: Date.now()
    }).then(() => {
      authCredentials.admin = newAdmin;
      authCredentials.staff = newStaff;
      alert('✅ Admin & Staff passwords successfully updated in cloud!');
      closePasswordModal();
    }).catch(err => {
      alert('Error updating passwords: ' + err.message);
    });
  });
}

function initCloudSync() {
  db.ref('products').on('value', snap => {
    const data = snap.val();
    products = data ? Object.values(data) : [];
    renderProductSelector();
    renderDailyView();
    if (getCurrentUserRole() === 'admin') {
      renderMonthlyView();
      renderGrandTotalView();
      generateRangeDailyReports();
    }
  });

  db.ref('sales').on('value', snap => {
    const data = snap.val();
    sales = data ? Object.values(data) : [];
    renderDailyView();
    if (getCurrentUserRole() === 'admin') {
      renderMonthlyView();
      renderGrandTotalView();
      generateRangeDailyReports();
    }
    if (selectedProdId) {
      selectProductCard(selectedProdId);
    }
  });

  db.ref('dailyCosts').on('value', snap => {
    dailyCosts = snap.val() || {};
    const selectedDate = document.getElementById('input-sale-date').value || getTodayString();
    const costInput = document.getElementById('input-daily-costing');
    if (costInput) {
      costInput.value = dailyCosts[selectedDate] || 0;
    }
    
    const mDateFilter = document.getElementById('input-monthly-date-filter');
    if (mDateFilter && mDateFilter.value) {
      const mCostEdit = document.getElementById('input-monthly-cost-edit');
      if (mCostEdit) mCostEdit.value = dailyCosts[mDateFilter.value] || 0;
    }

    renderDailyView();
    if (getCurrentUserRole() === 'admin') {
      renderMonthlyView();
      renderGrandTotalView();
      generateRangeDailyReports();
    }
  });
}

function getTodayString() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function formatDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const todayStr = getTodayString();
document.getElementById('input-sale-date').value = todayStr;
document.getElementById('input-monthly-filter').value = todayStr.substring(0, 7);

// Initialize Range Report dates: Default 19th of last month to yesterday
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

function switchTab(tab) {
  const role = getCurrentUserRole();
  if (role === 'staff' && tab !== 'daily') {
    tab = 'daily'; // restrict staff to daily tab
  }

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
  
  // Re-trigger animation
  dailySec.classList.remove('fade-in');
  monthlySec.classList.remove('fade-in');
  reportsSec.classList.remove('fade-in');
  totalSec.classList.remove('fade-in');
  void dailySec.offsetWidth; // trigger reflow
  
  const baseBtnClass = "flex-1 py-3 text-center border-b-2 border-transparent text-slate-400 hover:text-white hover:bg-slate-800/30 flex justify-center items-center gap-2 transition-colors whitespace-nowrap px-3 cursor-pointer";
  const activeBtnClass = "flex-1 py-3 text-center border-b-2 border-amber-500 text-amber-400 bg-slate-900/60 font-bold flex justify-center items-center gap-2 transition-colors whitespace-nowrap px-3 cursor-pointer";

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
  if (selectedProdId && form && !form.contains(e.target) && (!editModal || !editModal.contains(e.target)) && (!passModal || !passModal.contains(e.target)) && (!restoreModal || !restoreModal.contains(e.target))) {
    clearProductSelection();
  }
});

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
  lastState.salesSnapshot.forEach(s => {
    db.ref('sales/' + s.id).set(s);
  });
  renderDailyView();
  renderMonthlyView();
  renderGrandTotalView();
  generateRangeDailyReports();
}

function saveTodayToMonthly() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Saving to Monthly is restricted to Admin.');
  }

  const date = document.getElementById('input-sale-date').value || todayStr;
  const todaysSales = sales.filter(s => s.date === date);

  if (todaysSales.length === 0) {
    return alert('No sales data to save for selected date!');
  }

  let updates = {};
  todaysSales.forEach(s => {
    updates[`sales/${s.id}/monthlyQty`] = s.qty;
    updates[`sales/${s.id}/monthlyGrossProfit`] = s.grossProfit;
  });

  db.ref().update(updates).then(() => {
    alert(`✅ Sales data for ${date} successfully saved to Monthly Report!`);
    renderMonthlyView();
    renderGrandTotalView();
    generateRangeDailyReports();
  });
}

function resetDayWiseData() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Resetting data is restricted to Admin.');
  }

  const targetDate = document.getElementById('input-monthly-date-filter').value;
  if (!targetDate) {
    return alert('Please select a date in "Specific Date Filter" first to reset its data to 0!');
  }

  if (!confirm(`Reset saved monthly report data for ${targetDate} to 0?`)) return;

  const daySales = sales.filter(s => s.date === targetDate);
  let updates = {};
  daySales.forEach(s => {
    updates[`sales/${s.id}/qty`] = 0;
    updates[`sales/${s.id}/grossProfit`] = 0;
    updates[`sales/${s.id}/monthlyQty`] = 0;
    updates[`sales/${s.id}/monthlyGrossProfit`] = 0;
  });

  db.ref().update(updates).then(() => {
    alert(`✅ Saved data for ${targetDate} successfully reset to 0!`);
    renderMonthlyView();
    renderGrandTotalView();
    generateRangeDailyReports();
  });
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

  const date = document.getElementById('input-sale-date').value || todayStr;
  const todaysSales = sales.filter(s => s.date === date);
  if (todaysSales.length === 0) return alert('No sales recorded for this date!');

  if (confirm('Reset daily sales for this date to 0?')) {
    saveUndoSnapshot(date);
    let updates = {};
    todaysSales.forEach(s => {
      updates[`sales/${s.id}/qty`] = 0;
      updates[`sales/${s.id}/grossProfit`] = 0;
      updates[`sales/${s.id}/monthlyQty`] = 0;
      updates[`sales/${s.id}/monthlyGrossProfit`] = 0;
    });
    db.ref().update(updates);
  }
}

// 1. ADD PRODUCT (Staff & Admin can both enter Buying & Selling Price)
document.getElementById('form-add-product').addEventListener('submit', (e) => {
  e.preventDefault();
  const file = document.getElementById('input-prod-file').files[0];
  if(!file) return alert('Please select an image file');

  const reader = new FileReader();
  reader.onload = function(evt) {
    const id = Date.now();
    const buy = parseFloat(document.getElementById('input-prod-buy').value) || 0;
    const sell = parseFloat(document.getElementById('input-prod-sell').value) || 0;
    
    const newProd = {
      id: id,
      image: evt.target.result,
      buying: buy,
      selling: sell,
      grossProfitUnit: sell - buy,
      desc: document.getElementById('input-prod-desc').value || 'Collection'
    };

    db.ref('products/' + id).set(newProd);
    e.target.reset();
    alert('✅ Product successfully uploaded to cloud catalog!');
  };
  reader.readAsDataURL(file);
});

// 2. RECORD / UPDATE SALE (Staff & Admin)
document.getElementById('form-sale-entry').addEventListener('submit', (e) => {
  e.preventDefault();
  const qty = parseInt(document.getElementById('input-sale-qty').value);
  if(isNaN(qty) || qty < 0) return alert('Please enter a valid quantity');
  const date = document.getElementById('input-sale-date').value || todayStr;

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

  db.ref('sales/' + saleId).set(saleData);
});

function updateSaleQty(prodId, newQtyStr) {
  const qty = parseInt(newQtyStr);
  if (isNaN(qty) || qty < 0) return;

  const date = document.getElementById('input-sale-date').value || todayStr;
  const prod = products.find(p => String(p.id) === String(prodId));
  if(!prod) return;

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

  db.ref('sales/' + saleId).set(saleData);
}

function selectProductCard(id) {
  selectedProdId = id;
  document.getElementById('selected-prod-id').value = id;
  
  renderProductSelector();

  const date = document.getElementById('input-sale-date').value || todayStr;
  const existingSale = sales.find(s => s.date === date && (String(s.productId) === String(id) || (s.id && s.id.endsWith('_' + id))));
  const qtyInput = document.getElementById('input-sale-qty');
  const btnSubmit = document.getElementById('btn-sale-submit');

  if(existingSale) {
    const currentQ = getRecordQty(existingSale);
    qtyInput.value = currentQ;
    btnSubmit.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Update Sale Qty (${currentQ} Pcs)`;
  } else {
    qtyInput.value = 1;
    btnSubmit.innerHTML = `<i class="fa-solid fa-plus"></i> Add / Update Sale Entry`;
  }
}

function deleteProduct(e, id) {
  if (e) e.stopPropagation();
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Product deletion is restricted to Admin only.');
  }

  if(!confirm('Permanently delete this product from catalog and sales history?')) return;
  
  db.ref('products/' + id).remove();

  sales.forEach(s => {
    if (String(s.productId) === String(id) || (s.id && s.id.endsWith('_' + id))) {
      db.ref('sales/' + s.id).remove();
    }
  });

  if(String(selectedProdId) === String(id)) {
    clearProductSelection();
  }
}

function renderProductSelector() {
  const grid = document.getElementById('product-grid-selector');
  const date = document.getElementById('input-sale-date').value || todayStr;
  const role = getCurrentUserRole();

  if (products.length === 0) {
    grid.innerHTML = `<p class="col-span-full text-[11px] text-slate-400 text-center py-4 font-semibold">No products uploaded yet.</p>`;
    return;
  }

  grid.innerHTML = products.map(p => {
    const todayQty = sales
      .filter(s => s.date === date && (String(s.productId) === String(p.id) || (s.id && s.id.endsWith('_' + p.id))))
      .reduce((sum, item) => sum + getRecordQty(item), 0);

    const isSelected = String(selectedProdId) === String(p.id);
    const selectedClass = isSelected ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-400' : 'border-slate-100 bg-white';
    
    // Only Admin gets Edit/Delete overlay buttons
    const adminOverlay = role === 'admin' ? `
      <div class="absolute top-1 right-1 flex flex-col gap-1 transition-opacity duration-200 z-50 opacity-0 group-hover:opacity-100 pointer-events-auto">
         <button type="button" onclick="event.stopPropagation(); openEditModal(event, '${p.id}')" class="bg-blue-500/95 text-white p-1.5 rounded hover:bg-blue-600 shadow-md backdrop-blur-sm cursor-pointer" title="Edit Product"><i class="fa-solid fa-pen text-[10px]"></i></button>
         <button type="button" onclick="event.stopPropagation(); deleteProduct(event, '${p.id}')" class="bg-rose-500/95 text-white p-1.5 rounded hover:bg-rose-600 shadow-md backdrop-blur-sm cursor-pointer" title="Delete Product"><i class="fa-solid fa-trash text-[10px]"></i></button>
      </div>
    ` : '';

    return `
      <div onclick="selectProductCard('${p.id}')" id="prod-card-${p.id}" class="prod-select-card relative cursor-pointer border rounded-xl p-1.5 flex flex-col items-center transition-all hover:border-amber-400 hover:shadow-md shadow-sm ${selectedClass} group">
        <img src="${p.image}" class="img-selector object-cover rounded-lg border border-slate-100">
        <span class="text-[10px] font-black text-slate-800 mt-1.5">৳${p.selling}</span>
        ${todayQty > 0 ? `<span class="absolute top-1 left-1 bg-amber-500 text-slate-900 font-black text-[9px] px-1.5 py-0.5 rounded-md shadow">${todayQty}</span>` : ''}
        ${adminOverlay}
      </div>
    `;
  }).join('');
}

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
  const desc = document.getElementById('edit-prod-desc').value;
  
  db.ref('products/' + id).update({
    buying: buy,
    selling: sell,
    grossProfitUnit: sell - buy,
    desc: desc
  }).then(() => {
    closeEditModal();
  });
});

function renderDailyView() {
  const date = document.getElementById('input-sale-date').value || todayStr;
  document.getElementById('summary-header-date').innerText = `Date: ${date}`;
  const role = getCurrentUserRole();

  const tbody = document.getElementById('tbody-daily-sales');
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

      // Both Staff and Admin can view Sell and Buy prices
      const priceBadges = `
        <div class="text-[11px] font-semibold text-slate-600 flex gap-1.5 items-center">
          <span class="bg-amber-100/80 text-amber-900 px-2 py-0.5 rounded shadow-sm border border-amber-200 font-bold">Sell: ৳${p.selling}</span>
          <span class="text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">Buy: ৳${p.buying}</span>
        </div>
      `;

      const financialCol = role === 'admin' ? `
        <td class="admin-only p-4 font-black text-sm text-slate-800">৳ ${grossProfit}</td>
      ` : '';

      const actionCol = role === 'admin' ? `
        <td class="admin-only p-4 text-center no-print">
          <button onclick="deleteProduct(event, ${p.id})" class="text-rose-400 hover:text-white bg-rose-50 hover:bg-rose-500 p-2 transition-colors rounded-lg shadow-sm border border-rose-100 hover:border-rose-500" title="Delete Product"><i class="fa-solid fa-trash-can"></i></button>
        </td>
      ` : '';

      return `
        <tr class="hover:bg-slate-100/50 transition-colors border-b border-slate-50" data-sell-price="${p.selling}">
          <td class="p-4 text-center font-bold text-slate-400">${idx + 1}</td>
          <td class="p-4"><img src="${p.image}" class="img-compact shadow-sm"></td>
          <td class="p-4">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-xs font-bold text-slate-500">Qty:</span>
              <input type="number" min="0" value="${qty}" onchange="updateSaleQty(${p.id}, this.value)" class="w-16 border border-slate-200 rounded-lg p-1 text-xs font-black text-slate-900 bg-amber-50 text-center outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition-all">
              <span class="text-xs font-bold text-slate-400">Pcs</span>
            </div>
            ${priceBadges}
          </td>
          ${financialCol}
          <td class="p-4 text-xs text-slate-600 leading-relaxed font-medium">${p.desc || ''}</td>
          ${actionCol}
        </tr>
      `;
    }).join('');

    const costing = parseFloat(document.getElementById('input-daily-costing') ? document.getElementById('input-daily-costing').value : 0) || 0;
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

function renderMonthlyView() {
  if (getCurrentUserRole() !== 'admin') return;

  const monthFilter = document.getElementById('input-monthly-filter').value;
  const dateFilter = document.getElementById('input-monthly-date-filter').value;

  let filteredSales = sales.filter(s => s.date && s.date.startsWith(monthFilter));
  if (dateFilter) {
    filteredSales = filteredSales.filter(s => s.date === dateFilter);
  }

  // Filter only records that have positive sales quantity
  const activeFilteredSales = filteredSales.filter(s => getRecordQty(s) > 0);

  const tbody = document.getElementById('tbody-monthly-sales');
  if (!tbody) return;

  if (activeFilteredSales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-xs font-semibold">No monthly records found for selected filter.</td></tr>`;
  } else {
    tbody.innerHTML = activeFilteredSales.map((s, idx) => {
      const pId = s.productId || (s.id ? s.id.split('_')[1] : null);
      const prod = products.find(p => String(p.id) === String(pId));
      const q = getRecordQty(s);
      const g = getRecordGross(s, prod);

      return `
        <tr class="hover:bg-slate-100/50 transition-colors border-b border-slate-50">
          <td class="p-4 text-center font-bold text-slate-400">${idx + 1}</td>
          <td class="p-4 font-extrabold text-slate-700 bg-slate-50/50">${s.date}</td>
          <td class="p-4"><img src="${s.image}" class="img-compact shadow-sm border-slate-100"></td>
          <td class="p-4">
            <div class="text-xs font-black text-slate-800 bg-slate-100 px-2 py-1 rounded inline-block mb-1">Qty: ${q} Pcs</div>
            <div class="text-[11px] text-slate-500 mt-1 font-semibold">Sell: ৳${s.selling} <span class="text-slate-300 mx-1">|</span> Buy: ৳${s.buying}</div>
          </td>
          <td class="p-4 font-black text-sm text-indigo-700">৳ ${g}</td>
          <td class="p-4 text-xs text-slate-600 leading-relaxed font-medium">${s.desc || ''}</td>
          <td class="p-4 text-center no-print">
            <button onclick="deleteProduct(event, ${pId})" class="text-rose-400 hover:text-white bg-rose-50 hover:bg-rose-500 p-2 transition-colors rounded-lg shadow-sm border border-rose-100 hover:border-rose-500" title="Delete Product Completely">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  let totalMonthlyQty = 0;
  let totalMonthlyGross = 0;
  activeFilteredSales.forEach(s => {
    const pId = s.productId || (s.id ? s.id.split('_')[1] : null);
    const prod = products.find(p => String(p.id) === String(pId));
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

// TAB 4: MULTI-DATE RANGE INDIVIDUAL DAILY REPORTS (ADMIN ONLY)
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

  // Generate list of dates from startDate to endDate
  let cur = new Date(startDate);
  let datesList = [];
  while (cur <= endDate) {
    datesList.push(formatDateString(cur));
    cur.setDate(cur.getDate() + 1);
  }

  datesList.forEach(dStr => {
    const dateObj = new Date(dStr + 'T00:00:00');
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
    
    // Find all sales recorded for this day
    const daySales = sales.filter(s => s.date === dStr);
    
    let dayQty = 0;
    let dayGrossProfit = 0;
    let itemsList = [];

    // Check every sale entry recorded for this date
    daySales.forEach(s => {
      const q = getRecordQty(s);
      if (q > 0) {
        let pId = String(s.productId || (s.id ? s.id.split('_')[1] : ''));
        const prod = products.find(p => String(p.id) === pId) || {
          id: pId,
          image: s.image || '',
          selling: s.selling || 0,
          buying: s.buying || 0,
          desc: s.desc || ''
        };
        const itemProfit = getRecordGross(s, prod);

        dayQty += q;
        dayGrossProfit += itemProfit;
        itemsList.push({
          product: prod,
          qty: q,
          gross: itemProfit
        });
      }
    });

    const dayCost = parseFloat(dailyCosts[dStr]) || 0;
    const dayNetProfit = dayGrossProfit - dayCost;

    if (showFilter === 'sales_only' && dayQty === 0 && dayCost === 0) {
      return; // Skip days with no activity
    }

    totalDaysCount++;
    rangeTotalQty += dayQty;
    rangeTotalGross += dayGrossProfit;
    rangeTotalCost += dayCost;

    const itemsTableRows = itemsList.length > 0 ? itemsList.map((item, idx) => `
      <tr class="border-b border-slate-100 text-[10px]">
        <td class="p-1 text-center text-slate-400 font-bold">${idx + 1}</td>
        <td class="p-1"><img src="${item.product.image}" class="report-table-img shadow-xs"></td>
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

function printRangeReports() {
  if (getCurrentUserRole() !== 'admin') {
    return alert('Access Denied: Printing reports is restricted to Admin.');
  }
  switchTab('reports');
  setTimeout(() => {
    window.print();
  }, 200);
}

function renderGrandTotalView() {
  if (getCurrentUserRole() !== 'admin') return;

  let productStats = {};

  // 1. Initialize stats object for active catalog products
  products.forEach(p => {
    productStats[String(p.id)] = {
      id: p.id,
      image: p.image,
      selling: p.selling,
      buying: p.buying,
      desc: p.desc,
      lifetimeQty: 0,
      lifetimeGross: 0
    };
  });

  // 2. Aggregate sales quantities into corresponding product stats across all-time records
  sales.forEach(s => {
    const q = getRecordQty(s);
    if (q <= 0) return;

    let pId = String(s.productId || (s.id ? s.id.split('_')[1] : ''));
    const prod = products.find(p => String(p.id) === pId);
    const g = getRecordGross(s, prod);

    if (pId) {
      if (!productStats[pId]) {
        productStats[pId] = {
          id: pId,
          image: s.image || '',
          selling: s.selling || 0,
          buying: s.buying || 0,
          desc: s.desc || '',
          lifetimeQty: 0,
          lifetimeGross: 0
        };
      }
      productStats[pId].lifetimeQty += q;
      productStats[pId].lifetimeGross += g;
    }
  });

  // 3. Compute Grand Totals directly from aggregated productStats
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

  // 4. Update the Grand Total summary cards
  const elGQty = document.getElementById('g-stat-qty');
  const elGGross = document.getElementById('g-stat-gross');
  const elGCost = document.getElementById('g-stat-costing');
  const elGNet = document.getElementById('g-stat-net');

  if (elGQty) elGQty.innerText = `${grandQty} Pcs`;
  if (elGGross) elGGross.innerText = `৳ ${grandGross}`;
  if (elGCost) elGCost.innerText = `৳ ${grandCosting}`;
  if (elGNet) elGNet.innerText = `৳ ${grandGross - grandCosting}`;

  // 5. Render the Lifetime Product Sales Breakdown table
  const tbody = document.getElementById('tbody-grand-total-sales');
  if (!tbody) return;

  let soldProducts = Object.values(productStats).filter(p => p.lifetimeQty > 0);
  soldProducts.sort((a, b) => b.lifetimeQty - a.lifetimeQty);

  if (soldProducts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400 text-xs font-semibold">No lifetime sales records found.</td></tr>`;
  } else {
    tbody.innerHTML = soldProducts.map((p, idx) => `
      <tr class="hover:bg-slate-100/50 transition-colors border-b border-slate-50">
        <td class="p-4 text-center font-bold text-slate-400">${idx + 1}</td>
        <td class="p-4"><img src="${p.image}" class="img-compact shadow-sm border-slate-100"></td>
        <td class="p-4">
          <div class="text-sm font-black text-amber-600 bg-amber-50 px-2 py-1 inline-block rounded border border-amber-100 mb-1">Total Sold: ${p.lifetimeQty} Pcs</div>
          <div class="text-[11px] text-slate-500 mt-1 font-semibold">Sell: ৳${p.selling} <span class="text-slate-300 mx-1">|</span> Buy: ৳${p.buying}</div>
        </td>
        <td class="p-4 font-black text-base text-emerald-600">৳ ${p.lifetimeGross}</td>
        <td class="p-4 text-xs text-slate-600 font-medium">${p.desc || ''}</td>
      </tr>
    `).join('');
  }
}

function filterDailyTableByPrice() {
  const searchValue = document.getElementById('input-price-search').value.trim();
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

// Event listeners
document.getElementById('input-sale-date').addEventListener('change', () => {
  const selectedDate = document.getElementById('input-sale-date').value;
  const costInput = document.getElementById('input-daily-costing');
  if (costInput) {
    costInput.value = dailyCosts[selectedDate] || 0;
  }
  renderProductSelector();
  renderDailyView();
});

const dailyCostingInput = document.getElementById('input-daily-costing');
if (dailyCostingInput) {
  dailyCostingInput.addEventListener('input', (e) => {
    if (getCurrentUserRole() !== 'admin') return;
    const selectedDate = document.getElementById('input-sale-date').value || todayStr;
    const val = parseFloat(e.target.value) || 0;
    db.ref('dailyCosts/' + selectedDate).set(val);
  });
}

const monthlyFilterInput = document.getElementById('input-monthly-filter');
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
  monthlyCostEditInput.addEventListener('input', (e) => {
    if (getCurrentUserRole() !== 'admin') return;
    const targetDate = document.getElementById('input-monthly-date-filter').value;
    if (!targetDate) return;
    const val = parseFloat(e.target.value) || 0;
    db.ref('dailyCosts/' + targetDate).set(val);
  });
}
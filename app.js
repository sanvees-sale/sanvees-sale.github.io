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

// AUTH LOGIN SYSTEM
document.getElementById('form-login').addEventListener('submit', (e) => {
  e.preventDefault();
  const user = document.getElementById('login-username').value;
  const pass = document.getElementById('login-password').value;

  if (user === 'admin' && pass === 'project420') {
    sessionStorage.setItem('isLoggedIn', 'true');
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
    initCloudSync();
  } else {
    document.getElementById('login-modal').classList.remove('hidden');
    document.getElementById('app-content').classList.add('hidden');
  }
}

function handleLogout() {
  sessionStorage.removeItem('isLoggedIn');
  checkAuth();
}

checkAuth();

function initCloudSync() {
  db.ref('products').on('value', snap => {
    const data = snap.val();
    products = data ? Object.values(data) : [];
    renderProductSelector();
    renderDailyView();
    renderMonthlyView();
    renderGrandTotalView();
  });

  db.ref('sales').on('value', snap => {
    const data = snap.val();
    sales = data ? Object.values(data) : [];
    renderDailyView();
    renderMonthlyView();
    renderGrandTotalView();
    if(selectedProdId) {
      selectProductCard(selectedProdId);
    }
  });

  db.ref('dailyCosts').on('value', snap => {
    dailyCosts = snap.val() || {};
    const selectedDate = document.getElementById('input-sale-date').value || getTodayString();
    document.getElementById('input-daily-costing').value = dailyCosts[selectedDate] || 0;
    
    const mDateFilter = document.getElementById('input-monthly-date-filter').value;
    if (mDateFilter) {
      document.getElementById('input-monthly-cost-edit').value = dailyCosts[mDateFilter] || 0;
    }

    renderDailyView();
    renderMonthlyView();
    renderGrandTotalView();
  });
}

function getTodayString() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

const todayStr = getTodayString();
document.getElementById('input-sale-date').value = todayStr;
document.getElementById('input-monthly-filter').value = todayStr.substring(0, 7);

function switchTab(tab) {
  const dailyBtn = document.getElementById('tab-daily-btn');
  const monthlyBtn = document.getElementById('tab-monthly-btn');
  const totalBtn = document.getElementById('tab-total-btn');
  const dailySec = document.getElementById('tab-daily');
  const monthlySec = document.getElementById('tab-monthly');
  const totalSec = document.getElementById('tab-total');

  dailySec.classList.add('hidden');
  monthlySec.classList.add('hidden');
  totalSec.classList.add('hidden');
  
  // Re-trigger animation
  dailySec.classList.remove('fade-in');
  monthlySec.classList.remove('fade-in');
  totalSec.classList.remove('fade-in');
  void dailySec.offsetWidth; // trigger reflow
  
  dailyBtn.className = "flex-1 py-3 text-center border-b-2 border-transparent text-slate-400 hover:text-white hover:bg-slate-800/30 flex justify-center items-center gap-2 transition-colors";
  monthlyBtn.className = "flex-1 py-3 text-center border-b-2 border-transparent text-slate-400 hover:text-white hover:bg-slate-800/30 flex justify-center items-center gap-2 transition-colors";
  totalBtn.className = "flex-1 py-3 text-center border-b-2 border-transparent text-slate-400 hover:text-white hover:bg-slate-800/30 flex justify-center items-center gap-2 transition-colors";

  if (tab === 'daily') {
    dailySec.classList.remove('hidden');
    dailySec.classList.add('fade-in');
    dailyBtn.className = "flex-1 py-3 text-center border-b-2 border-amber-500 text-amber-400 bg-slate-900/60 font-bold flex justify-center items-center gap-2 transition-colors";
  } else if (tab === 'monthly') {
    monthlySec.classList.remove('hidden');
    monthlySec.classList.add('fade-in');
    monthlyBtn.className = "flex-1 py-3 text-center border-b-2 border-amber-500 text-amber-400 bg-slate-900/60 font-bold flex justify-center items-center gap-2 transition-colors";
  } else if (tab === 'total') {
    totalSec.classList.remove('hidden');
    totalSec.classList.add('fade-in');
    totalBtn.className = "flex-1 py-3 text-center border-b-2 border-amber-500 text-amber-400 bg-slate-900/60 font-bold flex justify-center items-center gap-2 transition-colors";
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
  if (selectedProdId && form && !form.contains(e.target) && (!editModal || !editModal.contains(e.target))) {
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
  if (undoStack.length === 0) {
    alert('Undo করার মতো কোনো ডাটা হিস্ট্রি নেই!');
    return;
  }
  const lastState = undoStack.pop();
  lastState.salesSnapshot.forEach(s => {
    db.ref('sales/' + s.id).set(s);
  });
  renderDailyView();
  renderMonthlyView();
  renderGrandTotalView();
}

document.addEventListener('click', (e) => {
  const form = document.getElementById('form-sale-entry');
  const editModal = document.getElementById('edit-product-modal');
  if (selectedProdId && form && !form.contains(e.target) && (!editModal || !editModal.contains(e.target))) {
    clearProductSelection();
  }
});

function saveTodayToMonthly() {
  const date = document.getElementById('input-sale-date').value || todayStr;
  const todaysSales = sales.filter(s => s.date === date);

  if (todaysSales.length === 0) {
    return alert('আজকের ডেটে সেভ করার মতো কোনো সেলের ডাটা নেই!');
  }

  let updates = {};
  todaysSales.forEach(s => {
    updates[`sales/${s.id}/monthlyQty`] = s.qty;
    updates[`sales/${s.id}/monthlyGrossProfit`] = s.grossProfit;
  });

  db.ref().update(updates).then(() => {
    alert(`✅ ${date} তারিখের ডাটা সফলভাবে Monthly Report এ সেভ করা হয়েছে!`);
    renderMonthlyView();
    renderGrandTotalView();
  });
}

function resetDayWiseData() {
  const targetDate = document.getElementById('input-monthly-date-filter').value;
  if (!targetDate) {
    return alert('অনুগ্রহ করে প্রথমে "Specific Date Filter"-এ তারিখ নির্বাচন করুন যেটির ডাটা আপনি ০ (Zero) করতে চান!');
  }

  if (!confirm(`${targetDate} তারিখের সেভ হওয়া মান্থলি রিপোর্ট ডাটা রিসেট করে ০ (Zero) করতে চান?`)) return;

  const daySales = sales.filter(s => s.date === targetDate);
  let updates = {};
  daySales.forEach(s => {
    updates[`sales/${s.id}/monthlyQty`] = 0;
    updates[`sales/${s.id}/monthlyGrossProfit`] = 0;
  });

  db.ref().update(updates).then(() => {
    alert(`✅ ${targetDate} তারিখের সেভ ডাটা সফলভাবে ০ (Zero) করা হয়েছে!`);
    renderMonthlyView();
    renderGrandTotalView();
  });
}

function clearDateFilter() {
  document.getElementById('input-monthly-date-filter').value = '';
  document.getElementById('input-monthly-cost-edit').value = '';
  renderMonthlyView();
}

function clearTodaySale() {
  const date = document.getElementById('input-sale-date').value || todayStr;
  const todaysSales = sales.filter(s => s.date === date);
  if (todaysSales.length === 0) return alert('আজকের কোনো সেলের ডাটা নেই!');

  if (confirm('আজকের ডেলি সেলের হিসাব 0 করতে চান?')) {
    saveUndoSnapshot(date);
    todaysSales.forEach(s => {
      db.ref('sales/' + s.id).update({
        qty: 0,
        grossProfit: 0
      });
    });
  }
}

document.getElementById('form-add-product').addEventListener('submit', (e) => {
  e.preventDefault();
  const file = document.getElementById('input-prod-file').files[0];
  if(!file) return alert('Select image');

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
  };
  reader.readAsDataURL(file);
});

document.getElementById('form-sale-entry').addEventListener('submit', (e) => {
  e.preventDefault();
  const qty = parseInt(document.getElementById('input-sale-qty').value);
  if(isNaN(qty) || qty < 0) return alert('Please enter a valid quantity');
  const date = document.getElementById('input-sale-date').value || todayStr;

  if (!selectedProdId) {
    return alert('Please select a product picture first.');
  }

  const prod = products.find(p => p.id === selectedProdId);
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
  const prod = products.find(p => p.id === prodId);
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
  const existingSale = sales.find(s => s.date === date && String(s.productId) === String(id));
  const qtyInput = document.getElementById('input-sale-qty');
  const btnSubmit = document.getElementById('btn-sale-submit');

  if(existingSale) {
    qtyInput.value = existingSale.qty;
    btnSubmit.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Update Sale Qty (${existingSale.qty} Pcs)`;
  } else {
    qtyInput.value = 1;
    btnSubmit.innerHTML = `<i class="fa-solid fa-plus"></i> Add / Update Sale Entry`;
  }
}
function deleteProduct(e, id) {
  if (e) e.stopPropagation();
  if(!confirm('এই প্রোডাক্টটি ক্যাটালগ এবং সকল সেলস হিস্ট্রি থেকে সম্পূর্ণ ডিলিট করে দিতে চান?')) return;
  
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

  if (products.length === 0) {
    grid.innerHTML = `<p class="col-span-full text-[11px] text-slate-400 text-center py-4 font-semibold">No products uploaded yet.</p>`;
    return;
  }

  grid.innerHTML = products.map(p => {
    const todayQty = sales
      .filter(s => s.date === date && String(s.productId) === String(p.id))
      .reduce((sum, item) => sum + item.qty, 0);

    const isSelected = String(selectedProdId) === String(p.id);
    const selectedClass = isSelected ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-400' : 'border-slate-100 bg-white';
    
    const overlayVisibility = isSelected 
      ? 'opacity-100 pointer-events-auto' 
      : 'opacity-0 group-hover:opacity-100 pointer-events-auto';

    return `
      <div onclick="selectProductCard('${p.id}')" id="prod-card-${p.id}" class="prod-select-card relative cursor-pointer border rounded-xl p-1.5 flex flex-col items-center transition-all hover:border-amber-400 hover:shadow-md shadow-sm ${selectedClass} group">
        <img src="${p.image}" class="img-selector object-cover rounded-lg border border-slate-100">
        <span class="text-[10px] font-black text-slate-800 mt-1.5">৳${p.selling}</span>
        ${todayQty > 0 ? `<span class="absolute top-1 left-1 bg-amber-500 text-slate-900 font-black text-[9px] px-1.5 py-0.5 rounded-md shadow">${todayQty}</span>` : ''}
        
        <!-- Edit & Delete Overlay -->
        <div class="absolute top-1 right-1 flex flex-col gap-1 transition-opacity duration-200 z-50 ${overlayVisibility}">
           <button type="button" onclick="event.stopPropagation(); openEditModal(event, '${p.id}')" class="bg-blue-500/95 text-white p-1.5 rounded hover:bg-blue-600 shadow-md backdrop-blur-sm cursor-pointer" title="Edit Product"><i class="fa-solid fa-pen text-[10px]"></i></button>
           <button type="button" onclick="event.stopPropagation(); deleteProduct(event, '${p.id}')" class="bg-rose-500/95 text-white p-1.5 rounded hover:bg-rose-600 shadow-md backdrop-blur-sm cursor-pointer" title="Delete Product"><i class="fa-solid fa-trash text-[10px]"></i></button>
        </div>
      </div>
    `;
  }).join('');
}

function openEditModal(e, id) {
  if (e) e.stopPropagation(); 
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

  const tbody = document.getElementById('tbody-daily-sales');
  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 text-xs font-semibold">No products added yet.</td></tr>`;
  } else {
    let totalQty = 0;
    let totalGrossProfit = 0;

    tbody.innerHTML = products.map((p, idx) => {
      const s = sales.find(item => item.date === date && item.productId === p.id);
      const qty = s ? s.qty : 0;
      const grossProfit = s ? s.grossProfit : 0;

      totalQty += qty;
      totalGrossProfit += grossProfit;

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
            <div class="text-[11px] font-semibold text-slate-600 flex gap-1.5 items-center">
              <span class="bg-amber-100/80 text-amber-900 px-2 py-0.5 rounded shadow-sm border border-amber-200 font-bold">Sell: ৳${p.selling}</span>
              <span class="text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">Buy: ৳${p.buying}</span>
            </div>
          </td>
          <td class="p-4 font-black text-sm text-slate-800">৳ ${grossProfit}</td>
          <td class="p-4 text-xs text-slate-600 leading-relaxed font-medium">${p.desc || ''}</td>
          <td class="p-4 text-center no-print">
            <button onclick="deleteProduct(event, ${p.id})" class="text-rose-400 hover:text-white bg-rose-50 hover:bg-rose-500 p-2 transition-colors rounded-lg shadow-sm border border-rose-100 hover:border-rose-500" title="Delete Product"><i class="fa-solid fa-trash-can"></i></button>
          </td>
        </tr>
      `;
    }).join('');

    const costing = parseFloat(document.getElementById('input-daily-costing').value) || 0;
    const perProdCost = totalQty > 0 ? (costing / totalQty).toFixed(2) : 0;
    const totalProfit = totalGrossProfit - costing;

    document.getElementById('summary-qty').innerText = `${totalQty} Pcs`;
    document.getElementById('summary-gross-profit').innerText = `৳ ${totalGrossProfit}`;
    document.getElementById('summary-costing').innerText = `৳ ${costing}`;
    document.getElementById('summary-per-product-cost').innerText = `৳ ${perProdCost}`;
    document.getElementById('summary-total-profit').innerText = `৳ ${totalProfit}`;
  }

  filterDailyTableByPrice();
}

function renderMonthlyView() {
  const monthFilter = document.getElementById('input-monthly-filter').value;
  const dateFilter = document.getElementById('input-monthly-date-filter').value;

  let filteredSales = sales.filter(s => s.date && s.date.startsWith(monthFilter));
  if (dateFilter) {
    filteredSales = filteredSales.filter(s => s.date === dateFilter);
  }

  const tbody = document.getElementById('tbody-monthly-sales');
  if (filteredSales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-xs font-semibold">No monthly records found for selected filter.</td></tr>`;
  } else {
    tbody.innerHTML = filteredSales.map((s, idx) => {
      const pId = s.productId || (s.id ? s.id.split('_')[1] : null);
      return `
        <tr class="hover:bg-slate-100/50 transition-colors border-b border-slate-50">
          <td class="p-4 text-center font-bold text-slate-400">${idx + 1}</td>
          <td class="p-4 font-extrabold text-slate-700 bg-slate-50/50">${s.date}</td>
          <td class="p-4"><img src="${s.image}" class="img-compact shadow-sm border-slate-100"></td>
          <td class="p-4">
            <div class="text-xs font-black text-slate-800 bg-slate-100 px-2 py-1 rounded inline-block mb-1">Qty: ${s.monthlyQty !== undefined ? s.monthlyQty : s.qty} Pcs</div>
            <div class="text-[11px] text-slate-500 mt-1 font-semibold">Sell: ৳${s.selling} <span class="text-slate-300 mx-1">|</span> Buy: ৳${s.buying}</div>
          </td>
          <td class="p-4 font-black text-sm text-indigo-700">৳ ${s.monthlyGrossProfit !== undefined ? s.monthlyGrossProfit : s.grossProfit}</td>
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
  filteredSales.forEach(s => {
    totalMonthlyQty += (s.monthlyQty !== undefined ? s.monthlyQty : s.qty);
    totalMonthlyGross += (s.monthlyGrossProfit !== undefined ? s.monthlyGrossProfit : s.grossProfit);
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

  document.getElementById('m-stat-qty').innerText = `${totalMonthlyQty} Pcs`;
  document.getElementById('m-stat-gross').innerText = `৳ ${totalMonthlyGross}`;
  document.getElementById('m-stat-costing').innerText = `৳ ${totalMonthlyCosting}`;
  document.getElementById('m-stat-net').innerText = `৳ ${totalMonthlyGross - totalMonthlyCosting}`;
}

function renderGrandTotalView() {
  let grandQty = 0;
  let grandGross = 0;
  let productStats = {};

  products.forEach(p => {
    productStats[p.id] = {
      id: p.id,
      image: p.image,
      selling: p.selling,
      buying: p.buying,
      desc: p.desc,
      lifetimeQty: 0,
      lifetimeGross: 0
    };
  });

  sales.forEach(s => {
    let q = (s.monthlyQty !== undefined ? s.monthlyQty : s.qty) || 0;
    let g = (s.monthlyGrossProfit !== undefined ? s.monthlyGrossProfit : s.grossProfit) || 0;
    
    grandQty += q;
    grandGross += g;

    let pId = s.productId || (s.id ? s.id.split('_')[1] : null);
    if (pId && productStats[pId]) {
      productStats[pId].lifetimeQty += q;
      productStats[pId].lifetimeGross += g;
    }
  });

  let grandCosting = 0;
  Object.values(dailyCosts).forEach(c => {
    grandCosting += parseFloat(c) || 0;
  });

  document.getElementById('g-stat-qty').innerText = `${grandQty} Pcs`;
  document.getElementById('g-stat-gross').innerText = `৳ ${grandGross}`;
  document.getElementById('g-stat-costing').innerText = `৳ ${grandCosting}`;
  document.getElementById('g-stat-net').innerText = `৳ ${grandGross - grandCosting}`;

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
  document.getElementById('input-daily-costing').value = dailyCosts[selectedDate] || 0;
  renderProductSelector();
  renderDailyView();
});

document.getElementById('input-daily-costing').addEventListener('input', (e) => {
  const selectedDate = document.getElementById('input-sale-date').value || todayStr;
  const val = parseFloat(e.target.value) || 0;
  db.ref('dailyCosts/' + selectedDate).set(val);
});

document.getElementById('input-monthly-filter').addEventListener('change', renderMonthlyView);
document.getElementById('input-monthly-date-filter').addEventListener('change', (e) => {
  const dateVal = e.target.value;
  if (dateVal) {
    document.getElementById('input-monthly-cost-edit').value = dailyCosts[dateVal] || 0;
  } else {
    document.getElementById('input-monthly-cost-edit').value = '';
  }
  renderMonthlyView();
});

document.getElementById('input-monthly-cost-edit').addEventListener('input', (e) => {
  const targetDate = document.getElementById('input-monthly-date-filter').value;
  if (!targetDate) return;
  const val = parseFloat(e.target.value) || 0;
  db.ref('dailyCosts/' + targetDate).set(val);
});
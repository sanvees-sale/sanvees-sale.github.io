/**
 * ==========================================================================
 * SANVEE POS & PROFIT TRACKER - GOOGLE SHEETS DATABASE BACKEND
 * ==========================================================================
 * This Google Apps Script acts as the API backend for Sanvee POS.
 * It automatically initializes the sheets, handles CRUD operations,
 * stores product images, and provides high-speed JSON synchronization.
 * 
 * HOW TO DEPLOY:
 * 1. Open your Google Sheet -> Click Extensions -> Apps Script
 * 2. Delete any existing code and paste this entire file
 * 3. Click "Deploy" (top right) -> "New deployment"
 * 4. Select type: "Web app"
 * 5. Description: "Sanvee POS API"
 * 6. Execute as: "Me" (your email)
 * 7. Who has access: "Anyone"
 * 8. Click "Deploy", authorize permissions, and copy the "Web app URL"
 * 9. Paste the URL into the Sanvee POS website settings!
 * ==========================================================================
 */

// Global Sheet Names
var SHEET_PRODUCTS = "Products";
var SHEET_SALES = "Sales";
var SHEET_COSTS = "DailyCosts";
var SHEET_AUTH = "SystemAuth";

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Initializes all required sheets and column headers if they do not exist.
 */
function initDatabase() {
  var ss = getSpreadsheet();
  
  // 1. Products Sheet
  var prodSheet = ss.getSheetByName(SHEET_PRODUCTS);
  if (!prodSheet) {
    prodSheet = ss.insertSheet(SHEET_PRODUCTS);
    prodSheet.appendRow(["id", "image", "buying", "selling", "grossProfitUnit", "desc", "updatedAt"]);
    prodSheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#fef3c7");
  }

  // 2. Sales Sheet
  var salesSheet = ss.getSheetByName(SHEET_SALES);
  if (!salesSheet) {
    salesSheet = ss.insertSheet(SHEET_SALES);
    salesSheet.appendRow(["id", "productId", "date", "qty", "grossProfit", "monthlyQty", "monthlyGrossProfit", "desc", "selling", "buying", "image", "updatedAt"]);
    salesSheet.getRange(1, 1, 1, 12).setFontWeight("bold").setBackground("#e0e7ff");
  }

  // 3. DailyCosts Sheet
  var costsSheet = ss.getSheetByName(SHEET_COSTS);
  if (!costsSheet) {
    costsSheet = ss.insertSheet(SHEET_COSTS);
    costsSheet.appendRow(["date", "cost", "updatedAt"]);
    costsSheet.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#fee2e2");
  }

  // 4. SystemAuth Sheet
  var authSheet = ss.getSheetByName(SHEET_AUTH);
  if (!authSheet) {
    authSheet = ss.insertSheet(SHEET_AUTH);
    authSheet.appendRow(["role", "password", "updatedAt"]);
    authSheet.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#dcfce7");
    authSheet.appendRow(["admin", "project420", new Date().toISOString()]);
    authSheet.appendRow(["staff", "staff123", new Date().toISOString()]);
  }
}

/**
 * Handles HTTP GET requests
 */
function doGet(e) {
  try {
    initDatabase();
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "getAll";
    
    if (action === "ping") {
      return createJsonResponse({ status: "success", message: "Sanvee POS Google Sheet Connected Successfully!" });
    }
    
    if (action === "getAll") {
      return createJsonResponse(fetchAllData());
    }

    return createJsonResponse({ status: "error", message: "Invalid action: " + action });
  } catch (err) {
    return createJsonResponse({ status: "error", message: err.toString() });
  }
}

/**
 * Handles HTTP POST requests
 */
function doPost(e) {
  try {
    initDatabase();
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
    
    var action = payload.action || (e && e.parameter && e.parameter.action);
    var data = payload.data || {};

    switch (action) {
      case "ping":
        return createJsonResponse({ status: "success", message: "Sanvee POS Google Sheet Connected Successfully!" });

      case "getAll":
        return createJsonResponse(fetchAllData());

      case "addProduct":
        return createJsonResponse(addProduct(data));

      case "updateProduct":
        return createJsonResponse(updateProduct(data));

      case "deleteProduct":
        return createJsonResponse(deleteProduct(data.id));

      case "saveSale":
        return createJsonResponse(saveSale(data));

      case "batchUpdateSales":
        return createJsonResponse(batchUpdateSales(data.sales || []));

      case "batchUpdateProducts":
        return createJsonResponse(batchUpdateProducts(data.products || []));

      case "batchSyncAll":
        return createJsonResponse(batchSyncAll(data));

      case "setDailyCost":
        return createJsonResponse(setDailyCost(data.date, data.cost));

      case "updateAuth":
        return createJsonResponse(updateAuth(data.admin, data.staff));

      case "restoreDatabase":
        return createJsonResponse(restoreDatabase(data));

      default:
        return createJsonResponse({ status: "error", message: "Unknown action: " + action });
    }
  } catch (err) {
    return createJsonResponse({ status: "error", message: err.toString() });
  }
}

/**
 * Returns all database tables in a single JSON payload
 */
function fetchAllData() {
  var ss = getSpreadsheet();
  
  // 1. Products
  var prodSheet = ss.getSheetByName(SHEET_PRODUCTS);
  var prodValues = prodSheet.getDataRange().getValues();
  var products = [];
  if (prodValues.length > 1) {
    for (var i = 1; i < prodValues.length; i++) {
      var row = prodValues[i];
      if (row[0]) {
        products.push({
          id: row[0],
          image: row[1] || "",
          buying: Number(row[2]) || 0,
          selling: Number(row[3]) || 0,
          grossProfitUnit: Number(row[4]) || (Number(row[3]) - Number(row[2])),
          desc: row[5] || ""
        });
      }
    }
  }

  // 2. Sales
  var salesSheet = ss.getSheetByName(SHEET_SALES);
  var salesValues = salesSheet.getDataRange().getValues();
  var sales = [];
  if (salesValues.length > 1) {
    for (var j = 1; j < salesValues.length; j++) {
      var sRow = salesValues[j];
      if (sRow[0]) {
        sales.push({
          id: String(sRow[0]),
          productId: sRow[1],
          date: sRow[2] instanceof Date ? Utilities.formatDate(sRow[2], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(sRow[2]),
          qty: Number(sRow[3]) || 0,
          grossProfit: Number(sRow[4]) || 0,
          monthlyQty: Number(sRow[5]) || 0,
          monthlyGrossProfit: Number(sRow[6]) || 0,
          desc: sRow[7] || "",
          selling: Number(sRow[8]) || 0,
          buying: Number(sRow[9]) || 0,
          image: sRow[10] || ""
        });
      }
    }
  }

  // 3. Daily Costs
  var costsSheet = ss.getSheetByName(SHEET_COSTS);
  var costValues = costsSheet.getDataRange().getValues();
  var dailyCosts = {};
  if (costValues.length > 1) {
    for (var k = 1; k < costValues.length; k++) {
      var cRow = costValues[k];
      if (cRow[0]) {
        var dateKey = cRow[0] instanceof Date ? Utilities.formatDate(cRow[0], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(cRow[0]);
        dailyCosts[dateKey] = Number(cRow[1]) || 0;
      }
    }
  }

  // 4. System Auth
  var authSheet = ss.getSheetByName(SHEET_AUTH);
  var authValues = authSheet.getDataRange().getValues();
  var systemAuth = { admin: "project420", staff: "staff123" };
  if (authValues.length > 1) {
    for (var m = 1; m < authValues.length; m++) {
      var aRow = authValues[m];
      if (aRow[0] === "admin") systemAuth.admin = String(aRow[1]);
      if (aRow[0] === "staff") systemAuth.staff = String(aRow[1]);
    }
  }

  return {
    status: "success",
    data: {
      products: products,
      sales: sales,
      dailyCosts: dailyCosts,
      systemAuth: systemAuth
    }
  };
}

/**
 * Add a new product
 */
function addProduct(prod) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_PRODUCTS);
  var id = prod.id || Date.now();
  var now = new Date().toISOString();
  
  sheet.appendRow([
    id,
    prod.image || "",
    Number(prod.buying) || 0,
    Number(prod.selling) || 0,
    Number(prod.grossProfitUnit) || (Number(prod.selling) - Number(prod.buying)),
    prod.desc || "",
    now
  ]);
  
  return { status: "success", message: "Product added successfully", id: id };
}

/**
 * Update an existing product
 */
function updateProduct(prod) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_PRODUCTS);
  var values = sheet.getDataRange().getValues();
  var targetId = String(prod.id);
  var found = false;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === targetId) {
      var rowNum = i + 1;
      if (prod.buying !== undefined) sheet.getRange(rowNum, 3).setValue(Number(prod.buying) || 0);
      if (prod.selling !== undefined) sheet.getRange(rowNum, 4).setValue(Number(prod.selling) || 0);
      if (prod.grossProfitUnit !== undefined) {
        sheet.getRange(rowNum, 5).setValue(Number(prod.grossProfitUnit));
      } else if (prod.selling !== undefined && prod.buying !== undefined) {
        sheet.getRange(rowNum, 5).setValue((Number(prod.selling) || 0) - (Number(prod.buying) || 0));
      }
      if (prod.desc !== undefined) sheet.getRange(rowNum, 6).setValue(prod.desc);
      if (prod.image !== undefined && prod.image) sheet.getRange(rowNum, 2).setValue(prod.image);
      sheet.getRange(rowNum, 7).setValue(new Date().toISOString());
      found = true;
      break;
    }
  }

  return found ? { status: "success", message: "Product updated" } : { status: "error", message: "Product not found" };
}

/**
 * Delete a product and its associated sales records
 */
function deleteProduct(prodId) {
  var ss = getSpreadsheet();
  var pSheet = ss.getSheetByName(SHEET_PRODUCTS);
  var pValues = pSheet.getDataRange().getValues();
  var targetId = String(prodId);

  // Delete from Products
  for (var i = pValues.length - 1; i >= 1; i--) {
    if (String(pValues[i][0]) === targetId) {
      pSheet.deleteRow(i + 1);
    }
  }

  // Delete related Sales
  var sSheet = ss.getSheetByName(SHEET_SALES);
  var sValues = sSheet.getDataRange().getValues();
  for (var j = sValues.length - 1; j >= 1; j--) {
    var rowPId = String(sValues[j][1]);
    var sId = String(sValues[j][0]);
    if (rowPId === targetId || sId.indexOf("_" + targetId) !== -1) {
      sSheet.deleteRow(j + 1);
    }
  }

  return { status: "success", message: "Product and related sales deleted" };
}

/**
 * Save or update a single sale record
 */
function saveSale(sale) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SALES);
  var values = sheet.getDataRange().getValues();
  var targetId = String(sale.id);
  var found = false;
  var now = new Date().toISOString();

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === targetId) {
      var rowNum = i + 1;
      sheet.getRange(rowNum, 4).setValue(Number(sale.qty) || 0);
      sheet.getRange(rowNum, 5).setValue(Number(sale.grossProfit) || 0);
      if (sale.monthlyQty !== undefined) sheet.getRange(rowNum, 6).setValue(Number(sale.monthlyQty) || 0);
      if (sale.monthlyGrossProfit !== undefined) sheet.getRange(rowNum, 7).setValue(Number(sale.monthlyGrossProfit) || 0);
      if (sale.desc !== undefined) sheet.getRange(rowNum, 8).setValue(sale.desc);
      if (sale.selling !== undefined) sheet.getRange(rowNum, 9).setValue(Number(sale.selling) || 0);
      if (sale.buying !== undefined) sheet.getRange(rowNum, 10).setValue(Number(sale.buying) || 0);
      if (sale.image) sheet.getRange(rowNum, 11).setValue(sale.image);
      sheet.getRange(rowNum, 12).setValue(now);
      found = true;
      break;
    }
  }

  if (!found) {
    sheet.appendRow([
      targetId,
      sale.productId || "",
      sale.date || "",
      Number(sale.qty) || 0,
      Number(sale.grossProfit) || 0,
      Number(sale.monthlyQty) || 0,
      Number(sale.monthlyGrossProfit) || 0,
      sale.desc || "",
      Number(sale.selling) || 0,
      Number(sale.buying) || 0,
      sale.image || "",
      now
    ]);
  }

  return { status: "success", message: "Sale recorded successfully" };
}

/**
 * Batch update sales (used for save to monthly, resetting date sales, undo, etc.)
 */
function batchUpdateSales(salesList) {
  if (!salesList || salesList.length === 0) {
    return { status: "success", message: "No sales to update" };
  }
  
  for (var i = 0; i < salesList.length; i++) {
    saveSale(salesList[i]);
  }
  
  return { status: "success", message: "Batch sales updated successfully" };
}

/**
 * Batch update products (used for sync from Firebase/Restore)
 */
function batchUpdateProducts(productsList) {
  if (!productsList || productsList.length === 0) {
    return { status: "success", message: "No products to update" };
  }
  for (var i = 0; i < productsList.length; i++) {
    var p = productsList[i];
    if (p) {
      updateProduct(p);
    }
  }
  return { status: "success", message: "Batch products updated successfully" };
}

/**
 * High-speed batch sync of Products, Sales, and DailyCosts into Google Sheets (e.g. from Firebase)
 */
function batchSyncAll(payload) {
  if (!payload) return { status: "error", message: "Empty sync payload" };
  
  var counts = { products: 0, sales: 0, costs: 0 };
  
  // 1. Sync Products
  if (payload.products) {
    var prods = Array.isArray(payload.products) ? payload.products : Object.values(payload.products);
    for (var i = 0; i < prods.length; i++) {
      if (prods[i]) {
        updateProduct(prods[i]);
        counts.products++;
      }
    }
  }
  
  // 2. Sync Sales
  if (payload.sales) {
    var sList = Array.isArray(payload.sales) ? payload.sales : Object.values(payload.sales);
    for (var j = 0; j < sList.length; j++) {
      if (sList[j]) {
        saveSale(sList[j]);
        counts.sales++;
      }
    }
  }
  
  // 3. Sync Daily Costs
  if (payload.dailyCosts) {
    var cObj = payload.dailyCosts;
    var dKeys = Object.keys(cObj);
    for (var k = 0; k < dKeys.length; k++) {
      var d = dKeys[k];
      setDailyCost(d, cObj[d]);
      counts.costs++;
    }
  }
  
  return {
    status: "success",
    message: "Firebase sync completed to Google Sheets",
    counts: counts
  };
}

/**
 * Set daily operational cost
 */
function setDailyCost(date, cost) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_COSTS);
  var values = sheet.getDataRange().getValues();
  var targetDate = String(date);
  var found = false;
  var now = new Date().toISOString();

  for (var i = 1; i < values.length; i++) {
    var rowDate = values[i][0] instanceof Date ? Utilities.formatDate(values[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(values[i][0]);
    if (rowDate === targetDate) {
      sheet.getRange(i + 1, 2).setValue(Number(cost) || 0);
      sheet.getRange(i + 1, 3).setValue(now);
      found = true;
      break;
    }
  }

  if (!found) {
    sheet.appendRow([targetDate, Number(cost) || 0, now]);
  }

  return { status: "success", message: "Daily cost updated" };
}

/**
 * Update Admin and Staff passwords
 */
function updateAuth(adminPass, staffPass) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_AUTH);
  var values = sheet.getDataRange().getValues();
  var now = new Date().toISOString();

  var hasAdmin = false;
  var hasStaff = false;

  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === "admin" && adminPass) {
      sheet.getRange(i + 1, 2).setValue(String(adminPass));
      sheet.getRange(i + 1, 3).setValue(now);
      hasAdmin = true;
    }
    if (values[i][0] === "staff" && staffPass) {
      sheet.getRange(i + 1, 2).setValue(String(staffPass));
      sheet.getRange(i + 1, 3).setValue(now);
      hasStaff = true;
    }
  }

  if (!hasAdmin && adminPass) {
    sheet.appendRow(["admin", String(adminPass), now]);
  }
  if (!hasStaff && staffPass) {
    sheet.appendRow(["staff", String(staffPass), now]);
  }

  return { status: "success", message: "Passwords updated in Google Sheet" };
}

/**
 * Restore complete database from backup payload
 */
function restoreDatabase(payload) {
  var ss = getSpreadsheet();
  var now = new Date().toISOString();

  // 1. Restore Products
  if (payload.products) {
    var pSheet = ss.getSheetByName(SHEET_PRODUCTS);
    if (pSheet) ss.deleteSheet(pSheet);
    pSheet = ss.insertSheet(SHEET_PRODUCTS);
    pSheet.appendRow(["id", "image", "buying", "selling", "grossProfitUnit", "desc", "updatedAt"]);
    pSheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#fef3c7");

    var prods = Array.isArray(payload.products) ? payload.products : Object.values(payload.products);
    if (prods.length > 0) {
      var prodRows = [];
      for (var i = 0; i < prods.length; i++) {
        var p = prods[i];
        prodRows.push([
          p.id || Date.now() + i,
          p.image || "",
          Number(p.buying) || 0,
          Number(p.selling) || 0,
          Number(p.grossProfitUnit) || (Number(p.selling) - Number(p.buying)),
          p.desc || "",
          now
        ]);
      }
      pSheet.getRange(2, 1, prodRows.length, 7).setValues(prodRows);
    }
  }

  // 2. Restore Sales
  if (payload.sales) {
    var sSheet = ss.getSheetByName(SHEET_SALES);
    if (sSheet) ss.deleteSheet(sSheet);
    sSheet = ss.insertSheet(SHEET_SALES);
    sSheet.appendRow(["id", "productId", "date", "qty", "grossProfit", "monthlyQty", "monthlyGrossProfit", "desc", "selling", "buying", "image", "updatedAt"]);
    sSheet.getRange(1, 1, 1, 12).setFontWeight("bold").setBackground("#e0e7ff");

    var salesList = Array.isArray(payload.sales) ? payload.sales : Object.values(payload.sales);
    if (salesList.length > 0) {
      var salesRows = [];
      for (var j = 0; j < salesList.length; j++) {
        var s = salesList[j];
        salesRows.push([
          String(s.id || ""),
          s.productId || "",
          s.date || "",
          Number(s.qty) || 0,
          Number(s.grossProfit) || 0,
          Number(s.monthlyQty) || 0,
          Number(s.monthlyGrossProfit) || 0,
          s.desc || "",
          Number(s.selling) || 0,
          Number(s.buying) || 0,
          s.image || "",
          now
        ]);
      }
      sSheet.getRange(2, 1, salesRows.length, 12).setValues(salesRows);
    }
  }

  // 3. Restore DailyCosts
  if (payload.dailyCosts) {
    var cSheet = ss.getSheetByName(SHEET_COSTS);
    if (cSheet) ss.deleteSheet(cSheet);
    cSheet = ss.insertSheet(SHEET_COSTS);
    cSheet.appendRow(["date", "cost", "updatedAt"]);
    cSheet.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#fee2e2");

    var costObj = payload.dailyCosts;
    var dates = Object.keys(costObj);
    if (dates.length > 0) {
      var costRows = [];
      for (var k = 0; k < dates.length; k++) {
        var d = dates[k];
        costRows.push([d, Number(costObj[d]) || 0, now]);
      }
      cSheet.getRange(2, 1, costRows.length, 3).setValues(costRows);
    }
  }

  // 4. Restore SystemAuth
  if (payload.systemAuth) {
    var aSheet = ss.getSheetByName(SHEET_AUTH);
    if (aSheet) ss.deleteSheet(aSheet);
    aSheet = ss.insertSheet(SHEET_AUTH);
    aSheet.appendRow(["role", "password", "updatedAt"]);
    aSheet.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#dcfce7");

    var auth = payload.systemAuth;
    aSheet.appendRow(["admin", auth.admin || "project420", now]);
    aSheet.appendRow(["staff", auth.staff || "staff123", now]);
  }

  return { status: "success", message: "Database restored completely to Google Sheets" };
}

/**
 * Creates formatted JSON response with CORS headers
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

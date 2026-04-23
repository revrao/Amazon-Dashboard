let orders = [];
let orderItems = [];
let products = [];
let trendChartInstance = null;
let categoryChartInstance = null;

document.getElementById("loadSampleBtn").addEventListener("click", async () => {
  orders = await loadCSVFromPath("data/orders.csv");
  orderItems = await loadCSVFromPath("data/order_items.csv");
  products = await loadCSVFromPath("data/products.csv");
  buildDashboard();
});

document.getElementById("ordersFile").addEventListener("change", (e) => {
  handleFileUpload(e.target.files[0], (data) => orders = data);
});

document.getElementById("itemsFile").addEventListener("change", (e) => {
  handleFileUpload(e.target.files[0], (data) => orderItems = data);
});

document.getElementById("productsFile").addEventListener("change", (e) => {
  handleFileUpload(e.target.files[0], (data) => products = data);
});

["metricType", "timeGranularity", "dateColumn"].forEach(id => {
  document.getElementById(id).addEventListener("change", () => {
    if (orders.length && orderItems.length && products.length) buildDashboard();
  });
});

function handleFileUpload(file, setter) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      setter(results.data);
      if (orders.length && orderItems.length && products.length) buildDashboard();
    }
  });
}

async function loadCSVFromPath(path) {
  const response = await fetch(path);
  const text = await response.text();
  return new Promise((resolve) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data)
    });
  });
}

function buildDashboard() {
  updateKPIs();
  drawTrendChart();
  drawCategoryChart();
  drawHeatmap();
}

function updateKPIs() {
  const lateDeliveries = orders.filter(o => {
    return o.order_delivered_customer_date &&
           o.order_estimated_delivery_date &&
           new Date(o.order_delivered_customer_date) > new Date(o.order_estimated_delivery_date);
  }).length;

  const totalPurchases = orders.length;
  const totalCustomers = new Set(orders.map(o => o.customer_id)).size;

  const totalRevenue = orderItems.reduce((sum, row) => {
    return sum + Number(row.price || 0);
  }, 0);

  document.getElementById("lateDeliveries").textContent = lateDeliveries.toLocaleString();
  document.getElementById("totalPurchases").textContent = totalPurchases.toLocaleString();
  document.getElementById("totalCustomers").textContent = totalCustomers.toLocaleString();
  document.getElementById("totalRevenue").textContent = `$${totalRevenue.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
}

function drawTrendChart() {
  const metric = document.getElementById("metricType").value;
  const granularity = document.getElementById("timeGranularity").value;
  const dateCol = document.getElementById("dateColumn").value;

  const grouped = {};

  orders.forEach(o => {
    if (!o[dateCol]) return;
    const d = new Date(o[dateCol]);
    if (isNaN(d)) return;

    const key = granularity === "monthly"
      ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, "0")}`
      : getWeekKey(d);

    if (!grouped[key]) grouped[key] = 0;

    if (metric === "late_deliveries") {
      if (o.order_delivered_customer_date &&
          o.order_estimated_delivery_date &&
          new Date(o.order_delivered_customer_date) > new Date(o.order_estimated_delivery_date)) {
        grouped[key] += 1;
      }
    } else {
      grouped[key] += 1;
    }
  });

  const labels = Object.keys(grouped).sort();
  const values = labels.map(k => grouped[k]);

  const ctx = document.getElementById("trendChart").getContext("2d");
  if (trendChartInstance) trendChartInstance.destroy();

  trendChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Trend",
        data: values,
        borderWidth: 3,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

function drawCategoryChart() {
  const productMap = {};
  products.forEach(p => {
    productMap[p.product_id] = p.product_category_name || "Unknown";
  });

  const categoryCounts = {};
  orderItems.forEach(item => {
    const cat = productMap[item.product_id] || "Unknown";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  const sorted = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const labels = sorted.map(x => x[0]);
  const values = sorted.map(x => x[1]);

  const ctx = document.getElementById("categoryChart").getContext("2d");
  if (categoryChartInstance) categoryChartInstance.destroy();

  categoryChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Orders",
        data: values,
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

function drawHeatmap() {
  const heatmap = document.getElementById("heatmap");
  heatmap.innerHTML = "";

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const counts = Array.from({ length: 7 }, () => Array(24).fill(0));

  orders.forEach(o => {
    if (!o.order_purchase_timestamp) return;
    const d = new Date(o.order_purchase_timestamp);
    if (isNaN(d)) return;
    counts[d.getDay()][d.getHours()]++;
  });

  heatmap.appendChild(document.createElement("div"));
  for (let h = 0; h < 24; h++) {
    const hour = document.createElement("div");
    hour.textContent = String(h).padStart(2, "0");
    hour.style.fontSize = "12px";
    hour.style.textAlign = "center";
    heatmap.appendChild(hour);
  }

  const maxVal = Math.max(...counts.flat(), 1);

  for (let day = 0; day < 7; day++) {
    const label = document.createElement("div");
    label.textContent = days[day];
    label.style.fontWeight = "bold";
    heatmap.appendChild(label);

    for (let hour = 0; hour < 24; hour++) {
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      const intensity = counts[day][hour] / maxVal;
      cell.style.background = `rgba(88, 80, 236, ${0.08 + intensity * 0.92})`;
      cell.title = `${days[day]} ${hour}:00 — ${counts[day][hour]} orders`;
      heatmap.appendChild(cell);
    }
  }
}

function getWeekKey(date) {
  const temp = new Date(date);
  temp.setHours(0, 0, 0, 0);
  temp.setDate(temp.getDate() - temp.getDay());
  return temp.toISOString().slice(0, 10);
}
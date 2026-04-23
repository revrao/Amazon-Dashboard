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

  // Build order lookup if revenue is needed later
  const orderMap = {};
  orders.forEach(o => {
    orderMap[o.order_id] = o;
  });

  if (metric === "revenue") {
    orderItems.forEach(item => {
      const order = orderMap[item.order_id];
      if (!order || !order[dateCol]) return;

      const d = new Date(order[dateCol]);
      if (isNaN(d)) return;

      const key = granularity === "monthly"
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : getWeekKey(d);

      if (!grouped[key]) grouped[key] = 0;
      grouped[key] += Number(item.price || 0);
    });
  } else {
    orders.forEach(o => {
      if (!o[dateCol]) return;

      const d = new Date(o[dateCol]);
      if (isNaN(d)) return;

      const key = granularity === "monthly"
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : getWeekKey(d);

      if (!grouped[key]) grouped[key] = 0;

      if (metric === "late_deliveries") {
        if (
          o.order_delivered_customer_date &&
          o.order_estimated_delivery_date &&
          new Date(o.order_delivered_customer_date) > new Date(o.order_estimated_delivery_date)
        ) {
          grouped[key] += 1;
        }
      } else if (metric === "orders") {
        grouped[key] += 1;
      }
    });
  }

  const sortedKeys = Object.keys(grouped).sort();
  const labels = sortedKeys.map(k => formatPeriodLabel(k, granularity));
  const values = sortedKeys.map(k => grouped[k]);

  const ctx = document.getElementById("trendChart").getContext("2d");
  if (trendChartInstance) trendChartInstance.destroy();

  trendChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label:
          metric === "revenue"
            ? "Revenue"
            : metric === "orders"
            ? "Orders"
            : "Late Deliveries",
        data: values,
        borderColor: COLORS.purple,
        backgroundColor: COLORS.purpleFill,
        fill: true,
        borderWidth: 3,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: COLORS.purple,
        pointHoverBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: "white",
          titleColor: COLORS.navy,
          bodyColor: COLORS.navy,
          borderColor: "#e5ebf3",
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            label: (context) => {
              const val = context.parsed.y;
              return metric === "revenue" ? formatCurrency(val) : formatCompactNumber(val);
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: COLORS.muted,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            font: {
              size: 11
            }
          },
          border: {
            display: false
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: COLORS.grid,
            drawBorder: false
          },
          ticks: {
            color: COLORS.muted,
            padding: 8,
            callback: (value) => metric === "revenue"
              ? formatCurrency(value)
              : formatCompactNumber(value),
            font: {
              size: 11
            }
          },
          border: {
            display: false
          }
        }
      }
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
    .slice(0, 8);

  const labels = sorted.map(([name]) =>
    name.length > 20 ? name.slice(0, 20) + "…" : name
  );
  const values = sorted.map(([, count]) => count);

  const ctx = document.getElementById("categoryChart").getContext("2d");
  if (categoryChartInstance) categoryChartInstance.destroy();

  categoryChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: "#18C37E",
        borderRadius: 8,
        borderSkipped: false,
        barThickness: 24
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: "white",
          titleColor: COLORS.navy,
          bodyColor: COLORS.navy,
          borderColor: "#e5ebf3",
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            label: (context) => formatCompactNumber(context.parsed.x)
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: {
            color: COLORS.grid,
            drawBorder: false
          },
          ticks: {
            color: COLORS.muted,
            callback: (value) => formatCompactNumber(value),
            font: {
              size: 11
            }
          },
          border: {
            display: false
          }
        },
        y: {
          grid: {
            display: false
          },
          ticks: {
            color: "#5f6f86",
            font: {
              size: 12,
              weight: "500"
            }
          },
          border: {
            display: false
          }
        }
      }
    }
  });
}
function getWeekKey(date) {
  const temp = new Date(date);
  temp.setHours(0, 0, 0, 0);
  temp.setDate(temp.getDate() - temp.getDay());
  return temp.toISOString().slice(0, 10);
}
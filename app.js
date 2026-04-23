let orders = [];
let orderItems = [];
let products = [];

let trendChartInstance = null;
let categoryChartInstance = null;

let dashboardCache = {
  prepared: false,
  kpis: {
    lateDeliveries: 0,
    totalPurchases: 0,
    totalCustomers: 0,
    totalRevenue: 0
  },
  trend: {
    weekly: {
      order_purchase_timestamp: {
        late_deliveries: new Map(),
        orders: new Map(),
        revenue: new Map()
      },
      order_delivered_customer_date: {
        late_deliveries: new Map(),
        orders: new Map(),
        revenue: new Map()
      }
    },
    monthly: {
      order_purchase_timestamp: {
        late_deliveries: new Map(),
        orders: new Map(),
        revenue: new Map()
      },
      order_delivered_customer_date: {
        late_deliveries: new Map(),
        orders: new Map(),
        revenue: new Map()
      }
    }
  },
  categoryCounts: [],
  heatmapCounts: Array.from({ length: 7 }, () => Array(24).fill(0))
};

const COLORS = {
  pageBg: "#f5f7fb",
  cardBg: "#ffffff",
  navy: "#1f2a44",
  muted: "#8b9bb4",
  border: "#e9eef5",
  purple: "#5B57F2",
  purpleFill: "rgba(91, 87, 242, 0.12)",
  green: "#18C37E",
  grid: "rgba(31, 42, 68, 0.08)"
};

const DATE_COLUMNS = [
  "order_purchase_timestamp",
  "order_delivered_customer_date"
];

document.addEventListener("DOMContentLoaded", () => {
  const loadSampleBtn = document.getElementById("loadSampleBtn");
  if (loadSampleBtn) {
    loadSampleBtn.addEventListener("click", async () => {
      try {
        showLoadingState(true, "Loading sample CSVs...");
        orders = await loadCSVFromPath("data/orders.csv");
        orderItems = await loadCSVFromPath("data/order_items.csv");
        products = await loadCSVFromPath("data/products.csv");
        onDataLoaded();
      } catch (error) {
        console.error(error);
        alert("Could not load sample CSV files. Make sure the files exist in /data.");
        showLoadingState(false);
      }
    });
  }

  const ordersFile = document.getElementById("ordersFile");
  const itemsFile = document.getElementById("itemsFile");
  const productsFile = document.getElementById("productsFile");

  if (ordersFile) {
    ordersFile.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      showLoadingState(true, "Parsing orders file...");
      orders = await parseLocalCSV(file);
      maybeBuildFromUploads();
    });
  }

  if (itemsFile) {
    itemsFile.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      showLoadingState(true, "Parsing order items file...");
      orderItems = await parseLocalCSV(file);
      maybeBuildFromUploads();
    });
  }

  if (productsFile) {
    productsFile.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      showLoadingState(true, "Parsing products file...");
      products = await parseLocalCSV(file);
      maybeBuildFromUploads();
    });
  }

  let redrawTimeout = null;
  ["metricType", "timeGranularity", "dateColumn"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      if (!dashboardCache.prepared) return;
      clearTimeout(redrawTimeout);
      redrawTimeout = setTimeout(() => {
        updateDashboardView();
      }, 60);
    });
  });
});

function maybeBuildFromUploads() {
  if (orders.length && orderItems.length && products.length) {
    onDataLoaded();
  } else {
    showLoadingState(false);
  }
}

function onDataLoaded() {
  showLoadingState(true, "Preparing dashboard...");
  setTimeout(() => {
    prepareDashboardData();
    updateDashboardView();
    hideHeroIfDesired();
    showLoadingState(false);
  }, 0);
}

function showLoadingState(isLoading, message = "Loading...") {
  const btn = document.getElementById("loadSampleBtn");
  if (btn) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? message : "Load sample repo CSVs";
  }
}

function hideHeroIfDesired() {
  const hero = document.querySelector(".hero");
  if (!hero) return;

  const shouldCollapse = document.body.dataset.collapseHero !== "false";
  if (shouldCollapse) {
    hero.classList.add("hero-collapsed");
  }
}

async function parseLocalCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      worker: true,
      complete: (results) => resolve(results.data || []),
      error: (error) => reject(error)
    });
  });
}

async function loadCSVFromPath(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}`);
  }

  const text = await response.text();

  return new Promise((resolve) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      worker: true,
      complete: (results) => resolve(results.data || [])
    });
  });
}

function prepareDashboardData() {
  const customerIds = new Set();
  const orderMap = new Map();
  const productMap = new Map();
  const categoryCountsMap = new Map();

  let lateDeliveries = 0;
  let totalRevenue = 0;

  const trend = createEmptyTrendStore();
  const heatmapCounts = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const product of products) {
    const productId = safeString(product.product_id);
    if (!productId) continue;
    productMap.set(productId, {
      category: safeString(product.product_category_name) || "Unknown"
    });
  }

  for (const order of orders) {
    const orderId = safeString(order.order_id);
    if (!orderId) continue;

    orderMap.set(orderId, order);

    const customerId = safeString(order.customer_id);
    if (customerId) customerIds.add(customerId);

    const purchaseDate = parseDate(order.order_purchase_timestamp);
    const deliveredDate = parseDate(order.order_delivered_customer_date);
    const estimatedDate = parseDate(order.order_estimated_delivery_date);

    if (purchaseDate) {
      heatmapCounts[purchaseDate.getDay()][purchaseDate.getHours()] += 1;
    }

    const isLate = Boolean(
      deliveredDate &&
      estimatedDate &&
      deliveredDate.getTime() > estimatedDate.getTime()
    );

    if (isLate) {
      lateDeliveries += 1;
    }

    for (const dateColumn of DATE_COLUMNS) {
      const currentDate = parseDate(order[dateColumn]);
      if (!currentDate) continue;

      const weeklyKey = getWeekKey(currentDate);
      const monthlyKey = getMonthKey(currentDate);

      incrementMap(trend.weekly[dateColumn].orders, weeklyKey, 1);
      incrementMap(trend.monthly[dateColumn].orders, monthlyKey, 1);

      if (isLate) {
        incrementMap(trend.weekly[dateColumn].late_deliveries, weeklyKey, 1);
        incrementMap(trend.monthly[dateColumn].late_deliveries, monthlyKey, 1);
      }
    }
  }

  for (const item of orderItems) {
    const orderId = safeString(item.order_id);
    const productId = safeString(item.product_id);
    const price = toNumber(item.price);

    totalRevenue += price;

    const category = productMap.get(productId)?.category || "Unknown";
    categoryCountsMap.set(category, (categoryCountsMap.get(category) || 0) + 1);

    const matchingOrder = orderMap.get(orderId);
    if (!matchingOrder) continue;

    for (const dateColumn of DATE_COLUMNS) {
      const currentDate = parseDate(matchingOrder[dateColumn]);
      if (!currentDate) continue;

      const weeklyKey = getWeekKey(currentDate);
      const monthlyKey = getMonthKey(currentDate);

      incrementMap(trend.weekly[dateColumn].revenue, weeklyKey, price);
      incrementMap(trend.monthly[dateColumn].revenue, monthlyKey, price);
    }
  }

  const categoryCounts = Array.from(categoryCountsMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  dashboardCache = {
    prepared: true,
    kpis: {
      lateDeliveries,
      totalPurchases: orders.length,
      totalCustomers: customerIds.size,
      totalRevenue
    },
    trend,
    categoryCounts,
    heatmapCounts
  };
}

function updateDashboardView() {
  updateKPIs();
  drawTrendChart();
  drawCategoryChart();
  drawHeatmap();
}

function updateKPIs() {
  setText("lateDeliveries", formatCompactNumber(dashboardCache.kpis.lateDeliveries));
  setText("totalPurchases", formatCompactNumber(dashboardCache.kpis.totalPurchases));
  setText("totalCustomers", formatCompactNumber(dashboardCache.kpis.totalCustomers));
  setText("totalRevenue", formatCurrency(dashboardCache.kpis.totalRevenue));
}

function drawTrendChart() {
  const metric = getSelectedValue("metricType", "late_deliveries");
  const granularity = getSelectedValue("timeGranularity", "weekly");
  const dateColumn = getSelectedValue("dateColumn", "order_purchase_timestamp");

  const sourceMap =
    granularity === "monthly"
      ? dashboardCache.trend.monthly[dateColumn][metric]
      : dashboardCache.trend.weekly[dateColumn][metric];

  const sortedKeys = Array.from(sourceMap.keys()).sort((a, b) => {
    return new Date(a) - new Date(b);
  });

  const rawValues = sortedKeys.map((key) => sourceMap.get(key) || 0);
  const labels = sortedKeys.map((key) => formatPeriodLabel(key, granularity));

  const useSmoothing = granularity === "weekly" && rawValues.length >= 6;
  const values = metric === "revenue" || !useSmoothing ? rawValues : movingAverage(rawValues, 3);

  const ctx = document.getElementById("trendChart")?.getContext("2d");
  if (!ctx) return;

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderColor: COLORS.purple,
          backgroundColor: COLORS.purpleFill,
          fill: true,
          borderWidth: 3,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: COLORS.purple,
          pointHoverBorderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      normalized: true,
      animation: false,
      layout: {
        padding: {
          top: 4,
          right: 6,
          bottom: 0,
          left: 0
        }
      },
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: "#ffffff",
          titleColor: COLORS.navy,
          bodyColor: COLORS.navy,
          borderColor: COLORS.border,
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (context) => {
              const value = context.parsed.y;
              if (metric === "revenue") {
                return formatCurrency(value);
              }
              return formatCompactNumber(Math.round(value));
            }
          }
        }
      },
      scales: {
        x: {
          offset: false,
          grid: {
            display: false
          },
          ticks: {
            color: COLORS.muted,
            autoSkip: true,
            maxTicksLimit: 6,
            maxRotation: 0,
            minRotation: 0,
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
          grace: "5%",
          grid: {
            color: COLORS.grid,
            drawBorder: false
          },
          ticks: {
            color: COLORS.muted,
            maxTicksLimit: 5,
            padding: 8,
            font: {
              size: 11
            },
            callback: (value) => {
              if (metric === "revenue") return compactCurrencyTick(value);
              return compactNumberTick(value);
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
  const topCategories = dashboardCache.categoryCounts.slice(0, 6);
  const labels = topCategories.map(({ category }) => truncate(category, 16));
  const values = topCategories.map(({ count }) => count);

  const ctx = document.getElementById("categoryChart")?.getContext("2d");
  if (!ctx) return;

  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  categoryChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: COLORS.green,
          borderRadius: 8,
          borderSkipped: false,
          barThickness: 18,
          categoryPercentage: 0.9,
          barPercentage: 0.95
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      normalized: true,
      animation: false,
      layout: {
        padding: {
          top: 4,
          right: 6,
          bottom: 0,
          left: 0
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: "#ffffff",
          titleColor: COLORS.navy,
          bodyColor: COLORS.navy,
          borderColor: COLORS.border,
          borderWidth: 1,
          padding: 10,
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
            maxTicksLimit: 5,
            font: {
              size: 11
            },
            callback: (value) => compactNumberTick(value)
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
              size: 11,
              weight: "600"
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

function drawHeatmap() {
  const heatmap = document.getElementById("heatmap");
  if (!heatmap) return;

  heatmap.innerHTML = "";

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const counts = dashboardCache.heatmapCounts;
  const maxVal = Math.max(...counts.flat(), 1);

  const corner = document.createElement("div");
  heatmap.appendChild(corner);

  for (let hour = 0; hour < 24; hour += 1) {
    const header = document.createElement("div");
    header.className = "heatmap-header";
    header.textContent = String(hour).padStart(2, "0");
    heatmap.appendChild(header);
  }

  for (let day = 0; day < 7; day += 1) {
    const dayLabel = document.createElement("div");
    dayLabel.className = "heatmap-day-label";
    dayLabel.textContent = days[day];
    heatmap.appendChild(dayLabel);

    for (let hour = 0; hour < 24; hour += 1) {
      const count = counts[day][hour];
      const intensity = count / maxVal;
      const alpha = 0.08 + intensity * 0.85;

      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      cell.style.background = `rgba(91, 87, 242, ${alpha})`;
      cell.title = `${days[day]} ${String(hour).padStart(2, "0")}:00 — ${formatCompactNumber(count)} orders`;

      heatmap.appendChild(cell);
    }
  }
}

function createEmptyTrendStore() {
  return {
    weekly: {
      order_purchase_timestamp: {
        late_deliveries: new Map(),
        orders: new Map(),
        revenue: new Map()
      },
      order_delivered_customer_date: {
        late_deliveries: new Map(),
        orders: new Map(),
        revenue: new Map()
      }
    },
    monthly: {
      order_purchase_timestamp: {
        late_deliveries: new Map(),
        orders: new Map(),
        revenue: new Map()
      },
      order_delivered_customer_date: {
        late_deliveries: new Map(),
        orders: new Map(),
        revenue: new Map()
      }
    }
  };
}

function incrementMap(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount);
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeString(value) {
  return value == null ? "" : String(value).trim();
}

function getWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function getMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function movingAverage(values, windowSize = 3) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    const sum = slice.reduce((acc, current) => acc + current, 0);
    return sum / slice.length;
  });
}

function formatPeriodLabel(key, granularity) {
  const d = new Date(key);
  if (granularity === "monthly") {
    return d.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit"
    });
  }

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function formatCompactNumber(num) {
  return new Intl.NumberFormat("en-US").format(num);
}

function formatCurrency(num) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(num);
}

function compactNumberTick(value) {
  const num = Number(value);
  if (Math.abs(num) >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (Math.abs(num) >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(Math.round(num));
}

function compactCurrencyTick(value) {
  const num = Number(value);
  if (Math.abs(num) >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (Math.abs(num) >= 1000) return `$${(num / 1000).toFixed(1)}K`;
  return `$${Math.round(num)}`;
}

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function getSelectedValue(id, fallback) {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
}
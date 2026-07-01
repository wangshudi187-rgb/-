const PASSWORD = "123456";
const AUTH_KEY = "ai-fat-loss-tracker-authenticated-v1";
const CURRENT_USER_KEY = "ai-fat-loss-tracker-current-user-v1";
const DEFAULT_USERS = ["test", "main"];
const WEIGHT_UNIT_VERSION = "jin";
    const BACKUP_DB = "ai-fat-loss-tracker-backup-db";
    const BACKUP_STORE = "handles";
    const BACKUP_HANDLE_KEY = "backup-directory";

    const $ = (selector) => document.querySelector(selector);
    const loginForm = $("#loginForm");
    const passwordInput = $("#passwordInput");
    const loginUserSelect = $("#loginUserSelect");
    const userSelect = $("#userSelect");
    const authError = $("#authError");
    const authScreen = $("#authScreen");
    const appShell = $("#appShell");
    const appRoot = $("#appRoot");
    const form = $("#entryForm");
    const hasCardio = $("#hasCardio");
    const fields = {
      date: $("#date"),
      weight: $("#weight"),
      waist: $("#waist"),
      steps: $("#steps"),
      neck: $("#neck"),
      hip: $("#hip"),
      thigh: $("#thigh"),
      arm: $("#arm"),
      cardio: $("#cardio"),
      strength: $("#strength"),
      trainingType: $("#trainingType")
    };

    let currentUser = localStorage.getItem(CURRENT_USER_KEY) || "main";
    if (!DEFAULT_USERS.includes(currentUser)) currentUser = "main";
    let records = [];
    let settings = {};
    let chartRange = 7;
    let weightChart;
    let waistChart;
    let stepsChart;
    let cumulativeChart;
    let backupDirectoryHandle = null;
    let appInitialized = false;
    let steppersInitialized = false;
    let lastDeletedRecord = null;
    let pendingDeleteDate = null;
    let activeTab = "record";

    function todayString() {
      const now = new Date();
      const offset = now.getTimezoneOffset();
      return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
    }

    function previousDateString(dateString) {
      const date = new Date(dateString + "T00:00:00");
      date.setDate(date.getDate() - 1);
      return date.toISOString().slice(0, 10);
    }

    function toNumber(value) {
      if (value === "" || value === null || value === undefined) return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    function formatFixed(value, digits = 2) {
      return Number(value).toFixed(digits);
    }

    function defaultWeightValue() {
      const latest = latestRecord();
      return latest && latest.weight !== null ? latest.weight : 140;
    }

    function stepperConfig(target) {
      const stepper = document.querySelector(`.stepper[data-target="${target}"]`);
      if (!stepper) return null;
      return {
        stepper,
        input: document.getElementById(target),
        display: stepper.querySelector("[data-stepper-value]"),
        manual: document.querySelector(`[data-manual-for="${target}"]`),
        step: Number(stepper.dataset.step || 1),
        min: Number(stepper.dataset.min || 0),
        max: Number(stepper.dataset.max || 999999),
        decimals: Number(stepper.dataset.decimals || 0)
      };
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function normalizeStepperValue(config, value, fallback = config.min) {
      const numeric = toNumber(value);
      const fallbackNumber = toNumber(fallback);
      const base = numeric === null ? (fallbackNumber === null ? config.min : fallbackNumber) : numeric;
      return clamp(base, config.min, config.max);
    }

    function setStepperValue(target, value, fallback) {
      const config = stepperConfig(target);
      if (!config) return;
      const normalized = normalizeStepperValue(config, value, fallback);
      const formatted = normalized.toFixed(config.decimals);
      config.input.value = formatted;
      config.display.textContent = formatted;
      if (config.manual) config.manual.value = formatted;
    }

    function setStepperManualValue(target, value, fallback) {
      const config = stepperConfig(target);
      if (!config) return;
      const numeric = toNumber(value);
      const fallbackNumber = toNumber(fallback);
      const base = numeric === null ? (fallbackNumber === null ? config.min : fallbackNumber) : numeric;
      const clamped = clamp(base, config.min, config.max);
      const formatted = clamped.toFixed(config.decimals);
      config.input.value = formatted;
      config.display.textContent = formatted;
      if (config.manual) config.manual.value = formatted;
    }

    function clearStepperValue(target) {
      const config = stepperConfig(target);
      if (!config) return;
      config.input.value = "";
      config.display.textContent = "--";
      if (config.manual) config.manual.value = "";
    }

    function setOptionalStepperValue(target, value) {
      if (toNumber(value) === null) {
        clearStepperValue(target);
      } else {
        setStepperManualValue(target, value, value);
      }
    }

    function syncManualStepperValues() {
      document.querySelectorAll("[data-manual-for]").forEach((input) => {
        if (input.value === "") return;
        setStepperManualValue(input.dataset.manualFor, input.value, input.value);
      });
    }

    function changeStepperValue(target, direction) {
      const config = stepperConfig(target);
      if (!config) return;
      const current = toNumber(config.input.value) ?? config.min;
      setStepperValue(target, current + direction * config.step, current);
    }

    function setActiveTab(tab) {
      activeTab = tab;
      appRoot.classList.remove("view-record", "view-trend", "view-data", "view-ai");
      appRoot.classList.add(`view-${tab}`);
      document.querySelectorAll("[data-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === tab);
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (tab === "trend") {
        renderCharts();
        window.setTimeout(() => {
          [weightChart, waistChart, stepsChart, cumulativeChart].forEach((chart) => chart && chart.resize());
        }, 80);
      }
      if (tab === "data") {
        renderHistory();
        setDataView("overview");
      }
    }

    function setDataView(view) {
      $(".data-goal").classList.toggle("hidden", view !== "overview");
      document.querySelectorAll(".data-manager-panel").forEach((panel) => {
        panel.classList.toggle("hidden", view !== "manager");
      });
      $(".advanced-panel").classList.toggle("hidden", view !== "advanced");
      if (view === "advanced") $(".advanced-danger").open = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function updateCardioDetails() {
      const enabled = hasCardio.value === "yes";
      document.querySelectorAll(".cardio-detail").forEach((element) => {
        element.classList.toggle("hidden", !enabled);
      });
      if (!enabled) {
        clearStepperValue("cardio");
        fields.trainingType.value = "力量";
      } else if (fields.trainingType.value === "力量") {
        fields.trainingType.value = "Zone2";
      }
    }

    function initializeSteppers() {
      if (steppersInitialized) return;
      document.querySelectorAll(".stepper").forEach((stepper) => {
        const target = stepper.dataset.target;
        stepper.querySelectorAll("[data-step-action]").forEach((button) => {
          let holdDelay = null;
          let holdInterval = null;
          let didHold = false;
          const direction = button.dataset.stepAction === "increase" ? 1 : -1;

          const stopHold = () => {
            window.clearTimeout(holdDelay);
            window.clearInterval(holdInterval);
            holdDelay = null;
            holdInterval = null;
          };

          button.addEventListener("pointerdown", (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            didHold = false;
            stopHold();
            holdDelay = window.setTimeout(() => {
              didHold = true;
              changeStepperValue(target, direction);
              holdInterval = window.setInterval(() => {
                changeStepperValue(target, direction);
              }, 110);
            }, 350);
          });

          button.addEventListener("pointerup", stopHold);
          button.addEventListener("pointercancel", stopHold);
          button.addEventListener("pointerleave", stopHold);
          button.addEventListener("lostpointercapture", stopHold);
          button.addEventListener("click", () => {
            if (didHold) {
              didHold = false;
              return;
            }
            changeStepperValue(target, direction);
          });
        });
      });

      document.querySelectorAll("[data-manual-for]").forEach((input) => {
        input.addEventListener("change", () => {
          if (input.value === "") {
            clearStepperValue(input.dataset.manualFor);
          } else {
            setStepperManualValue(input.dataset.manualFor, input.value, input.value);
          }
        });
      });

      document.querySelectorAll("[data-quick-for]").forEach((group) => {
        group.addEventListener("click", (event) => {
          const button = event.target.closest("[data-quick-value]");
          if (!button) return;
          setStepperValue(group.dataset.quickFor, button.dataset.quickValue, button.dataset.quickValue);
        });
      });

      document.querySelectorAll("[data-clear-stepper]").forEach((button) => {
        button.addEventListener("click", () => {
          clearStepperValue(button.dataset.clearStepper);
        });
      });
      steppersInitialized = true;
    }

    function userDataKey(userId = currentUser) {
      return `user_${userId}_data`;
    }

    function userSettingsKey(userId = currentUser) {
      return `user_${userId}_settings`;
    }

    function userWeightUnitKey(userId = currentUser) {
      return `user_${userId}_weight_unit_version`;
    }

    function userDataEnvelope(data = records, userId = currentUser) {
      return {
        user: userId,
        data
      };
    }

    function loadRecords(userId = currentUser) {
      try {
        const parsed = JSON.parse(localStorage.getItem(userDataKey(userId)) || "null");
        if (Array.isArray(parsed)) return parsed;
        if (parsed && parsed.user === userId && Array.isArray(parsed.data)) return parsed.data;
        return [];
      } catch {
        return [];
      }
    }

    function saveRecords() {
      localStorage.setItem(userDataKey(), JSON.stringify(userDataEnvelope(records)));
    }

    function loadSettings(userId = currentUser) {
      try {
        const parsed = JSON.parse(localStorage.getItem(userSettingsKey(userId)) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }

    function saveSettings() {
      localStorage.setItem(userSettingsKey(), JSON.stringify(settings));
    }

    function convertWeightToJin(value) {
      const number = toNumber(value);
      return number === null ? value : Number((number * 2).toFixed(1));
    }

    function convertRecordWeightToJin(record) {
      if (!record || typeof record !== "object" || record.weight === undefined) return record;
      return { ...record, weight: convertWeightToJin(record.weight) };
    }

    function convertSettingsWeightToJin(source) {
      if (!source || typeof source !== "object") return source;
      const converted = { ...source };
      if (converted.startWeight !== undefined) converted.startWeight = convertWeightToJin(converted.startWeight);
      if (converted.targetWeight !== undefined) converted.targetWeight = convertWeightToJin(converted.targetWeight);
      return converted;
    }

    function migrateWeightUnitForUser(userId = currentUser) {
      if (localStorage.getItem(userWeightUnitKey(userId)) === WEIGHT_UNIT_VERSION) return;
      const migratedRecords = loadRecords(userId).map(convertRecordWeightToJin);
      const migratedSettings = convertSettingsWeightToJin(loadSettings(userId));
      localStorage.setItem(userDataKey(userId), JSON.stringify(userDataEnvelope(migratedRecords, userId)));
      localStorage.setItem(userSettingsKey(userId), JSON.stringify(migratedSettings || {}));
      localStorage.setItem(userWeightUnitKey(userId), WEIGHT_UNIT_VERSION);
    }

    function syncUserSelectors() {
      loginUserSelect.value = currentUser;
      userSelect.value = currentUser;
    }

    function switchUser(userId) {
      if (!DEFAULT_USERS.includes(userId)) return;
      currentUser = userId;
      localStorage.setItem(CURRENT_USER_KEY, currentUser);
      syncUserSelectors();
      migrateWeightUnitForUser();
      records = loadRecords();
      settings = loadSettings();
      initializeForm();
      renderAll();
      toast(`已切换到 ${currentUser}`);
    }

    function supportsFileBackup() {
      return "showDirectoryPicker" in window && "indexedDB" in window;
    }

    function openBackupDb() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(BACKUP_DB, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(BACKUP_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function storeBackupDirectoryHandle(handle) {
      const db = await openBackupDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE, "readwrite");
        tx.objectStore(BACKUP_STORE).put(handle, BACKUP_HANDLE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }

    async function loadBackupDirectoryHandle() {
      if (!supportsFileBackup()) return null;
      const db = await openBackupDb();
      const handle = await new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE, "readonly");
        const request = tx.objectStore(BACKUP_STORE).get(BACKUP_HANDLE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return handle;
    }

    async function ensureBackupPermission(handle, requestAccess = false) {
      if (!handle) return false;
      const options = { mode: "readwrite" };
      if ((await handle.queryPermission(options)) === "granted") return true;
      if (requestAccess && (await handle.requestPermission(options)) === "granted") return true;
      return false;
    }

    function safeBackupName(record) {
      const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
      return `${currentUser}_${record.date}_${stamp}_记录.json`;
    }

    async function writeRecordBackup(record) {
      if (!backupDirectoryHandle) return { skipped: true, reason: "未设置备份文件夹" };
      const allowed = await ensureBackupPermission(backupDirectoryHandle, false);
      if (!allowed) return { skipped: true, reason: "需要重新授权备份文件夹" };

      const fileHandle = await backupDirectoryHandle.getFileHandle(safeBackupName(record), { create: true });
      const writable = await fileHandle.createWritable();
      const payload = {
        type: "AI减脂进度追踪每日备份",
        backupPolicy: "append-only: create new file on each save; no read, delete, or edit of old backups",
        weightUnitVersion: WEIGHT_UNIT_VERSION,
        weightUnit: "斤",
        user: currentUser,
        backedUpAt: new Date().toISOString(),
        record
      };
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
      return { skipped: false };
    }

    function renderBackupStatus(message) {
      const status = $("#backupStatus");
      if (!status) return;
      if (message) {
        status.textContent = message;
      } else if (!supportsFileBackup()) {
        status.textContent = "当前浏览器不支持自动文件夹备份";
      } else if (backupDirectoryHandle) {
        status.textContent = "本地保存，文件夹备份已设置";
      } else {
        status.textContent = "本地保存，备份未设置";
      }
    }

    function sortedRecords() {
      return [...records].sort((a, b) => a.date.localeCompare(b.date));
    }

    function latestRecord() {
      const sorted = sortedRecords();
      return sorted[sorted.length - 1] || null;
    }

    function getCurrentRecord() {
      return records.find((item) => item.date === fields.date.value) || latestRecord();
    }

    function recordFromForm() {
      syncManualStepperValues();
      updateCardioDetails();
      return {
        user: currentUser,
        id: fields.date.value,
        date: fields.date.value,
        activityDate: previousDateString(fields.date.value),
        weight: toNumber(fields.weight.value),
        waist: toNumber(fields.waist.value),
        steps: toNumber(fields.steps.value),
        neck: toNumber(fields.neck.value),
        hip: toNumber(fields.hip.value),
        thigh: toNumber(fields.thigh.value),
        arm: toNumber(fields.arm.value),
        strength: fields.strength.checked,
        cardio: hasCardio.value === "yes" ? toNumber(fields.cardio.value) : null,
        trainingType: hasCardio.value === "yes" ? fields.trainingType.value : null,
        updatedAt: new Date().toISOString()
      };
    }

    function fillForm(record) {
      if (!record) return;
      fields.date.value = record.date || todayString();
      setStepperManualValue("weight", record.weight, defaultWeightValue());
      setOptionalStepperValue("waist", record.waist);
      setOptionalStepperValue("steps", record.steps);
      setOptionalStepperValue("neck", record.neck);
      setOptionalStepperValue("hip", record.hip);
      setOptionalStepperValue("thigh", record.thigh);
      setOptionalStepperValue("arm", record.arm);
      hasCardio.value = (record.cardio ?? 0) > 0 ? "yes" : "no";
      fields.strength.checked = Boolean(record.strength);
      fields.trainingType.value = record.trainingType || "力量";
      updateCardioDetails();
      if (hasCardio.value === "yes") setOptionalStepperValue("cardio", record.cardio);
    }

    function copyPreviousData() {
      const currentDate = fields.date.value || todayString();
      const previous = sortedRecords().filter((item) => item.date < currentDate).pop() || latestRecord();
      if (!previous) {
        toast("暂无历史记录可复制。");
        return;
      }

      fields.date.value = todayString();
      setStepperManualValue("weight", previous.weight, defaultWeightValue());
      setOptionalStepperValue("waist", previous.waist);
      setOptionalStepperValue("neck", previous.neck);
      setOptionalStepperValue("hip", previous.hip);
      setOptionalStepperValue("thigh", previous.thigh);
      setOptionalStepperValue("arm", previous.arm);
      setOptionalStepperValue("steps", previous.steps);
      fields.strength.checked = Boolean(previous.strength);
      hasCardio.value = (previous.cardio ?? 0) > 0 ? "yes" : "no";
      fields.trainingType.value = previous.trainingType || "力量";
      updateCardioDetails();
      if (hasCardio.value === "yes") setOptionalStepperValue("cardio", previous.cardio);
      toast("已沿用上次数据，日期保持今天。");
    }

    function upsertRecord(record) {
      const existingIndex = records.findIndex((item) => item.date === record.date);
      if (existingIndex >= 0) {
        records[existingIndex] = record;
      } else {
        records.push(record);
      }
      saveRecords();
    }

    function averageWeight(days, throughDate) {
      const recent = sortedRecords()
        .filter((item) => item.date <= throughDate && item.weight !== null)
        .slice(-days);
      if (recent.length < days) return null;
      return recent.reduce((sum, item) => sum + item.weight, 0) / recent.length;
    }

    function getWindowRecords(days) {
      const sorted = sortedRecords();
      if (!sorted.length) return [];
      if (days === "all") return sorted;
      const end = new Date(sorted[sorted.length - 1].date + "T00:00:00");
      const start = new Date(end);
      start.setDate(end.getDate() - days + 1);
      return sorted.filter((item) => new Date(item.date + "T00:00:00") >= start);
    }

    function chartConfig(label, data, color) {
      return {
        type: "line",
        data: {
          labels: data.map((item) => chartRange === "all" ? item.date : item.date.slice(5)),
          datasets: [{
            label,
            data: data.map((item) => item.value),
            borderColor: color,
            backgroundColor: "rgba(23, 23, 23, 0.08)",
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
            tension: 0.28,
            spanGaps: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              displayColors: false,
              callbacks: {
                label: (context) => `${label}: ${context.parsed.y}`
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: "#737373", maxRotation: 0, autoSkip: true }
            },
            y: {
              grid: { color: "#e8e8e2" },
              ticks: { color: "#737373" }
            }
          }
        }
      };
    }

    function buildChart(canvasId, existing, label, data, color) {
      if (existing) existing.destroy();
      return new Chart($(canvasId), chartConfig(label, data, color));
    }

    function renderCharts() {
      const windowed = getWindowRecords(chartRange);
      weightChart = buildChart("#weightChart", weightChart, "体重 斤", windowed.map((item) => ({ date: item.date, value: item.weight })), "#171717");
      waistChart = buildChart("#waistChart", waistChart, "腰围 cm", windowed.map((item) => ({ date: item.date, value: item.waist })), "#6b6b65");
      stepsChart = buildChart("#stepsChart", stepsChart, "步数", windowed.map((item) => ({ date: item.date, value: item.steps })), "#3e3e3a");

      const allWeighted = validWeightRecords();
      const baseline = allWeighted[0]?.weight ?? null;
      const cumulativeData = baseline === null
        ? []
        : validWeightRecords(windowed).map((item) => ({
          date: item.date,
          value: Number((item.weight - baseline).toFixed(1))
        }));
      const hasCumulativeTrend = cumulativeData.length >= 2;
      const cumulativeCanvas = $("#cumulativeChart");
      $("#cumulativeEmpty").classList.toggle("hidden", hasCumulativeTrend);
      cumulativeCanvas.classList.toggle("hidden", !hasCumulativeTrend);
      if (cumulativeChart) {
        cumulativeChart.destroy();
        cumulativeChart = null;
      }
      if (hasCumulativeTrend) {
        cumulativeChart = buildChart("#cumulativeChart", null, "累计变化 斤", cumulativeData, "#34c759");
      }
    }

    function formatDate(date) {
      return date.toISOString().slice(0, 10);
    }

    function daysBetween(startDate, endDate) {
      const dayMs = 24 * 60 * 60 * 1000;
      return Math.round((new Date(endDate + "T00:00:00") - new Date(startDate + "T00:00:00")) / dayMs);
    }

    function jin(value) {
      return `${value.toFixed(1)}`;
    }

    function validWeightRecords(source = sortedRecords()) {
      return source
        .map((item) => ({ ...item, weight: toNumber(item.weight) }))
        .filter((item) => item.weight !== null);
    }

    function periodWeightStats(days) {
      const weighted = validWeightRecords(days === "all" ? sortedRecords() : getWindowRecords(days));
      return {
        count: weighted.length,
        change: weighted.length >= 2 ? weighted[weighted.length - 1].weight - weighted[0].weight : null
      };
    }

    function longTermMetrics() {
      const weighted = validWeightRecords();
      if (!weighted.length) return null;
      const first = weighted[0];
      const latest = weighted[weighted.length - 1];
      const spanDays = daysBetween(first.date, latest.date);
      const elapsedDays = spanDays + 1;
      const change = latest.weight - first.weight;
      const highest = Math.max(...weighted.map((item) => item.weight));
      const lowest = Math.min(...weighted.map((item) => item.weight));
      const target = toNumber(settings.targetWeight);
      const configuredStart = toNumber(settings.startWeight);
      const targetGap = target === null ? null : Math.max(0, latest.weight - target);
      let progress = null;
      if (configuredStart !== null && target !== null && configuredStart !== target) {
        progress = clamp(((configuredStart - latest.weight) / (configuredStart - target)) * 100, 0, 100);
      }
      const weeklyChange = weighted.length >= 2 && spanDays > 0 ? change / (spanDays / 7) : null;
      return {
        elapsedDays,
        recordCount: records.length,
        first,
        latest,
        change,
        highest,
        lowest,
        targetGap,
        progress,
        weeklyChange,
        stage7: periodWeightStats(7),
        stage30: periodWeightStats(30),
        stageAll: periodWeightStats("all")
      };
    }

    function formatSignedChange(value) {
      if (value === null) return "数据不足";
      if (Math.abs(value) < 0.05) return "0.0";
      return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
    }

    function renderLongTermOverview() {
      const metrics = longTermMetrics();
      if (!metrics) {
        ["longDays", "longRecordCount", "longStartWeight", "longCurrentWeight", "longChange", "longRange", "longTargetGap", "longProgress", "longWeeklyChange", "stage7Change", "stage30Change", "stageAllChange", "stage7Count", "stage30Count"]
          .forEach((id) => { $(`#${id}`).textContent = "--"; });
        $("#longOverviewText").textContent = "开始记录后，这里会显示你的长期成果。";
        $("#longMilestoneText").textContent = "完成 7 天记录后会显示阶段里程碑。";
        return;
      }

      $("#longDays").textContent = String(metrics.elapsedDays);
      $("#longRecordCount").textContent = String(metrics.recordCount);
      $("#longStartWeight").textContent = metrics.first.weight.toFixed(1);
      $("#longCurrentWeight").textContent = metrics.latest.weight.toFixed(1);
      $("#longChange").textContent = formatSignedChange(metrics.change);
      $("#longRange").textContent = `${metrics.highest.toFixed(1)} / ${metrics.lowest.toFixed(1)}`;
      $("#longTargetGap").textContent = metrics.targetGap === null ? "--" : metrics.targetGap.toFixed(1);
      $("#longProgress").textContent = metrics.progress === null ? "--" : `${Math.round(metrics.progress)}%`;
      $("#longWeeklyChange").textContent = metrics.weeklyChange === null ? "数据不足" : formatSignedChange(metrics.weeklyChange);
      $("#stage7Change").textContent = formatSignedChange(metrics.stage7.change);
      $("#stage30Change").textContent = formatSignedChange(metrics.stage30.change);
      $("#stageAllChange").textContent = formatSignedChange(metrics.stageAll.change);
      $("#stage7Count").textContent = String(metrics.stage7.count);
      $("#stage30Count").textContent = String(metrics.stage30.count);

      const achievement = metrics.change < 0
        ? `累计下降 ${Math.abs(metrics.change).toFixed(1)} 斤`
        : metrics.change > 0
          ? `累计变化 +${metrics.change.toFixed(1)} 斤`
          : "体重保持稳定";
      const overviewParts = [`已记录 ${metrics.elapsedDays} 天`, achievement];
      if (metrics.progress !== null) overviewParts.push(`完成目标的 ${Math.round(metrics.progress)}%`);
      $("#longOverviewText").textContent = `${overviewParts.join("，")}。`;

      const milestones = [];
      const dayMilestone = [90, 60, 30, 7].find((value) => metrics.elapsedDays >= value);
      const loss = Math.max(0, -metrics.change);
      const lossMilestone = [20, 10, 5].find((value) => loss >= value);
      const progressMilestone = [75, 50, 25].find((value) => metrics.progress !== null && metrics.progress >= value);
      if (dayMilestone) milestones.push(`持续记录超过 ${dayMilestone} 天`);
      if (lossMilestone) milestones.push(`累计下降超过 ${lossMilestone} 斤`);
      if (progressMilestone) milestones.push(`目标完成超过 ${progressMilestone}%`);
      $("#longMilestoneText").textContent = milestones.length
        ? `阶段里程碑：${milestones.join(" · ")}`
        : "继续积累记录，首个阶段里程碑是记录满 7 天。";
    }

    function renderGoalSummary() {
      const target = toNumber(settings.targetWeight);
      const configuredStart = toNumber(settings.startWeight);
      const weighted = validWeightRecords();
      const first = weighted[0] || null;
      const latest = weighted[weighted.length - 1] || null;
      const start = configuredStart ?? first?.weight ?? null;
      const hasGoal = target !== null;
      const summaryMetrics = $("#goalSummaryMetrics");
      const emptyText = $("#goalEmptyText");
      summaryMetrics.classList.toggle("hidden", !hasGoal);
      emptyText.classList.toggle("hidden", hasGoal);
      $("#editGoalLabel").textContent = hasGoal ? "修改目标" : "设置目标";
      if (!hasGoal) {
        emptyText.textContent = "尚未设置目标";
        $("#goalSummaryProgressLabel").textContent = "尚未设置";
        $("#goalSummaryBar").style.width = "0%";
        return;
      }

      const gap = latest ? Math.max(0, latest.weight - target) : null;
      let progress = null;
      if (start !== null && start !== target && latest) {
        progress = clamp(((start - latest.weight) / (start - target)) * 100, 0, 100);
      }
      $("#goalSummaryStart").textContent = start === null ? "--" : start.toFixed(1);
      $("#goalSummaryTarget").textContent = target.toFixed(1);
      $("#goalSummaryDate").textContent = settings.targetDate || "--";
      $("#goalSummaryGap").textContent = gap === null ? "--" : gap.toFixed(1);
      $("#goalSummaryProgress").textContent = progress === null ? "--" : `${Math.round(progress)}%`;
      $("#goalSummaryProgressLabel").textContent = progress === null ? "等待体重记录" : `${Math.round(progress)}%`;
      $("#goalSummaryBar").style.width = `${progress === null ? 0 : Math.round(progress)}%`;
    }

    function setGoalEditorOpen(open) {
      $("#goalEditDialog").classList.toggle("hidden", !open);
    }

    function renderLossBreakdown() {
      const weighted = sortedRecords().filter((item) => item.weight !== null);
      const target = toNumber(settings.targetWeight);
      const targetDate = settings.targetDate || "";

      if (!weighted.length) {
        $("#dailyDrop").textContent = "--";
        $("#dailyDropNote").textContent = "需要昨天记录";
        $("#totalLoss").textContent = "--";
        $("#avgDailyLoss").textContent = "--";
        $("#remainingLoss").textContent = "--";
        $("#dailyTask").textContent = "--";
        $("#dailyTaskNote").textContent = "设置目标日期后显示";
        $("#daysLeft").textContent = "--";
        $("#lossHint").textContent = "按体重记录自动计算";
        return;
      }

      const first = weighted[0];
      const latest = weighted[weighted.length - 1];
      const previous = weighted[weighted.length - 2] || null;
      const totalLoss = first.weight - latest.weight;
      const elapsedDays = Math.max(1, daysBetween(first.date, latest.date));
      const avgDailyLoss = totalLoss / elapsedDays;

      if (previous) {
        const dailyDrop = previous.weight - latest.weight;
        $("#dailyDrop").textContent = dailyDrop > 0 ? jin(dailyDrop) : "0.0";
        $("#dailyDropNote").textContent = dailyDrop >= 0 ? "斤，较昨天早上" : `比昨天增加 ${jin(Math.abs(dailyDrop))}斤`;
      } else {
        $("#dailyDrop").textContent = "--";
        $("#dailyDropNote").textContent = "需要昨天记录";
      }

      $("#totalLoss").textContent = totalLoss > 0 ? jin(totalLoss) : "0.0";
      $("#avgDailyLoss").textContent = avgDailyLoss > 0 ? avgDailyLoss.toFixed(2) : "0.00";
      $("#lossHint").textContent = `第一天 ${first.date}，最新 ${latest.date}`;

      if (!target) {
        $("#remainingLoss").textContent = "--";
        $("#dailyTask").textContent = "--";
        $("#dailyTaskNote").textContent = "先设置目标体重";
        $("#daysLeft").textContent = "--";
        return;
      }

      const remaining = Math.max(0, latest.weight - target);
      $("#remainingLoss").textContent = jin(remaining);

      if (!targetDate) {
        $("#dailyTask").textContent = "--";
        $("#dailyTaskNote").textContent = "设置目标日期后显示";
        $("#daysLeft").textContent = "--";
        return;
      }

      const left = daysBetween(latest.date, targetDate);
      $("#daysLeft").textContent = left > 0 ? String(left) : "0";

      if (remaining <= 0) {
        $("#dailyTask").textContent = "0.00";
        $("#dailyTaskNote").textContent = "已到目标";
      } else if (left > 0) {
        $("#dailyTask").textContent = (remaining / left).toFixed(2);
        $("#dailyTaskNote").textContent = "斤 / 天";
      } else {
        $("#dailyTask").textContent = "--";
        $("#dailyTaskNote").textContent = "目标日期已过";
      }
    }

    function renderProgress() {
      const sorted = sortedRecords().filter((item) => item.weight !== null);
      const latest = sorted[sorted.length - 1];
      const first = sorted[0];
      const target = toNumber(settings.targetWeight);
      const start = toNumber(settings.startWeight) || (first ? first.weight : null);
      const targetDate = settings.targetDate || "";

      if (!latest || !target || !start) {
        $("#progressStart").textContent = "当前 -- 斤";
        $("#progressTarget").textContent = "目标 -- 斤";
        $("#progressBar").style.width = "0%";
        $("#weeklySpeed").textContent = "--";
        $("#targetGap").textContent = "--";
        $("#etaDate").textContent = "--";
        $("#targetPlan").textContent = targetDate ? targetDate.slice(5) : "--";
        $("#targetPlanNote").textContent = targetDate ? "等待体重记录" : "未设置";
        $("#progressHint").textContent = "填写目标体重后显示";
        return;
      }

      const total = Math.max(0.1, start - target);
      const done = Math.max(0, Math.min(total, start - latest.weight));
      const percent = Math.round((done / total) * 100);
      const gap = Math.max(0, latest.weight - target);
      const recent = sorted.slice(-30);
      let speed = null;

      if (recent.length >= 2) {
        const startRecent = recent[0];
        const endRecent = recent[recent.length - 1];
        const dayMs = 24 * 60 * 60 * 1000;
        const days = Math.max(1, (new Date(endRecent.date) - new Date(startRecent.date)) / dayMs);
        speed = ((startRecent.weight - endRecent.weight) / days) * 7;
      }

      $("#progressStart").textContent = `当前 ${latest.weight.toFixed(1)} 斤`;
      $("#progressTarget").textContent = `目标 ${target.toFixed(1)} 斤`;
      $("#progressBar").style.width = `${percent}%`;
      $("#targetGap").textContent = gap.toFixed(1);
      $("#progressHint").textContent = `已完成 ${percent}%`;
      renderTargetDatePlan(latest, gap, speed);
      renderLossBreakdown();

      if (speed === null) {
        $("#weeklySpeed").textContent = "--";
        $("#etaDate").textContent = "--";
        return;
      }

      $("#weeklySpeed").textContent = speed.toFixed(2);
      if (gap <= 0) {
        $("#etaDate").textContent = "已达成";
      } else if (speed > 0.05) {
        const daysNeeded = Math.ceil((gap / speed) * 7);
        const eta = new Date();
        eta.setDate(eta.getDate() + daysNeeded);
        $("#etaDate").textContent = formatDate(eta).slice(5);
      } else {
        $("#etaDate").textContent = "速度不足";
      }
    }

    function renderTargetDatePlan(latest, gap, speed) {
      const targetDate = settings.targetDate || "";
      if (!targetDate) {
        $("#targetPlan").textContent = "--";
        $("#targetPlanNote").textContent = "未设置";
        return;
      }

      const today = new Date(todayString() + "T00:00:00");
      const targetDay = new Date(targetDate + "T00:00:00");
      const dayMs = 24 * 60 * 60 * 1000;
      const daysLeft = Math.ceil((targetDay - today) / dayMs);
      $("#targetPlan").textContent = targetDate.slice(5);

      if (gap <= 0) {
        $("#targetPlanNote").textContent = "已提前达成";
        return;
      }
      if (daysLeft <= 0) {
        $("#targetPlanNote").textContent = "目标日期已过";
        return;
      }

      const requiredWeekly = (gap / daysLeft) * 7;
      if (speed !== null && speed >= requiredWeekly) {
        $("#targetPlanNote").textContent = `节奏可达，还需 ${requiredWeekly.toFixed(2)}斤/周`;
      } else {
        $("#targetPlanNote").textContent = `需约 ${requiredWeekly.toFixed(2)}斤/周`;
      }
    }

    function renderHistory() {
      const body = $("#historyBody");
      const cards = $("#historyCards");
      const deleteSelect = $("#deleteRecordSelect");
      const deleteButton = $("#requestDeleteRecordBtn");
      const sorted = sortedRecords().reverse();
      deleteSelect.innerHTML = [
        `<option value="">选择记录日期</option>`,
        ...sorted.map((item) => `<option value="${item.date}">${item.date} · ${item.weight ?? "--"} 斤</option>`)
      ].join("");
      deleteButton.disabled = sorted.length === 0;
      if (!sorted.length) {
        body.innerHTML = `<tr><td class="empty" colspan="9">暂无记录</td></tr>`;
        cards.innerHTML = `<div class="empty">暂无记录</div>`;
        return;
      }

      body.innerHTML = sorted.map((item) => `
        <tr>
          <td>${item.date}</td>
          <td>${item.weight ?? "--"}</td>
          <td>${item.waist ?? "--"}</td>
          <td>${item.steps ?? "--"}</td>
          <td>${item.hip ?? "--"}</td>
          <td>${item.thigh ?? "--"}</td>
          <td>${item.strength ? "力量" : item.trainingType || "--"}</td>
          <td>${formatUpdatedAt(item.updatedAt)}</td>
          <td><button class="btn" type="button" data-load="${item.date}">编辑</button></td>
        </tr>
      `).join("");

      cards.innerHTML = sorted.map((item) => `
        <article class="history-card">
          <div class="history-card-head">
            <div class="history-card-date">${item.date}</div>
            <span class="status-pill">${item.strength ? "力量" : item.trainingType || "--"}</span>
          </div>
          <div class="history-card-grid">
            <div>体重<strong>${item.weight ?? "--"} 斤</strong></div>
            <div>腰围<strong>${item.waist ?? "--"} cm</strong></div>
            <div>步数<strong>${item.steps ?? "--"}</strong></div>
            <div>有氧<strong>${item.cardio ?? "--"} min</strong></div>
          </div>
          <div class="history-saved-time">保存时间：${formatUpdatedAt(item.updatedAt)}</div>
          <div class="history-card-actions">
            <button class="btn" type="button" data-load="${item.date}">编辑</button>
          </div>
        </article>
      `).join("");
    }

    function formatUpdatedAt(value) {
      if (!value) return "--";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "--";
      const pad = (number) => String(number).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function renderWeeklySummary() {
      const recent = getWindowRecords(7);
      const weightItems = recent.filter((item) => item.weight !== null);
      const stepItems = recent.filter((item) => item.steps !== null);
      const recordDays = recent.length;
      const avgWeight = weightItems.length
        ? weightItems.reduce((sum, item) => sum + item.weight, 0) / weightItems.length
        : null;
      const avgSteps = stepItems.length
        ? stepItems.reduce((sum, item) => sum + item.steps, 0) / stepItems.length
        : null;
      const cardioTotal = recent.reduce((sum, item) => sum + (item.cardio ?? 0), 0);
      const strengthCount = recent.filter((item) => item.strength).length;

      $("#weeklyRecordDays").textContent = String(recordDays);
      $("#weeklyAvgWeight").textContent = avgWeight === null ? "--" : avgWeight.toFixed(1);
      $("#weeklyAvgSteps").textContent = avgSteps === null ? "--" : Math.round(avgSteps).toString();
      $("#weeklyCardioTotal").textContent = String(cardioTotal);
      $("#weeklyStrengthCount").textContent = String(strengthCount);

      if (recordDays < 3) {
        $("#weeklySummaryText").textContent = "本周数据不足，先继续积累记录。";
      } else if ((avgSteps ?? 0) >= 8000) {
        $("#weeklySummaryText").textContent = "本周记录与活动量较稳定，继续观察体重均值趋势。";
      } else if ((avgSteps ?? 0) < 8000) {
        $("#weeklySummaryText").textContent = "本周日常活动偏少，优先把平均步数拉到 8000 以上。";
      } else {
        $("#weeklySummaryText").textContent = "本周已有基础记录，继续看体重和腰围趋势。";
      }
      $("#weeklySummaryHint").textContent = recordDays ? `最近 ${recordDays} 天` : "最近 7 天";
    }

    function getRecentRecordsForAi(days) {
      const sorted = sortedRecords();
      if (!sorted.length) return [];
      const windowed = getWindowRecords(days);
      return windowed.length ? windowed : sorted.slice(-days);
    }

    function formatPromptNumber(value, digits = 1, unit = "") {
      const number = toNumber(value);
      return number === null ? "未记录" : `${number.toFixed(digits)}${unit}`;
    }

    function formatPromptInteger(value, unit = "") {
      const number = toNumber(value);
      return number === null ? "未记录" : `${Math.round(number)}${unit}`;
    }

    function formatRecordsForPrompt(recordsSubset) {
      if (!recordsSubset.length) return "暂无记录。";
      return recordsSubset.map((record) => [
        `日期：${record.date || "未记录"}`,
        `体重：${formatPromptNumber(record.weight, 1, "斤")}`,
        `腰围：${formatPromptNumber(record.waist, 1, "cm")}`,
        `步数：${formatPromptInteger(record.steps)}`,
        `有氧分钟：${formatPromptInteger(record.cardio, "分钟")}`,
        `力量训练：${record.strength ? "是" : "否"}`,
        `训练类型：${record.trainingType || "未记录"}`
      ].join("；")).join("\n");
    }

    function averageBy(recordsSubset, getter) {
      const values = recordsSubset.map((item) => toNumber(getter(item))).filter((value) => value !== null);
      if (!values.length) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    function currentWeeklySpeedForPrompt() {
      const weighted = sortedRecords().filter((item) => item.weight !== null).slice(-30);
      if (weighted.length < 2) return null;
      const first = weighted[0];
      const latest = weighted[weighted.length - 1];
      const days = Math.max(1, daysBetween(first.date, latest.date));
      return ((first.weight - latest.weight) / days) * 7;
    }

    function buildAiMetrics() {
      const weighted = sortedRecords().filter((item) => item.weight !== null);
      const latest = weighted[weighted.length - 1] || null;
      const latestDate = latest ? latest.date : todayString();
      const recent7 = getRecentRecordsForAi(7);
      const avg3 = averageWeight(3, latestDate);
      const avg7 = averageWeight(7, latestDate);
      const avgSteps7 = averageBy(recent7, (item) => item.steps);
      const cardioTotal7 = recent7.reduce((sum, item) => sum + (toNumber(item.cardio) ?? 0), 0);
      const strengthCount7 = recent7.filter((item) => item.strength).length;
      const target = toNumber(settings.targetWeight);
      const targetGap = latest && target !== null ? Math.max(0, latest.weight - target) : null;
      const weeklySpeed = currentWeeklySpeedForPrompt();
      const long = longTermMetrics();

      return [
        `已记录天数：${long ? `${long.elapsedDays}天` : "记录不足"}`,
        `记录次数：${long ? `${long.recordCount}次` : "0次"}`,
        `起始体重：${long ? `${long.first.weight.toFixed(1)}斤` : "记录不足"}`,
        `当前体重：${long ? `${long.latest.weight.toFixed(1)}斤` : "记录不足"}`,
        `累计变化：${long ? `${formatSignedChange(long.change)}斤` : "记录不足"}`,
        `最高 / 最低体重：${long ? `${long.highest.toFixed(1)}斤 / ${long.lowest.toFixed(1)}斤` : "记录不足"}`,
        `最近 7 天变化：${long && long.stage7.change !== null ? `${formatSignedChange(long.stage7.change)}斤` : "数据不足"}`,
        `最近 30 天变化：${long && long.stage30.change !== null ? `${formatSignedChange(long.stage30.change)}斤` : "数据不足"}`,
        `全周期变化：${long && long.stageAll.change !== null ? `${formatSignedChange(long.stageAll.change)}斤` : "数据不足"}`,
        `目标完成进度：${long && long.progress !== null ? `${Math.round(long.progress)}%` : "未设置或数据不足"}`,
        `3 日均重：${avg3 === null ? "记录不足" : `${avg3.toFixed(1)}斤`}`,
        `7 日均重：${avg7 === null ? "记录不足" : `${avg7.toFixed(1)}斤`}`,
        `最近 7 天平均步数：${avgSteps7 === null ? "记录不足" : Math.round(avgSteps7)}`,
        `最近 7 天有氧总分钟：${cardioTotal7}分钟`,
        `最近 7 天力量训练次数：${strengthCount7}次`,
        `距离目标还差：${targetGap === null ? "未设置或无体重记录" : `${targetGap.toFixed(1)}斤`}`,
        `当前减脂速度：${weeklySpeed === null ? "记录不足" : `${weeklySpeed.toFixed(2)}斤/周`}`
      ].join("\n");
    }

    function buildAiPrompt(type) {
      const promptTypes = {
        week: {
          title: "最近 7 天减脂复盘",
          days: 7,
          question: "请帮我判断最近 7 天减脂趋势是否正常，执行上最大的问题是什么，明天最应该做哪 3 件事。"
        },
        month: {
          title: "最近 30 天减脂复盘",
          days: 30,
          question: "请结合全周期背景，判断最近 30 天趋势和减脂速度是否合适，训练与活动节奏是否需要调整。"
        },
        all: {
          title: "全周期减脂复盘",
          days: "all",
          question: "请帮我复盘整个减脂周期：判断长期趋势、阶段变化、执行稳定性和目标进度，并给出下一阶段最重要的 3 项行动。"
        },
        plateau: {
          title: "平台期排查",
          days: 30,
          question: "请判断我是否真的进入平台期。请区分脂肪不降、水分波动、执行不足、训练疲劳这几种可能，并给出排查顺序。"
        }
      };
      const config = promptTypes[type] || promptTypes.week;
      const recent = config.days === "all" ? sortedRecords() : getRecentRecordsForAi(config.days);
      const rangeNote = type === "plateau"
        ? "优先参考最近 14-30 天记录"
        : config.days === "all" ? "全部历史记录" : `参考最近 ${config.days} 天记录`;

      return [
        `# ${config.title}`,
        "",
        "## 用户背景",
        "我正在减脂。以下数据来自我的个人减脂记录网页。",
        "请你像一个理性、谨慎的减脂教练一样分析。",
        "不要过度解读单日体重波动，优先看长期趋势、阶段变化、执行稳定性和恢复风险。",
        "",
        "## 目标设置",
        `起始体重：${formatPromptNumber(settings.startWeight, 1, "斤")}`,
        `目标体重：${formatPromptNumber(settings.targetWeight, 1, "斤")}`,
        `目标日期：${settings.targetDate || "未设置"}`,
        "",
        "## 已计算指标",
        buildAiMetrics(),
        "",
        `## 记录数据（${rangeNote}）`,
        formatRecordsForPrompt(recent),
        "",
        "## 请回答",
        config.question,
        "请给出具体、可执行、不过度极端的建议。"
      ].join("\n");
    }

    async function copyAiPrompt(type) {
      const prompt = buildAiPrompt(type);
      const textarea = $("#aiPromptText");
      textarea.value = prompt;
      document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
        button.classList.toggle("active", button.dataset.aiPrompt === type);
      });
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard API unavailable");
        await navigator.clipboard.writeText(prompt);
        toast("Prompt 已生成并复制。");
      } catch {
        textarea.focus();
        textarea.select();
        toast("Prompt 已生成，自动复制失败，可手动复制。");
      }
    }

    async function copyCurrentAiPrompt() {
      const prompt = $("#aiPromptText").value;
      if (!prompt) {
        toast("请先生成 Prompt。");
        return;
      }
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard API unavailable");
        await navigator.clipboard.writeText(prompt);
        toast("当前 Prompt 已复制。");
      } catch {
        $("#aiPromptText").focus();
        $("#aiPromptText").select();
        toast("自动复制失败，请手动复制。");
      }
    }

    function renderAll(preferredRecord) {
      renderCharts();
      renderProgress();
      renderLossBreakdown();
      renderLongTermOverview();
      renderGoalSummary();
      renderHistory();
      renderWeeklySummary();
    }

    function toast(message, action) {
      const el = $("#toast");
      el.textContent = message;
      if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "toast-action";
        button.textContent = action.label;
        button.addEventListener("click", () => {
          action.onClick();
          el.classList.remove("show");
        }, { once: true });
        el.appendChild(button);
      }
      el.classList.add("show");
      window.clearTimeout(toast.timer);
      toast.timer = window.setTimeout(() => el.classList.remove("show"), action ? 5200 : 2200);
    }

    function populateGoalEditor() {
      if (settings.startWeight !== undefined && settings.startWeight !== null) {
        setStepperManualValue("startWeight", settings.startWeight, defaultWeightValue());
      } else {
        setStepperValue("startWeight", defaultWeightValue(), defaultWeightValue());
      }
      if (settings.targetWeight !== undefined && settings.targetWeight !== null) {
        setStepperManualValue("targetWeight", settings.targetWeight, Math.max(80, defaultWeightValue() - 10));
      } else {
        setStepperValue("targetWeight", Math.max(80, defaultWeightValue() - 10), 140);
      }
      $("#targetDate").value = settings.targetDate ?? "";
    }

    function initializeForm() {
      fields.date.value = todayString();
      populateGoalEditor();
      setGoalEditorOpen(false);
      const today = records.find((item) => item.date === fields.date.value);
      if (today) {
        fillForm(today);
      } else {
        setStepperManualValue("weight", defaultWeightValue(), 140);
        ["waist", "steps", "neck", "hip", "thigh", "arm", "cardio"].forEach(clearStepperValue);
        hasCardio.value = "no";
        fields.strength.checked = false;
        fields.trainingType.value = "力量";
        updateCardioDetails();
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const record = recordFromForm();
      if (record.weight === null) {
        toast("请填写体重。");
        return;
      }
      upsertRecord(record);
      if (!settings.startWeight) {
        settings.startWeight = record.weight;
        setStepperManualValue("startWeight", record.weight, record.weight);
        saveSettings();
      }
      renderAll(record);
      setActiveTab("trend");
      try {
        const backup = await writeRecordBackup(record);
        renderBackupStatus();
        toast(backup.skipped ? `已保存，已更新长期趋势；${backup.reason}。` : "已保存，已更新长期趋势。");
      } catch (error) {
        renderBackupStatus("本地已保存，备份写入失败");
        toast("本地已保存，但备份写入失败。");
      }
    });

    $("#backupFolderBtn").addEventListener("click", async () => {
      if (!supportsFileBackup()) {
        toast("当前浏览器不支持自动文件夹备份。");
        renderBackupStatus();
        return;
      }
      try {
        backupDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
        const allowed = await ensureBackupPermission(backupDirectoryHandle, true);
        if (!allowed) {
          backupDirectoryHandle = null;
          renderBackupStatus("未获得备份文件夹权限");
          toast("未获得备份文件夹权限。");
          return;
        }
        await storeBackupDirectoryHandle(backupDirectoryHandle);
        renderBackupStatus("本地保存，文件夹备份已设置");
        toast("备份文件夹已设置。之后每次保存都会写入新文件。");
      } catch (error) {
        renderBackupStatus();
        toast("未选择备份文件夹。");
      }
    });

    $("#saveSettingsBtn").addEventListener("click", () => {
      syncManualStepperValues();
      settings.startWeight = toNumber($("#startWeight").value);
      settings.targetWeight = toNumber($("#targetWeight").value);
      settings.targetDate = $("#targetDate").value;
      saveSettings();
      renderProgress();
      renderLongTermOverview();
      renderGoalSummary();
      setGoalEditorOpen(false);
      toast("目标已保存。");
    });

    $("#editGoalBtn").addEventListener("click", () => {
      populateGoalEditor();
      setGoalEditorOpen(true);
    });
    $("#cancelGoalEditBtn").addEventListener("click", () => {
      populateGoalEditor();
      setGoalEditorOpen(false);
    });

    $("#openDataManagerBtn").addEventListener("click", () => setDataView("manager"));
    $("#backFromDataManagerBtn").addEventListener("click", () => setDataView("overview"));
    $("#openAdvancedSettingsBtn").addEventListener("click", () => setDataView("advanced"));
    $("#backFromAdvancedBtn").addEventListener("click", () => setDataView("overview"));

    $("#copyPreviousBtn").addEventListener("click", copyPreviousData);

    document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
      button.addEventListener("click", () => copyAiPrompt(button.dataset.aiPrompt));
    });

    $("#clearAiPromptBtn").addEventListener("click", () => {
      $("#aiPromptText").value = "";
      document.querySelectorAll("[data-ai-prompt]").forEach((button) => button.classList.remove("active"));
      toast("Prompt 已清空。");
    });
    $("#copyCurrentAiPromptBtn").addEventListener("click", copyCurrentAiPrompt);

    userSelect.addEventListener("change", (event) => {
      switchUser(event.target.value);
    });

    hasCardio.addEventListener("change", updateCardioDetails);

    document.querySelector(".tab-nav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (!button) return;
      setActiveTab(button.dataset.tab);
    });

    $("#range7").addEventListener("click", () => {
      chartRange = 7;
      document.querySelectorAll(".segmented button").forEach((button) => button.classList.toggle("active", button.id === "range7"));
      renderCharts();
    });

    $("#range30").addEventListener("click", () => {
      chartRange = 30;
      document.querySelectorAll(".segmented button").forEach((button) => button.classList.toggle("active", button.id === "range30"));
      renderCharts();
    });

    $("#rangeAll").addEventListener("click", () => {
      chartRange = "all";
      document.querySelectorAll(".segmented button").forEach((button) => button.classList.toggle("active", button.id === "rangeAll"));
      renderCharts();
    });

    function handleHistoryClick(event) {
      const loadDate = event.target.dataset.load;
      if (loadDate) {
        const record = records.find((item) => item.date === loadDate);
        fillForm(record);
        setActiveTab("record");
      }
    }

    function deleteRecordByDate(deleteDate) {
      const deletedIndex = records.findIndex((item) => item.date === deleteDate);
      const deletedRecord = records[deletedIndex];
      if (!deletedRecord) return;
      lastDeletedRecord = { record: deletedRecord, index: deletedIndex };
      records = records.filter((item) => item.date !== deleteDate);
      saveRecords();
      renderAll();
      toast("记录已删除。", {
        label: "撤销",
        onClick: () => {
          if (!lastDeletedRecord) return;
          const exists = records.some((item) => item.date === lastDeletedRecord.record.date);
          if (!exists) {
            records.splice(Math.min(lastDeletedRecord.index, records.length), 0, lastDeletedRecord.record);
            saveRecords();
            renderAll(lastDeletedRecord.record);
            toast("已撤销删除。");
          }
          lastDeletedRecord = null;
        }
      });
    }

    $("#historyBody").addEventListener("click", handleHistoryClick);
    $("#historyCards").addEventListener("click", handleHistoryClick);

    function buildExportPayload() {
      return {
        user: currentUser,
        data: records,
        settings,
        weightUnitVersion: WEIGHT_UNIT_VERSION,
        weightUnit: "斤",
        exportedAt: new Date().toISOString()
      };
    }

    function downloadDataFile(prefix = "fat-loss-tracker") {
      const data = JSON.stringify(buildExportPayload(), null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${prefix}-${currentUser}-${todayString()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }

    $("#exportBtn").addEventListener("click", () => {
      downloadDataFile();
    });

    $("#importBtn").addEventListener("click", () => {
      const proceed = confirm("导入会按日期合并记录；同日期记录可能按更新时间覆盖。继续前会自动下载一份当前数据备份。是否继续？");
      if (!proceed) return;
      downloadDataFile("pre-import-backup");
      $("#importFile").click();
    });

    function importedRecordsFromPayload(imported) {
      if (Array.isArray(imported)) return imported;
      if (Array.isArray(imported.data)) return imported.data;
      if (Array.isArray(imported.records)) return imported.records;
      return [];
    }

    function payloadUsesJin(imported) {
      return Boolean(imported && typeof imported === "object" && (
        imported.weightUnitVersion === WEIGHT_UNIT_VERSION ||
        imported.weightUnit === "斤" ||
        imported.unit === "jin"
      ));
    }

    function recordUpdatedTime(record) {
      const time = Date.parse(record.updatedAt || "");
      return Number.isFinite(time) ? time : null;
    }

    function mergeImportedRecords(importedList) {
      const byDate = new Map(records.map((record) => [record.date, record]));
      let added = 0;
      let replaced = 0;
      let kept = 0;
      let unresolved = 0;
      let replaceUnresolved = false;

      const conflictsWithoutTime = importedList.filter((record) => {
        if (!record.date || !byDate.has(record.date)) return false;
        const localTime = recordUpdatedTime(byDate.get(record.date));
        const importedTime = recordUpdatedTime(record);
        return localTime === null || importedTime === null;
      });

      if (conflictsWithoutTime.length) {
        unresolved = conflictsWithoutTime.length;
        replaceUnresolved = confirm(`导入数据中有 ${unresolved} 条同日期记录无法判断更新时间。是否用导入记录替换本地记录？取消则保留本地记录。`);
      }

      importedList.forEach((rawRecord) => {
        if (!rawRecord || !rawRecord.date) return;
        const record = { ...rawRecord, user: currentUser };
        const localRecord = byDate.get(record.date);
        if (!localRecord) {
          byDate.set(record.date, record);
          added += 1;
          return;
        }

        const localTime = recordUpdatedTime(localRecord);
        const importedTime = recordUpdatedTime(record);
        if (localTime !== null && importedTime !== null) {
          if (importedTime >= localTime) {
            byDate.set(record.date, record);
            replaced += 1;
          } else {
            kept += 1;
          }
          return;
        }

        if (replaceUnresolved) {
          byDate.set(record.date, record);
          replaced += 1;
        } else {
          kept += 1;
        }
      });

      records = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      return { added, replaced, kept, unresolved };
    }

    $("#importFile").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const imported = JSON.parse(await file.text());
        let importedList = importedRecordsFromPayload(imported);
        let importedSettings = imported && typeof imported === "object" && imported.settings && typeof imported.settings === "object"
          ? imported.settings
          : null;
        if (!payloadUsesJin(imported) && (importedList.length || importedSettings)) {
          const convertLegacyWeight = confirm("导入文件没有“斤”单位标记，可能是旧公斤数据。是否按公斤转换为斤？取消则按原值导入。");
          if (convertLegacyWeight) {
            importedList = importedList.map(convertRecordWeightToJin);
            importedSettings = convertSettingsWeightToJin(importedSettings);
          }
        }
        const result = mergeImportedRecords(importedList);
        if (importedSettings && confirm("是否同时导入目标设置？")) {
          settings = importedSettings;
        }
        saveRecords();
        saveSettings();
        initializeForm();
        renderAll();
        toast(`导入完成：新增 ${result.added}，更新 ${result.replaced}，保留 ${result.kept}。`);
      } catch {
        toast("导入失败，请检查 JSON 文件。");
      } finally {
        event.target.value = "";
      }
    });

    function closeDeleteDialog() {
      $("#deleteConfirmDialog").classList.add("hidden");
      $("#deleteConfirmationInput").value = "";
      pendingDeleteDate = null;
    }

    $("#requestDeleteRecordBtn").addEventListener("click", () => {
      const selectedDate = $("#deleteRecordSelect").value;
      if (!selectedDate) {
        toast("请先选择要删除的记录。");
        return;
      }
      pendingDeleteDate = selectedDate;
      $("#deleteDialogDate").textContent = selectedDate;
      $("#deleteConfirmDialog").classList.remove("hidden");
      $("#deleteConfirmationInput").focus();
    });

    $("#cancelDeleteBtn").addEventListener("click", closeDeleteDialog);

    $("#confirmDeleteBtn").addEventListener("click", () => {
      if ($("#deleteConfirmationInput").value !== "DELETE" || !pendingDeleteDate) {
        toast("未删除记录。");
        return;
      }
      const deleteDate = pendingDeleteDate;
      closeDeleteDialog();
      deleteRecordByDate(deleteDate);
    });

    function closeClearDialog() {
      $("#clearConfirmDialog").classList.add("hidden");
      $("#clearConfirmationInput").value = "";
    }

    $("#clearBtn").addEventListener("click", () => {
      $("#clearConfirmDialog").classList.remove("hidden");
      $("#clearConfirmationInput").focus();
    });

    $("#cancelClearBtn").addEventListener("click", closeClearDialog);

    $("#confirmClearBtn").addEventListener("click", () => {
      if ($("#clearConfirmationInput").value !== "CLEAR") {
        toast("未清空数据。");
        return;
      }
      records = [];
      settings = {};
      saveRecords();
      saveSettings();
      initializeForm();
      renderAll();
      closeClearDialog();
      setDataView("overview");
      toast("已清空。");
    });

    async function initializeBackup() {
      try {
        backupDirectoryHandle = await loadBackupDirectoryHandle();
        const allowed = await ensureBackupPermission(backupDirectoryHandle, false);
        if (!allowed) backupDirectoryHandle = null;
      } catch {
        backupDirectoryHandle = null;
      }
      renderBackupStatus();
    }

    function initializeApp() {
      syncUserSelectors();
      migrateWeightUnitForUser();
      records = loadRecords();
      settings = loadSettings();
      if (appInitialized) {
        initializeForm();
        renderAll();
        return;
      }
      initializeSteppers();
      initializeForm();
      renderAll();
      initializeBackup();
      appInitialized = true;
    }

    function showApp() {
      authScreen.classList.add("hidden");
      appShell.classList.remove("hidden");
      initializeApp();
    }

    function showLogin() {
      authScreen.classList.remove("hidden");
      appShell.classList.add("hidden");
      passwordInput.focus();
    }

    function initializeAuth() {
      syncUserSelectors();
      loginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (passwordInput.value === PASSWORD) {
          currentUser = loginUserSelect.value;
          localStorage.setItem(CURRENT_USER_KEY, currentUser);
          localStorage.setItem(AUTH_KEY, "true");
          authError.textContent = "";
          passwordInput.value = "";
          showApp();
        } else {
          localStorage.removeItem(AUTH_KEY);
          authError.textContent = "Access Denied";
        }
      });

      if (localStorage.getItem(AUTH_KEY) === "true") {
        showApp();
      } else {
        showLogin();
      }
    }

    initializeAuth();

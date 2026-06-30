const PASSWORD = "123456";
const AUTH_KEY = "ai-fat-loss-tracker-authenticated-v1";
const CURRENT_USER_KEY = "ai-fat-loss-tracker-current-user-v1";
const DEFAULT_USERS = ["test", "main"];
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
      trainingType: $("#trainingType"),
      dietControlled: $("#dietControlled")
    };

    let currentUser = localStorage.getItem(CURRENT_USER_KEY) || "main";
    if (!DEFAULT_USERS.includes(currentUser)) currentUser = "main";
    let records = [];
    let settings = {};
    let chartRange = 7;
    let weightChart;
    let waistChart;
    let stepsChart;
    let backupDirectoryHandle = null;
    let appInitialized = false;
    let steppersInitialized = false;
    let lastDeletedRecord = null;
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
      return latest && latest.weight !== null ? latest.weight : 70;
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
      const base = numeric === null ? fallback : numeric;
      const stepped = Math.round(base / config.step) * config.step;
      return clamp(stepped, config.min, config.max);
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

    function changeStepperValue(target, direction) {
      const config = stepperConfig(target);
      if (!config) return;
      const current = toNumber(config.input.value) ?? config.min;
      setStepperValue(target, current + direction * config.step, current);
    }

    function setActiveTab(tab) {
      activeTab = tab;
      appRoot.classList.remove("view-record", "view-advice", "view-trend", "view-data");
      appRoot.classList.add(`view-${tab}`);
      document.querySelectorAll("[data-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === tab);
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (tab === "trend") {
        renderCharts();
        window.setTimeout(() => {
          [weightChart, waistChart, stepsChart].forEach((chart) => chart && chart.resize());
        }, 80);
      }
      if (tab === "data") renderHistory();
    }

    function updateCardioDetails() {
      const enabled = hasCardio.value === "yes";
      document.querySelectorAll(".cardio-detail").forEach((element) => {
        element.classList.toggle("hidden", !enabled);
      });
      if (!enabled) {
        setStepperValue("cardio", 0, 0);
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
          setStepperValue(input.dataset.manualFor, input.value, input.value);
        });
      });

      document.querySelectorAll("[data-quick-for]").forEach((group) => {
        group.addEventListener("click", (event) => {
          const button = event.target.closest("[data-quick-value]");
          if (!button) return;
          setStepperValue(group.dataset.quickFor, button.dataset.quickValue, button.dataset.quickValue);
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

    function syncUserSelectors() {
      loginUserSelect.value = currentUser;
      userSelect.value = currentUser;
    }

    function switchUser(userId) {
      if (!DEFAULT_USERS.includes(userId)) return;
      currentUser = userId;
      localStorage.setItem(CURRENT_USER_KEY, currentUser);
      syncUserSelectors();
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
      updateCardioDetails();
      const carbInput = document.querySelector("input[name='carbLevel']:checked");
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
        cardio: toNumber(fields.cardio.value),
        trainingType: fields.trainingType.value,
        dietControlled: fields.dietControlled.value,
        carbLevel: carbInput ? carbInput.value : "低",
        updatedAt: new Date().toISOString()
      };
    }

    function fillForm(record) {
      if (!record) return;
      fields.date.value = record.date || todayString();
      setStepperValue("weight", record.weight, defaultWeightValue());
      setStepperValue("waist", record.waist, 80);
      setStepperValue("steps", record.steps, 8000);
      setStepperValue("neck", record.neck, 35);
      setStepperValue("hip", record.hip, 95);
      setStepperValue("thigh", record.thigh, 55);
      setStepperValue("arm", record.arm, 30);
      setStepperValue("cardio", record.cardio, 0);
      hasCardio.value = (record.cardio ?? 0) > 0 ? "yes" : "no";
      fields.strength.checked = Boolean(record.strength);
      fields.trainingType.value = record.trainingType || "力量";
      fields.dietControlled.value = record.dietControlled || "yes";
      const carb = document.querySelector(`input[name='carbLevel'][value='${record.carbLevel || "低"}']`);
      if (carb) carb.checked = true;
      updateCardioDetails();
    }

    function copyPreviousData() {
      const currentDate = fields.date.value || todayString();
      const previous = sortedRecords().filter((item) => item.date < currentDate).pop() || latestRecord();
      if (!previous) {
        toast("暂无历史记录可复制。");
        return;
      }

      fields.date.value = todayString();
      setStepperValue("weight", previous.weight, defaultWeightValue());
      setStepperValue("waist", previous.waist, 80);
      setStepperValue("neck", previous.neck, 35);
      setStepperValue("hip", previous.hip, 95);
      setStepperValue("thigh", previous.thigh, 55);
      setStepperValue("arm", previous.arm, 30);
      setStepperValue("steps", previous.steps, 8000);
      setStepperValue("cardio", previous.cardio, 0);
      fields.strength.checked = Boolean(previous.strength);
      fields.trainingType.value = previous.trainingType || "力量";
      fields.dietControlled.value = previous.dietControlled || "yes";
      const carb = document.querySelector(`input[name='carbLevel'][value='${previous.carbLevel || "低"}']`);
      if (carb) carb.checked = true;
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

    function isPlateau(record) {
      const throughDate = sortedRecords()
        .filter((item) => item.date <= record.date && item.weight !== null)
        .slice(-7);
      if (throughDate.length < 7) return false;
      const first = throughDate[0].weight;
      const last = throughDate[throughDate.length - 1].weight;
      return last >= first;
    }

    function isWaistImproving(record) {
      const recent = sortedRecords()
        .filter((item) => item.date <= record.date && item.waist !== null)
        .slice(-7);
      if (recent.length < 2) return false;
      return recent[recent.length - 1].waist < recent[0].waist;
    }

    function averageWeight(days, throughDate) {
      const recent = sortedRecords()
        .filter((item) => item.date <= throughDate && item.weight !== null)
        .slice(-days);
      if (recent.length < days) return null;
      return recent.reduce((sum, item) => sum + item.weight, 0) / recent.length;
    }

    function recentRecords(days, throughDate) {
      return sortedRecords().filter((item) => item.date <= throughDate).slice(-days);
    }

    function countRecent(recordsList, predicate) {
      return recordsList.filter(predicate).length;
    }

    function analyze(record) {
      if (!record) return null;

      const plateau = isPlateau(record);
      const waistImproving = isWaistImproving(record);
      const weightRecordCount = sortedRecords().filter((item) => item.date <= record.date && item.weight !== null).length;
      const avg3 = averageWeight(3, record.date);
      const avg7 = averageWeight(7, record.date);
      const last3 = recentRecords(3, record.date);
      const lowStepDays = countRecent(last3, (item) => (item.steps ?? 0) < 8000);
      const highCardioDays = countRecent(last3, (item) => (item.cardio ?? 0) > 90);
      const highTrainingLoad = record.cardio > 90 || (record.trainingType === "HIIT" && record.cardio >= 45);
      let status = "CUT";
      let statusReason = waistImproving ? "腰围趋势在下降，减脂仍在推进。" : "今天早上的体重和围度已记录，继续观察趋势。";

      if (highTrainingLoad) {
        status = "RECOVERY";
        statusReason = "昨天训练负荷偏高，今天优先恢复与控制疲劳。";
      } else if (plateau) {
        status = "PLATEAU";
        statusReason = "最近 7 条体重记录未下降，进入平台期观察。";
      } else if (record.dietControlled !== "yes" && !waistImproving) {
        status = "MAINTAIN";
        statusReason = "饮食控制未开启，且围度暂未显示下降。";
      }

      let risk = "LOW";
      const riskReasons = [];
      if (record.cardio > 90) {
        risk = "MEDIUM";
        riskReasons.push("昨日有氧超过 90 分钟");
      }
      if (record.trainingType === "HIIT" && record.cardio >= 45) {
        risk = "HIGH";
        riskReasons.push("昨日 HIIT 时间偏长");
      }

      const trainOk = status !== "RECOVERY" && record.cardio <= 75;
      let cardioAdvice = "建议 30-45 分钟 Zone2。";
      if (status === "RECOVERY") cardioAdvice = "建议休息或 20-30 分钟轻松步行。";
      if (status === "PLATEAU") cardioAdvice = "建议 45-60 分钟 Zone2，先不堆到 90 分钟以上。";
      if (record.cardio > 90) cardioAdvice = "昨天有氧已偏高，今天控制在 45-60 分钟。";

      let carbAdvice = "今天不需要额外增加碳水。";
      if (status === "RECOVERY" || record.trainingType === "HIIT") {
        carbAdvice = "建议增加约 30g 碳水，优先放在训练前后或晚餐。";
      } else if (status === "PLATEAU" && record.carbLevel === "低") {
        carbAdvice = "可安排一次增加约 30g 碳水的训练日，观察体重和腰围波动。";
      }

      const targets = [
        record.steps >= 8000,
        record.dietControlled === "yes",
        record.cardio <= 90,
        record.waist !== null
      ];
      const passed = targets.filter(Boolean).length;

      const mainAdvice = [
        trainOk ? "今天可以训练，强度以可恢复为边界。" : "今天不适合高强度训练，恢复优先。",
        risk === "HIGH" ? "昨天负荷偏高，今天先降低强度。" : "昨日训练负荷可控，继续稳定执行。",
        status === "PLATEAU" ? "平台期先看 7-14 天均值，并同步看腰围变化。" : "继续看体重和围度双趋势，不用过度解读单日体重。"
      ].join(" ");

      const trendMessages = [];
      if (weightRecordCount < 3) {
        trendMessages.push("记录不足 3 条，先积累数据。");
      } else if (avg3 !== null) {
        trendMessages.push(`3日均重 ${avg3.toFixed(1)}kg`);
      }
      if (weightRecordCount < 7) {
        trendMessages.push("7 日趋势需要更多记录。");
      } else if (avg7 !== null) {
        trendMessages.push(`7日均重 ${avg7.toFixed(1)}kg`);
      }
      if (plateau && waistImproving) {
        trendMessages.push("体重不降但腰围下降，可能仍在减脂，不必只看体重。");
      }
      if (lowStepDays >= 2) {
        trendMessages.push("最近多日步数不足，建议提高日常活动量。");
      }
      if (highCardioDays >= 2) {
        trendMessages.push("最近多日有氧偏高，注意恢复。");
      }
      if (!trendMessages.length) {
        trendMessages.push("继续看均值趋势，避免对单日体重波动作强结论。");
      }

      return {
        status,
        statusReason,
        risk,
        riskReason: riskReasons.length ? riskReasons.join("；") : "昨日有氧和训练类型在可控范围。",
        trainToday: trainOk ? "适合" : "恢复",
        trainReason: trainOk ? "训练负荷可控" : "今日有氧或 HIIT 负荷偏高",
        cardioAdvice,
        carbAdvice,
        mainAdvice,
        trendAdvice: trendMessages.join(" "),
        avg3,
        avg7,
        dailyScore: `${passed}/4`,
        dailyScoreNote: passed >= 4 ? "达标很好" : passed >= 3 ? "基本达标" : "昨日执行偏弱"
      };
    }

    function renderAnalysis(record) {
      const result = analyze(record);
      if (!result) return;

      $("#analysisDate").textContent = record.date;
      const pill = $("#statusPill");
      pill.textContent = result.status;
      pill.className = "status-pill";
      if (result.status === "CUT") pill.classList.add("status-cut");
      if (result.status === "PLATEAU") pill.classList.add("status-plateau");
      if (result.status === "RECOVERY") pill.classList.add("status-recovery");

      $("#statusReason").textContent = result.statusReason;
      $("#trainToday").textContent = result.trainToday;
      $("#trainReason").textContent = result.trainReason;
      $("#riskLevel").textContent = result.risk;
      $("#riskReason").textContent = result.riskReason;
      $("#riskLevel").style.color = result.risk === "HIGH" ? "var(--bad)" : result.risk === "MEDIUM" ? "var(--warn)" : "var(--good)";
      $("#dailyScore").textContent = result.dailyScore;
      $("#dailyScoreNote").textContent = result.dailyScoreNote;
      $("#cardioAdvice").textContent = result.cardioAdvice;
      $("#carbAdvice").textContent = result.carbAdvice;
      $("#mainAdvice").textContent = result.mainAdvice;
      $("#trendAdvice").textContent = result.trendAdvice;
      $("#avg3Weight").textContent = result.avg3 === null ? "--" : result.avg3.toFixed(1);
      $("#avg7Weight").textContent = result.avg7 === null ? "--" : result.avg7.toFixed(1);
    }

    function resetAnalysis() {
      $("#analysisDate").textContent = "等待今日记录";
      const pill = $("#statusPill");
      pill.textContent = "--";
      pill.className = "status-pill";
      $("#statusReason").textContent = "保存记录后生成";
      $("#trainToday").textContent = "--";
      $("#trainReason").textContent = "--";
      $("#riskLevel").textContent = "--";
      $("#riskReason").textContent = "--";
      $("#riskLevel").style.color = "";
      $("#dailyScore").textContent = "--";
      $("#dailyScoreNote").textContent = "--";
      $("#cardioAdvice").textContent = "--";
      $("#carbAdvice").textContent = "--";
      $("#mainAdvice").textContent = "--";
      $("#trendAdvice").textContent = "--";
      $("#avg3Weight").textContent = "--";
      $("#avg7Weight").textContent = "--";
    }

    function getWindowRecords(days) {
      const sorted = sortedRecords();
      if (!sorted.length) return [];
      const end = new Date(sorted[sorted.length - 1].date + "T00:00:00");
      const start = new Date(end);
      start.setDate(end.getDate() - days + 1);
      return sorted.filter((item) => new Date(item.date + "T00:00:00") >= start);
    }

    function chartConfig(label, data, color) {
      return {
        type: "line",
        data: {
          labels: data.map((item) => item.date.slice(5)),
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
      weightChart = buildChart("#weightChart", weightChart, "体重 kg", windowed.map((item) => ({ date: item.date, value: item.weight })), "#171717");
      waistChart = buildChart("#waistChart", waistChart, "腰围 cm", windowed.map((item) => ({ date: item.date, value: item.waist })), "#6b6b65");
      stepsChart = buildChart("#stepsChart", stepsChart, "步数", windowed.map((item) => ({ date: item.date, value: item.steps })), "#3e3e3a");
    }

    function formatDate(date) {
      return date.toISOString().slice(0, 10);
    }

    function daysBetween(startDate, endDate) {
      const dayMs = 24 * 60 * 60 * 1000;
      return Math.round((new Date(endDate + "T00:00:00") - new Date(startDate + "T00:00:00")) / dayMs);
    }

    function kg(value) {
      return `${value.toFixed(1)}`;
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
        $("#dailyDrop").textContent = dailyDrop > 0 ? kg(dailyDrop) : "0.0";
        $("#dailyDropNote").textContent = dailyDrop >= 0 ? "kg，较昨天早上" : `比昨天增加 ${kg(Math.abs(dailyDrop))}kg`;
      } else {
        $("#dailyDrop").textContent = "--";
        $("#dailyDropNote").textContent = "需要昨天记录";
      }

      $("#totalLoss").textContent = totalLoss > 0 ? kg(totalLoss) : "0.0";
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
      $("#remainingLoss").textContent = kg(remaining);

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
        $("#dailyTaskNote").textContent = "kg / 天";
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
        $("#progressStart").textContent = "当前 -- kg";
        $("#progressTarget").textContent = "目标 -- kg";
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

      $("#progressStart").textContent = `当前 ${latest.weight.toFixed(1)} kg`;
      $("#progressTarget").textContent = `目标 ${target.toFixed(1)} kg`;
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
        $("#targetPlanNote").textContent = `节奏可达，还需 ${requiredWeekly.toFixed(2)}kg/周`;
      } else {
        $("#targetPlanNote").textContent = `需约 ${requiredWeekly.toFixed(2)}kg/周`;
      }
    }

    function renderHistory() {
      const body = $("#historyBody");
      const cards = $("#historyCards");
      const sorted = sortedRecords().reverse();
      if (!sorted.length) {
        body.innerHTML = `<tr><td class="empty" colspan="8">暂无记录</td></tr>`;
        cards.innerHTML = `<div class="empty">暂无记录</div>`;
        return;
      }

      body.innerHTML = sorted.map((item) => `
        <tr>
          <td><button class="btn" type="button" data-load="${item.date}">${item.date}</button></td>
          <td>${item.weight ?? "--"}</td>
          <td>${item.waist ?? "--"}</td>
          <td>${item.steps ?? "--"}</td>
          <td>${item.hip ?? "--"}</td>
          <td>${item.thigh ?? "--"}</td>
          <td>${item.strength ? "力量" : item.trainingType || "--"}</td>
          <td><button class="btn danger" type="button" data-delete="${item.date}">删除</button></td>
        </tr>
      `).join("");

      cards.innerHTML = sorted.map((item) => `
        <article class="history-card">
          <div class="history-card-head">
            <div class="history-card-date">${item.date}</div>
            <span class="status-pill">${item.strength ? "力量" : item.trainingType || "--"}</span>
          </div>
          <div class="history-card-grid">
            <div>体重<strong>${item.weight ?? "--"} kg</strong></div>
            <div>腰围<strong>${item.waist ?? "--"} cm</strong></div>
            <div>步数<strong>${item.steps ?? "--"}</strong></div>
            <div>有氧<strong>${item.cardio ?? "--"} min</strong></div>
          </div>
          <div class="history-card-actions">
            <button class="btn" type="button" data-load="${item.date}">编辑</button>
            <button class="btn danger" type="button" data-delete="${item.date}">删除</button>
          </div>
        </article>
      `).join("");
    }

    function renderTodayActions(record) {
      const container = $("#todayActions");
      if (!record) {
        container.innerHTML = `<div class="action-item">保存记录后生成今日行动。</div>`;
        return;
      }

      const highTrainingLoad = (record.cardio ?? 0) > 90 || (record.trainingType === "HIIT" && (record.cardio ?? 0) >= 45);
      const actions = [
        "今日步数目标：≥ 8000",
        highTrainingLoad ? "今日有氧建议：轻松走 20-30 分钟" : "今日有氧建议：Zone2 30-45 分钟",
        highTrainingLoad ? "今日训练：建议恢复" : "今日训练：适合力量",
        record.dietControlled === "yes" ? "今日饮食：保持正常控制，不做极端补偿" : "今日饮食：回到正常控制，不做极端补偿"
      ];

      container.innerHTML = actions.map((action) => `<div class="action-item">${action}</div>`).join("");
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
      const dietDays = recent.filter((item) => item.dietControlled === "yes").length;

      $("#weeklyRecordDays").textContent = String(recordDays);
      $("#weeklyAvgWeight").textContent = avgWeight === null ? "--" : avgWeight.toFixed(1);
      $("#weeklyAvgSteps").textContent = avgSteps === null ? "--" : Math.round(avgSteps).toString();
      $("#weeklyCardioTotal").textContent = String(cardioTotal);
      $("#weeklyStrengthCount").textContent = String(strengthCount);
      $("#weeklyDietDays").textContent = String(dietDays);

      if (recordDays < 3) {
        $("#weeklySummaryText").textContent = "本周数据不足，先继续积累记录。";
      } else if ((avgSteps ?? 0) >= 8000 && dietDays >= Math.max(1, recordDays - 1)) {
        $("#weeklySummaryText").textContent = "本周执行稳定，继续保持步数和饮食控制。";
      } else if ((avgSteps ?? 0) < 8000) {
        $("#weeklySummaryText").textContent = "本周日常活动偏少，优先把平均步数拉到 8000 以上。";
      } else {
        $("#weeklySummaryText").textContent = "本周已有基础记录，继续看体重和腰围趋势。";
      }
      $("#weeklySummaryHint").textContent = recordDays ? `最近 ${recordDays} 天` : "最近 7 天";
    }

    function renderAll(preferredRecord) {
      const record = preferredRecord || getCurrentRecord();
      if (record) {
        renderAnalysis(record);
      } else {
        resetAnalysis();
      }
      renderCharts();
      renderProgress();
      renderLossBreakdown();
      renderHistory();
      renderTodayActions(record);
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

    function initializeForm() {
      fields.date.value = todayString();
      setStepperValue("startWeight", settings.startWeight ?? defaultWeightValue(), defaultWeightValue());
      setStepperValue("targetWeight", settings.targetWeight ?? Math.max(20, defaultWeightValue() - 5), 70);
      $("#targetDate").value = settings.targetDate ?? "";
      const today = records.find((item) => item.date === fields.date.value);
      if (today) {
        fillForm(today);
      } else {
        setStepperValue("weight", defaultWeightValue(), 70);
        setStepperValue("waist", latestRecord()?.waist, 80);
        setStepperValue("steps", 8000, 8000);
        setStepperValue("neck", latestRecord()?.neck, 35);
        setStepperValue("hip", latestRecord()?.hip, 95);
        setStepperValue("thigh", latestRecord()?.thigh, 55);
        setStepperValue("arm", latestRecord()?.arm, 30);
        setStepperValue("cardio", 0, 0);
        hasCardio.value = "no";
        fields.trainingType.value = "力量";
        updateCardioDetails();
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const record = recordFromForm();
      upsertRecord(record);
      if (!settings.startWeight) {
        settings.startWeight = record.weight;
        setStepperValue("startWeight", record.weight, record.weight);
        saveSettings();
      }
      renderAll(record);
      setActiveTab("advice");
      try {
        const backup = await writeRecordBackup(record);
        renderBackupStatus();
        toast(backup.skipped ? `已保存，${backup.reason}。` : "已保存，已切到建议页。");
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
      settings.startWeight = toNumber($("#startWeight").value);
      settings.targetWeight = toNumber($("#targetWeight").value);
      settings.targetDate = $("#targetDate").value;
      saveSettings();
      renderProgress();
      toast("目标已保存。");
    });

    $("#copyPreviousBtn").addEventListener("click", copyPreviousData);

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
      $("#range7").classList.add("active");
      $("#range30").classList.remove("active");
      renderCharts();
    });

    $("#range30").addEventListener("click", () => {
      chartRange = 30;
      $("#range30").classList.add("active");
      $("#range7").classList.remove("active");
      renderCharts();
    });

    function handleHistoryClick(event) {
      const loadDate = event.target.dataset.load;
      const deleteDate = event.target.dataset.delete;
      if (loadDate) {
        const record = records.find((item) => item.date === loadDate);
        fillForm(record);
        renderAnalysis(record);
        setActiveTab("record");
      }
      if (deleteDate && confirm(`删除 ${deleteDate} 的记录？`)) {
        const deletedIndex = records.findIndex((item) => item.date === deleteDate);
        const deletedRecord = records[deletedIndex];
        lastDeletedRecord = deletedRecord ? { record: deletedRecord, index: deletedIndex } : null;
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
    }

    $("#historyBody").addEventListener("click", handleHistoryClick);
    $("#historyCards").addEventListener("click", handleHistoryClick);

    $("#exportBtn").addEventListener("click", () => {
      const data = JSON.stringify({
        user: currentUser,
        data: records,
        settings,
        exportedAt: new Date().toISOString()
      }, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fat-loss-tracker-${currentUser}-${todayString()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });

    $("#importBtn").addEventListener("click", () => $("#importFile").click());

    function importedRecordsFromPayload(imported) {
      if (Array.isArray(imported)) return imported;
      if (Array.isArray(imported.data)) return imported.data;
      if (Array.isArray(imported.records)) return imported.records;
      return [];
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
        const importedList = importedRecordsFromPayload(imported);
        const result = mergeImportedRecords(importedList);
        if (imported.settings && typeof imported.settings === "object" && confirm("是否同时导入目标设置？")) {
          settings = imported.settings;
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

    $("#clearBtn").addEventListener("click", () => {
      if (!confirm("确认清空全部本地记录和目标设置？")) return;
      records = [];
      settings = {};
      saveRecords();
      saveSettings();
      initializeForm();
      renderAll();
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

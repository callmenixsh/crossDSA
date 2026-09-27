const DEFAULT_PLATFORMS = ["leetcode", "geeksforgeeks", "codeforces", "codechef", "code360"];

async function sendMessageToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    showStatus("Inactive, try refreshing the page", "error");
    throw e;
  }
}

function showStatus(message, type, duration = 2000) {
  const statusMessage = document.getElementById("statusMessage");
  if (!statusMessage) return;
  statusMessage.textContent = message;
  setTimeout(() => {
    if (statusMessage.textContent === message) statusMessage.textContent = "";
  }, duration);
}

function updateToggleUI(isEnabled) {
  const toggleBtn = document.getElementById("toggleBtn");
  toggleBtn.classList.toggle("enabled", isEnabled);
  toggleBtn.setAttribute("aria-pressed", isEnabled.toString());
  toggleBtn.querySelector(".toggle-state").textContent = isEnabled ? "On" : "Off";
}

function updatePresetButtons(value) {
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    const btnValue = parseFloat(btn.dataset.value);
    btn.classList.toggle("active", Math.abs(btnValue - value) < 0.01);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const similaritySlider = document.getElementById("similaritySlider");
  const similarityValue = document.getElementById("similarityValue");
  const toggleBtn = document.getElementById("toggleBtn");
  const presetBtns = document.querySelectorAll(".preset-btn");
  const problemCount = document.getElementById("problemCount");
  const platformGrid = document.getElementById("platformGrid");
  const chips = [...platformGrid.querySelectorAll(".platform-chip")];
  const resetLink = document.getElementById("resetLink");

  let selectedPlatforms = [...DEFAULT_PLATFORMS];

  const PROBLEM_DATA_FILES = {
    leetcode: "data/leetcode-data.json",
    geeksforgeeks: "data/geeksforgeeks-data.json",
    codeforces: "data/codeforces-data.json",
    codechef: "data/codechef-data.json",
    code360: "data/code360-data.json",
  };

  // ---- Load total index size ------------------------------------------------
  async function loadProblemCount() {
    problemCount.textContent = "…";
    try {
      const counts = await Promise.all(
        Object.values(PROBLEM_DATA_FILES).map(async (file) => {
          try {
            const response = await fetch(chrome.runtime.getURL(file));
            if (!response.ok) return 0;
            const data = await response.json();
            return Array.isArray(data) ? data.length : 0;
          } catch {
            return 0;
          }
        })
      );
      const total = counts.reduce((sum, count) => sum + count, 0);
      problemCount.textContent = total > 0 ? total.toLocaleString() : "—";
    } catch {
      problemCount.textContent = "—";
    }
  }

  // ---- Platform selection rendering ----------------------------------------
  function renderChips() {
    chips.forEach((chip) => {
      const platform = chip.dataset.platform;
      const checked = selectedPlatforms.includes(platform);
      chip.classList.toggle("checked", checked);
      chip.querySelector(".platform-check").checked = checked;
    });
  }

  async function persistPlatforms() {
    renderChips();
    try {
      await chrome.storage.local.set({ "dsa-preferred-platforms": selectedPlatforms });
    } catch (e) {
    }
    try {
      await chrome.runtime.sendMessage({ action: "setPreferredPlatforms", platforms: selectedPlatforms });
      try {
        await sendMessageToActiveTab({ action: "setPreferredPlatforms", platforms: selectedPlatforms });
      } catch (e) {
      }
      showStatus("Platforms updated!", "success");
    } catch (e) {
    }
  }

  chips.forEach((chip) => {
    chip.addEventListener("click", async (e) => {
      e.preventDefault();
      const platform = chip.dataset.platform;
      const willBeSelected = !selectedPlatforms.includes(platform);
      if (!willBeSelected && selectedPlatforms.length === 1) {
        showStatus("Keep at least one platform", "error", 2500);
        return;
      }
      if (willBeSelected) {
        selectedPlatforms.push(platform);
      } else {
        selectedPlatforms = selectedPlatforms.filter((p) => p !== platform);
      }
      await persistPlatforms();
    });
  });

  // ---- Similarity threshold -------------------------------------------------
  async function setThreshold(value) {
    try {
      await chrome.runtime.sendMessage({ action: "setSimilarityThreshold", value });
      try {
        await sendMessageToActiveTab({ action: "setSimilarityThreshold", value });
      } catch (e) {
      }
    } catch (e) {
    }
  }

  presetBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = parseFloat(btn.dataset.value);
      similaritySlider.value = value.toString();
      similarityValue.textContent = value.toString();
      updatePresetButtons(value);
      await setThreshold(value);
      showStatus("Threshold updated!", "success");
    });
  });

  similaritySlider.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    similarityValue.textContent = value.toString();
    updatePresetButtons(value);
  });

  similaritySlider.addEventListener("change", async (e) => {
    const value = parseFloat(e.target.value);
    await setThreshold(value);
    showStatus("Threshold updated!", "success");
  });

  // ---- Show/hide toggle -----------------------------------------------------
  toggleBtn.addEventListener("click", async () => {
    try {
      const response = await sendMessageToActiveTab({ action: "toggle" });
      updateToggleUI(response?.visible !== false);
      showStatus(response?.visible !== false ? "Enabled" : "Hidden", "success");
    } catch (e) {
    }
  });

  // ---- Reset settings -------------------------------------------------------
  resetLink.addEventListener("click", async (e) => {
    e.preventDefault();
    selectedPlatforms = [...DEFAULT_PLATFORMS];
    renderChips();
    try {
      await chrome.runtime.sendMessage({ action: "setPreferredPlatforms", platforms: selectedPlatforms });
      try {
        await sendMessageToActiveTab({ action: "setPreferredPlatforms", platforms: selectedPlatforms });
      } catch (err) {
      }
    } catch (err) {
    }
    await setThreshold(0.4);
    similaritySlider.value = "0.4";
    similarityValue.textContent = "0.4";
    updatePresetButtons(0.4);
    showStatus("Settings reset", "success");
  });

  // ---- Load persisted state ------------------------------------------------
  loadProblemCount();

  try {
    const response = await chrome.runtime.sendMessage({ action: "getSimilarityThreshold" });
    if (response && typeof response.value === "number") {
      similaritySlider.value = response.value.toString();
      similarityValue.textContent = response.value.toString();
      updatePresetButtons(response.value);
    }
  } catch (e) {
    similaritySlider.value = "0.4";
    similarityValue.textContent = "0.4";
  }

  try {
    const response = await chrome.runtime.sendMessage({ action: "getPreferredPlatforms" });
    if (response && Array.isArray(response.platforms) && response.platforms.length) {
      selectedPlatforms = response.platforms.filter((p) => DEFAULT_PLATFORMS.includes(p));
      if (!selectedPlatforms.length) selectedPlatforms = [...DEFAULT_PLATFORMS];
    }
  } catch (e) {
  }
  renderChips();

  try {
    const response = await sendMessageToActiveTab({ action: "getToggleState" });
    updateToggleUI(response?.enabled !== false);
  } catch (e) {
    updateToggleUI(true);
  }

  showStatus("Extension ready!", "success");
});

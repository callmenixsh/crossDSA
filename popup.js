const DEFAULT_PLATFORMS = ["leetcode", "geeksforgeeks", "codeforces", "codechef"];
const PLATFORM_DISPLAY = {
  leetcode: "LeetCode",
  geeksforgeeks: "GfG",
  codeforces: "Codeforces",
  codechef: "CodeChef",
};

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
  const statusBlob = document.getElementById("statusBlob");
  statusBlob.className = `status-blob ${type === "error" ? "inactive" : "active"}`;
  if (type !== "error") {
    setTimeout(() => {
      statusBlob.className = "status-blob active";
    }, duration);
  }
}

function updateEyeIcon(isEnabled) {
  const toggleBtn = document.getElementById("toggleBtn");
  toggleBtn.innerHTML = isEnabled
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
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
  const activePlatforms = document.getElementById("activePlatforms");
  const lastResults = document.getElementById("lastResults");
  const platformGrid = document.getElementById("platformGrid");
  const chips = [...platformGrid.querySelectorAll(".platform-chip")];
  const resetLink = document.getElementById("resetLink");

  let selectedPlatforms = [...DEFAULT_PLATFORMS];

  const PROBLEM_DATA_FILES = {
    leetcode: "data/leetcode-data.json",
    geeksforgeeks: "data/geeksforgeeks-data.json",
    codeforces: "data/codeforces-data.json",
    codechef: "data/codechef-data.json",
  };

  // ---- Load per-platform counts --------------------------------------------
  async function loadProblemCount() {
    problemCount.textContent = "Loading...";
    try {
      const results = await Promise.all(
        Object.entries(PROBLEM_DATA_FILES).map(async ([key, file]) => {
          try {
            const response = await fetch(chrome.runtime.getURL(file));
            if (!response.ok) return { key, count: 0 };
            const data = await response.json();
            return { key, count: Array.isArray(data) ? data.length : 0 };
          } catch {
            return { key, count: 0 };
          }
        })
      );
      const counts = {};
      let total = 0;
      results.forEach(({ key, count }) => {
        counts[key] = count;
        total += count;
      });
      chips.forEach((chip) => {
        const platform = chip.dataset.platform;
        const countEl = chip.querySelector(".chip-count");
        if (countEl && counts[platform] !== undefined) {
          countEl.textContent = counts[platform] > 0 ? counts[platform].toLocaleString() : "0";
        }
      });
      problemCount.textContent = total > 0 ? total.toLocaleString() : "—";
    } catch {
      problemCount.textContent = "—";
    }
  }

  // ---- Platform selection rendering ----------------------------------------
  function renderChips() {
    let active = 0;
    chips.forEach((chip) => {
      const platform = chip.dataset.platform;
      const checked = selectedPlatforms.includes(platform);
      chip.classList.toggle("checked", checked);
      chip.querySelector(".platform-check").checked = checked;
      if (checked) active++;
    });
    activePlatforms.textContent = `${active} / ${DEFAULT_PLATFORMS.length}`;
  }

  async function persistPlatforms() {
    renderChips();
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
      updateEyeIcon(response?.visible !== false);
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
    const data = await chrome.storage.local.get(["lastSearchResults"]);
    lastResults.textContent = data.lastSearchResults !== undefined ? data.lastSearchResults.toString() : "—";
  } catch (e) {
    lastResults.textContent = "—";
  }

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
    updateEyeIcon(response?.enabled !== false);
  } catch (e) {
    updateEyeIcon(true);
  }

  showStatus("Extension ready!", "success");
});
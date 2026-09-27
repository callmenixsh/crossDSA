const DEFAULT_PLATFORMS = ["leetcode", "geeksforgeeks", "codeforces", "codechef", "code360"];
const PLATFORM_NAMES = {
  leetcode: "LeetCode",
  geeksforgeeks: "GeeksforGeeks",
  codeforces: "Codeforces",
  codechef: "CodeChef",
  code360: "Code 360",
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
  const statusMessage = document.getElementById("statusMessage");
  if (!statusMessage) return;
  statusMessage.textContent = message;
  setTimeout(() => {
    if (statusMessage.isConnected && statusMessage.textContent === message) {
      statusMessage.textContent = "";
    }
  }, duration);
}

function updateToggleUI(isEnabled) {
  const toggleBtn = document.getElementById("toggleBtn");
  const thresholdLabel = document.getElementById("thresholdLabel");
  const thresholdMinLabel = document.getElementById("thresholdMinLabel");
  const thresholdMaxLabel = document.getElementById("thresholdMaxLabel");
  if (!toggleBtn) return;
  toggleBtn.classList.toggle("enabled", isEnabled);
  toggleBtn.setAttribute("aria-pressed", isEnabled.toString());
  const stateLabel = toggleBtn.querySelector(".toggle-state");
  if (stateLabel) stateLabel.textContent = isEnabled ? "On" : "Off";
}

document.addEventListener("DOMContentLoaded", async () => {
  const similaritySlider = document.getElementById("similaritySlider");
  const similarityValue = document.getElementById("similarityValue");
  const thresholdLabel = document.getElementById("thresholdLabel");
  const thresholdMinLabel = document.getElementById("thresholdMinLabel");
  const thresholdMaxLabel = document.getElementById("thresholdMaxLabel");
  const toggleBtn = document.getElementById("toggleBtn");
  const problemCount = document.getElementById("problemCount");
  const platformGrid = document.getElementById("platformGrid");
  const chips = platformGrid ? [...platformGrid.querySelectorAll(".platform-chip")] : [];
  const resetLink = document.getElementById("resetLink");
  const randomPickBtn = document.getElementById("randomPickBtn");
  const randomResult = document.getElementById("randomResult");
  const randomTitle = document.getElementById("randomTitle");
  const randomMeta = document.getElementById("randomMeta");

  const requiredElements = [
    similaritySlider, similarityValue, toggleBtn, thresholdLabel,
    thresholdMinLabel, thresholdMaxLabel, problemCount, platformGrid,
    resetLink, randomPickBtn, randomResult, randomTitle, randomMeta
  ];
  if (requiredElements.some((element) => !element)) return;

  let selectedPlatforms = [...DEFAULT_PLATFORMS];
  let matchThreshold = 0.4;
  let indexedProblems = [];
  let currentRandomProblem = null;

  const PROBLEM_DATA_FILES = {
    leetcode: "data/leetcode-data.json",
    geeksforgeeks: "data/geeksforgeeks-data.json",
    codeforces: "data/codeforces-data.json",
    codechef: "data/codechef-data.json",
    code360: "data/code360-data.json",
  };

  // ---- Load total index size ------------------------------------------------
  async function loadProblemIndex() {
    problemCount.textContent = "…";
    try {
      const datasets = await Promise.all(
        Object.entries(PROBLEM_DATA_FILES).map(async ([source, file]) => {
          try {
            const response = await fetch(chrome.runtime.getURL(file));
            if (!response.ok) return [];
            const data = await response.json();
            if (!Array.isArray(data)) return [];
            return data
              .filter((problem) => problem?.title && problem?.url)
              .map((problem) => ({ ...problem, source: problem.source || source }));
          } catch {
            return [];
          }
        })
      );
      indexedProblems = datasets.flat();
      problemCount.textContent = indexedProblems.length > 0
        ? indexedProblems.length.toLocaleString()
        : "—";
      randomPickBtn.disabled = indexedProblems.length === 0;
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
    if (currentRandomProblem && !selectedPlatforms.includes(currentRandomProblem.source)) {
      currentRandomProblem = null;
      randomResult.hidden = true;
      randomPickBtn.textContent = "Pick one";
    }
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

  // ---- Match threshold ------------------------------------------------------
  async function setThreshold(value) {
    matchThreshold = value;
    try {
      await chrome.runtime.sendMessage({ action: "setSimilarityThreshold", value });
      try {
        await sendMessageToActiveTab({ action: "setSimilarityThreshold", value });
      } catch (e) {
      }
    } catch (e) {
    }
  }

  similaritySlider.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    similarityValue.textContent = value.toString();
  });

  similaritySlider.addEventListener("change", async (e) => {
    const value = parseFloat(e.target.value);
    await setThreshold(value);
    showStatus("Threshold updated!", "success");
  });

  randomPickBtn.addEventListener("click", () => {
    const eligibleProblems = indexedProblems.filter((problem) =>
      selectedPlatforms.includes(problem.source)
    );
    if (!eligibleProblems.length) return;
    let nextProblem;
    do {
      nextProblem = eligibleProblems[Math.floor(Math.random() * eligibleProblems.length)];
    } while (eligibleProblems.length > 1 && nextProblem === currentRandomProblem);

    currentRandomProblem = nextProblem;
    randomTitle.textContent = nextProblem.title;
    randomMeta.textContent = [
      PLATFORM_NAMES[nextProblem.source] || nextProblem.source,
      nextProblem.difficulty || "Unknown",
      nextProblem.isPremium ? "Premium" : null,
    ].filter(Boolean).join(" · ");
    randomResult.hidden = false;
    randomResult.title = `Open ${nextProblem.title}`;
    randomPickBtn.textContent = "Pick another";
  });

  randomResult.addEventListener("click", () => {
    if (currentRandomProblem?.url) {
      try {
        const openTab = chrome.tabs.create({ url: currentRandomProblem.url });
        if (openTab?.catch) openTab.catch(() => {});
      } catch (e) {
      }
    }
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
    matchThreshold = 0.4;
    try {
      await chrome.runtime.sendMessage({ action: "setSimilarityThreshold", value: matchThreshold });
      try {
        await sendMessageToActiveTab({ action: "setSimilarityThreshold", value: matchThreshold });
      } catch (err) {
      }
    } catch (err) {
    }
    similaritySlider.value = String(matchThreshold);
    similarityValue.textContent = String(matchThreshold);
    showStatus("Settings reset", "success");
  });

  // ---- Load persisted state ------------------------------------------------
  loadProblemIndex();

  try {
    const matchResponse = await chrome.runtime.sendMessage({ action: "getSimilarityThreshold" });
    if (typeof matchResponse?.value === "number") matchThreshold = matchResponse.value;
  } catch (e) {
  }
  similaritySlider.value = String(matchThreshold);
  similarityValue.textContent = String(matchThreshold);

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

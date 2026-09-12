// FinLayer Windows Setup Wizard — Renderer Logic

(function () {
  // Elements
  const stepDots = [
    document.getElementById("dot-step-1"),
    document.getElementById("dot-step-2"),
    document.getElementById("dot-step-3"),
    document.getElementById("dot-step-4"),
    document.getElementById("dot-step-5"),
  ];

  const stepCards = [
    document.getElementById("card-step-1"),
    document.getElementById("card-step-2"),
    document.getElementById("card-step-3"),
    document.getElementById("card-step-4"),
    document.getElementById("card-step-5"),
  ];

  const btnStartSetup = document.getElementById("btn-start-setup");
  const tallyStatusBadge = document.getElementById("tally-status-badge");
  const tallyStatusText = document.getElementById("tally-status-text");
  const btnRecheckTally = document.getElementById("btn-recheck-tally");
  const btnContinueTally = document.getElementById("btn-continue-tally");

  // Step 3 Elements
  const companyCardTitle = document.getElementById("company-card-title");
  const companyCardSubtitle = document.getElementById("company-card-subtitle");
  const companyFoundView = document.getElementById("company-found-view");
  const detectedCompanyName = document.getElementById("detected-company-name");
  const btnContinueCompany = document.getElementById("btn-continue-company");
  const noCompanyView = document.getElementById("no-company-view");
  const btnRetryCompany = document.getElementById("btn-retry-company");
  const companyLoadingView = document.getElementById("company-loading-view");

  const googleStatusBadge = document.getElementById("google-status-badge");
  const googleStatusText = document.getElementById("google-status-text");
  const btnConnectGoogle = document.getElementById("btn-connect-google");
  const btnContinueGoogle = document.getElementById("btn-continue-google");

  // Demo Mode Live Sync UI Elements
  const demoSyncContainer = document.getElementById("demo-sync-container");
  const demoUiSheet = document.getElementById("demo-ui-sheet");
  const demoUiSync = document.getElementById("demo-ui-sync");
  const demoUiComplete = document.getElementById("demo-ui-complete");

  const btnOpenDashboard = document.getElementById("btn-open-dashboard");
  const footerDevice = document.getElementById("footer-device");
  const footerStatus = document.getElementById("footer-status");
  const footerVersion = document.getElementById("footer-version");
  const appVersionBadge = document.getElementById("app-version-badge");
  const updateBanner = document.getElementById("update-banner");
  const updateBannerVersion = document.getElementById("update-banner-version");
  const btnRestartUpdate = document.getElementById("btn-restart-update");

  // State
  let currentStep = 1;
  let currentCompanyId = null;
  let currentCompanyName = null;
  let googlePollInterval = null;
  let isDemoModeActive = false;

  function updateDebugCompanyId(companyId) {
    const el = document.getElementById("debug-company-id-val");
    if (el) {
      el.textContent = companyId || "(none)";
    }
  }

  function setFooter(text) {
    if (footerStatus) footerStatus.textContent = `Status: ${text}`;
  }

  function goToStep(stepNumber) {
    currentStep = stepNumber;
    stepCards.forEach((card, idx) => {
      if (idx + 1 === stepNumber) {
        card.classList.add("active");
      } else {
        card.classList.remove("active");
      }
    });

    stepDots.forEach((dot, idx) => {
      dot.classList.remove("active");
      if (idx + 1 < stepNumber) {
        dot.classList.add("completed");
      } else if (idx + 1 === stepNumber) {
        dot.classList.add("active");
        dot.classList.remove("completed");
      } else {
        dot.classList.remove("completed");
      }
    });
  }

  // ── Step 1: Start ───────────────────────────────────────────────────────────
  function onStartSetup() {
    console.log("Welcome button clicked");
    goToStep(2);
    checkTally();
  }

  window.startSetup = onStartSetup;

  if (btnStartSetup) {
    btnStartSetup.addEventListener("click", onStartSetup);
  } else {
    console.error("btn-start-setup element not found!");
  }

  // ── Step 2: Detect Tally ───────────────────────────────────────────────────
  async function checkTally() {
    tallyStatusBadge.className = "status-badge";
    tallyStatusBadge.innerHTML = `<span class="status-dot"></span><span>Checking http://127.0.0.1:9000…</span>`;
    btnContinueTally.disabled = true;
    setFooter("Probing TallyPrime…");

    try {
      const res = await window.finlayer.detectTally();
      if (res.connected) {
        tallyStatusBadge.className = "status-badge connected";
        tallyStatusBadge.innerHTML = `<span class="status-dot green"></span><span>Connected</span>`;
        btnContinueTally.disabled = false;
        setFooter("TallyPrime detected online");
        setTimeout(() => {
          if (currentStep === 2) {
            goToStep(3);
            loadActiveCompany();
          }
        }, 600);
      } else {
        tallyStatusBadge.className = "status-badge not-connected";
        tallyStatusBadge.innerHTML = `<span class="status-dot red"></span><span>Not Connected (Is Tally running on port 9000?)</span>`;
        btnContinueTally.disabled = true;
        setFooter("TallyPrime not responding");
      }
    } catch (err) {
      tallyStatusBadge.className = "status-badge not-connected";
      tallyStatusBadge.innerHTML = `<span class="status-dot red"></span><span>Error: ${err.message || err}</span>`;
      btnContinueTally.disabled = true;
      setFooter("Tally check error");
    }
  }

  btnRecheckTally.addEventListener("click", () => {
    checkTally();
  });

  btnContinueTally.addEventListener("click", () => {
    goToStep(3);
    loadActiveCompany();
  });

  // ── Step 3: Auto Detect Active Company ────────────────────────────────────
  async function loadActiveCompany() {
    companyLoadingView.style.display = "block";
    companyFoundView.style.display = "none";
    noCompanyView.style.display = "none";
    companyCardTitle.textContent = "Tally Connected ✅";
    companyCardSubtitle.textContent = "Detecting open company in TallyPrime…";
    setFooter("Detecting active company in TallyPrime…");

    try {
      const res = await window.finlayer.fetchActiveCompany();
      companyLoadingView.style.display = "none";

      if (res.success && res.companyName) {
        currentCompanyId = res.companyId || null;
        currentCompanyName = res.companyName;

        if (currentCompanyId) {
          localStorage.setItem("finlayer-company-id", currentCompanyId);
          updateDebugCompanyId(currentCompanyId);
        }

        detectedCompanyName.textContent = res.companyName;
        companyCardTitle.textContent = "Tally Connected ✅";
        companyCardSubtitle.textContent = "Active company detected automatically.";
        companyFoundView.style.display = "block";
        noCompanyView.style.display = "none";
        setFooter(`Company found: ${res.companyName}`);
      } else {
        companyFoundView.style.display = "none";
        noCompanyView.style.display = "block";
        companyCardSubtitle.textContent = "Please open a company in TallyPrime and click Retry.";
        setFooter("Tally connected, but no company is open");
      }
    } catch (err) {
      companyLoadingView.style.display = "none";
      companyFoundView.style.display = "none";
      noCompanyView.style.display = "block";
      setFooter("Error detecting company");
    }
  }

  btnRetryCompany.addEventListener("click", () => {
    loadActiveCompany();
  });

  const googleErrorMessage = document.getElementById("google-error-message");

  function showGoogleError(msg) {
    if (googleErrorMessage) {
      googleErrorMessage.textContent = msg || "Unable to connect Google. Company information missing.";
      googleErrorMessage.style.display = "block";
    }
    setFooter("Error connecting Google Account");
  }

  function hideGoogleError() {
    if (googleErrorMessage) {
      googleErrorMessage.style.display = "none";
    }
  }

  // ── Step 4: Google Sheet Connection ────────────────────────────────────────
  async function initGoogleStep(companyId) {
    updateDebugCompanyId(companyId);

    try {
      const init = await window.finlayer.getInitialState();
      if (init && typeof init.demoMode === "boolean") {
        isDemoModeActive = init.demoMode;
      }
    } catch {}

    const res = await checkGoogleConnection(companyId);
    if (res && typeof res.demoMode === "boolean") {
      isDemoModeActive = res.demoMode;
    }

    if (isDemoModeActive && btnConnectGoogle && !btnConnectGoogle.disabled) {
      btnConnectGoogle.innerHTML = `Connect Demo Sheet &rarr;`;
    }
  }

  async function checkGoogleConnection(companyId) {
    if (!companyId) return false;

    console.log("[WINDOWS] Checking Google status");
    console.log("[WINDOWS] Company ID: " + companyId);

    try {
      const res = await window.finlayer.checkGoogleStatus(companyId);
      console.log("[WINDOWS] Google connection response: " + JSON.stringify(res));

      if (res && typeof res.demoMode === "boolean") {
        isDemoModeActive = res.demoMode;
      }

      if (res && res.connected) {
        googleStatusBadge.className = "status-badge connected";
        googleStatusBadge.innerHTML = `<span class="status-dot green"></span><span>Google Sheet Connected ✅</span>`;
        if (btnConnectGoogle) {
          btnConnectGoogle.innerHTML = `<span>Connected ✅</span>`;
          btnConnectGoogle.disabled = true;
          btnConnectGoogle.style.background = "#16a34a";
          btnConnectGoogle.style.cursor = "default";
        }
        if (btnContinueGoogle) btnContinueGoogle.style.display = "flex";
        hideGoogleError();
        setFooter("Google Sheet Connected ✅");

        if (googlePollInterval) {
          clearInterval(googlePollInterval);
          googlePollInterval = null;
        }
        return res;
      } else {
        googleStatusBadge.className = "status-badge not-connected";
        googleStatusBadge.innerHTML = `<span class="status-dot red"></span><span>Not Connected</span>`;
        if (btnConnectGoogle && !btnConnectGoogle.disabled) {
          btnConnectGoogle.innerHTML = isDemoModeActive ? `Connect Demo Sheet &rarr;` : `Connect Google Account &rarr;`;
          btnConnectGoogle.disabled = false;
          btnConnectGoogle.style.background = "";
          btnConnectGoogle.style.cursor = "pointer";
        }
        setFooter(isDemoModeActive ? "Ready to connect Demo Sheet" : "Waiting for Google connection");
        return res || false;
      }
    } catch (err) {
      console.error("[WINDOWS] Google connection response error:", err);
      return false;
    }
  }

  async function runDemoSyncFlow(companyId) {
    console.log("[DEMO FLOW] Starting demo sync flow for company:", companyId);

    if (btnConnectGoogle) {
      btnConnectGoogle.disabled = true;
      btnConnectGoogle.innerHTML = "Connecting Demo Sheet...";
    }
    hideGoogleError();
    setFooter("Connecting Demo Sheet…");

    try {
      // 1. Skip Google OAuth, create connection automatically via demo connector
      const result = await window.finlayer.startGoogleAuth(companyId);
      console.log("[DEMO FLOW] startGoogleAuth result:", result);

      if (!result || !result.success) {
        showGoogleError(result?.error || "Could not connect demo sheet.");
        if (btnConnectGoogle) {
          btnConnectGoogle.disabled = false;
          btnConnectGoogle.innerHTML = "Connect Demo Sheet &rarr;";
        }
        return;
      }

      // Show Demo Sync UI container
      if (demoSyncContainer) {
        demoSyncContainer.style.display = "block";
      }

      // ── UI Step 1: Google Sheet Connected ✅ ──
      if (demoUiSheet) demoUiSheet.style.display = "block";
      if (googleStatusBadge) {
        googleStatusBadge.className = "status-badge connected";
        googleStatusBadge.innerHTML = `<span class="status-dot green"></span><span>Google Sheet Connected ✅</span>`;
      }
      if (btnConnectGoogle) {
        btnConnectGoogle.innerHTML = `<span>Google Sheet Connected ✅</span>`;
        btnConnectGoogle.style.background = "#16a34a";
        btnConnectGoogle.style.cursor = "default";
      }
      setFooter("Google Sheet Connected ✅");

      // Brief visual pause for clear demo visibility
      await new Promise((resolve) => setTimeout(resolve, 800));

      // ── UI Step 2: Sync Started... ──
      if (demoUiSync) demoUiSync.style.display = "block";
      setFooter("Sync Started...");
      console.log("[DEMO FLOW] Sync Started...");

      // Trigger setup completion & start background sync worker
      window.finlayer.completeSetup().catch((e) => console.warn("completeSetup warning:", e));

      // Poll sync status from API
      let syncFinished = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        try {
          const syncStatus = await window.finlayer.getSyncStatus(companyId);
          console.log(`[DEMO FLOW] Poll attempt ${attempt + 1}:`, syncStatus);
          if (syncStatus && syncStatus.completed) {
            syncFinished = true;
            break;
          }
        } catch (err) {
          console.warn("[DEMO FLOW] getSyncStatus error:", err);
        }
      }

      // ── UI Step 3: Sync Complete ✅ ──
      if (demoUiComplete) demoUiComplete.style.display = "block";
      setFooter("Sync Complete ✅");
      console.log("[DEMO FLOW] Sync Complete ✅");

      // Hold complete state so founder sees confirmation checkmark
      await new Promise((resolve) => setTimeout(resolve, 1500));

      goToStep(5);
      onSetupComplete();
    } catch (err) {
      console.error("[DEMO FLOW] Error:", err);
      showGoogleError(err.message || "Demo sync flow error");
      if (btnConnectGoogle) {
        btnConnectGoogle.disabled = false;
        btnConnectGoogle.innerHTML = "Connect Demo Sheet &rarr;";
      }
    }
  }

  async function handleGoogleConnectClick() {
    console.log("[GOOGLE BUTTON] clicked");

    console.log("[GOOGLE] companyId sources:");
    console.log("memory:", currentCompanyId);
    console.log("storage:", localStorage.getItem("finlayer-company-id"));

    // 1. currentCompanyId
    let companyId = currentCompanyId;

    // 2. localStorage.getItem("finlayer-company-id")
    if (!companyId) {
      const stored = localStorage.getItem("finlayer-company-id");
      if (stored) {
        companyId = stored;
        currentCompanyId = companyId;
        console.log("[Google] Read companyId from localStorage:", companyId);
      }
    }

    // 3. window.finlayer.getInitialState()
    if (!companyId) {
      try {
        const init = await window.finlayer.getInitialState();
        if (init?.state?.companyId) {
          companyId = init.state.companyId;
          currentCompanyId = companyId;
          localStorage.setItem("finlayer-company-id", companyId);
          console.log("[Google] Read companyId from state:", companyId);
        }
      } catch (err) {
        console.warn("[Google] Error loading state:", err);
      }
    }

    // Fallback: If still missing and currentCompanyName is known, dynamically select
    if (!companyId && currentCompanyName) {
      try {
        const sel = await window.finlayer.selectCompany(currentCompanyName);
        if (sel?.success && sel?.companyId) {
          companyId = sel.companyId;
          currentCompanyId = companyId;
          localStorage.setItem("finlayer-company-id", companyId);
          console.log("[Google] Dynamically selected company:", companyId);
        }
      } catch (err) {
        console.warn("[Google] Fallback selectCompany failed:", err);
      }
    }

    updateDebugCompanyId(companyId);
    console.log("[GOOGLE BUTTON] companyId:", companyId);

    hideGoogleError();

    if (!companyId) {
      console.error("[GOOGLE BUTTON] Company ID missing!");
      showGoogleError("Unable to connect Google. Company information missing.");
      return;
    }

    // If DEMO_MODE is active, run the direct demo sync flow
    if (isDemoModeActive) {
      await runDemoSyncFlow(companyId);
      return;
    }

    // Untouched Production Google OAuth Flow
    try {
      const result = await window.finlayer.startGoogleAuth(companyId);
      console.log("[Google] Google auth result:", result);

      if (!result || !result.success) {
        showGoogleError(result?.error || "Unable to connect Google. Company information missing.");
        return;
      }

      setFooter("Browser opened for Google OAuth");

      // Start polling
      if (!googlePollInterval) {
        googlePollInterval = setInterval(async () => {
          const connected = await checkGoogleConnection(companyId);
          if (connected) {
            setTimeout(() => {
              goToStep(5);
              onSetupComplete();
            }, 1200);
          }
        }, 2500);
      }
    } catch (err) {
      console.error("[Google] startGoogleAuth error:", err);
      showGoogleError("Unable to connect Google. Company information missing.");
    }
  }

  function attachGoogleButtonListener() {
    const btn = document.getElementById("btn-connect-google");
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "true";
      btn.addEventListener("click", async () => {
        await handleGoogleConnectClick();
      });
      console.log("[Google] Bound click listener to #btn-connect-google");
    }
  }

  // Attach immediately on evaluation
  attachGoogleButtonListener();

  btnContinueCompany.addEventListener("click", async () => {
    let companyId = currentCompanyId;

    if (!companyId) {
      companyId = localStorage.getItem("finlayer-company-id");
    }

    if (!companyId) {
      try {
        const init = await window.finlayer.getInitialState();
        if (init?.state?.companyId) {
          companyId = init.state.companyId;
        }
      } catch {}
    }

    if (!companyId && currentCompanyName) {
      try {
        const sel = await window.finlayer.selectCompany(currentCompanyName);
        if (sel?.success && sel?.companyId) {
          companyId = sel.companyId;
        }
      } catch (err) {
        console.warn("Dynamic selectCompany failed:", err);
      }
    }

    if (companyId) {
      currentCompanyId = companyId;
      localStorage.setItem("finlayer-company-id", companyId);
      updateDebugCompanyId(companyId);
    }

    goToStep(4);
    initGoogleStep(companyId);
  });

  btnContinueGoogle.addEventListener("click", () => {
    goToStep(5);
    onSetupComplete();
  });

  // ── Step 5: Setup Complete ─────────────────────────────────────────────────
  async function onSetupComplete() {
    if (googlePollInterval) {
      clearInterval(googlePollInterval);
      googlePollInterval = null;
    }
    setFooter("Finalizing setup & starting background worker…");
    try {
      await window.finlayer.completeSetup();
      setFooter("FinLayer Connector is Active 🟢");
    } catch (err) {
      console.warn("Could not finalize setup state:", err);
    }
  }

  btnOpenDashboard.addEventListener("click", async () => {
    try {
      await window.finlayer.openDashboard();
    } catch (err) {
      alert("Could not open dashboard: " + err.message);
    }
  });

  // ── Auto-Update Handlers ───────────────────────────────────────────────────
  if (btnRestartUpdate) {
    btnRestartUpdate.addEventListener("click", async () => {
      try {
        await window.finlayer.restartAndInstall();
      } catch (err) {
        alert("Could not restart and install: " + err.message);
      }
    });
  }

  if (window.finlayer && window.finlayer.onUpdateDownloaded) {
    window.finlayer.onUpdateDownloaded((data) => {
      console.log("[Renderer] Update downloaded and ready to install:", data);
      if (updateBanner && updateBannerVersion) {
        updateBannerVersion.textContent = `v${data.version}`;
        updateBanner.style.display = "flex";
      }
    });
  }

  // ── Initialization ─────────────────────────────────────────────────────────
  window.addEventListener("DOMContentLoaded", async () => {
    console.log("DOMContentLoaded running");
    attachGoogleButtonListener();

    const storedCompanyId = localStorage.getItem("finlayer-company-id");
    if (storedCompanyId) {
      currentCompanyId = storedCompanyId;
      updateDebugCompanyId(storedCompanyId);
      console.log("[Init] Restored companyId from localStorage:", storedCompanyId);
    }

    try {
      const init = await window.finlayer.getInitialState();
      if (init) {
        if (typeof init.demoMode === "boolean") {
          isDemoModeActive = init.demoMode;
          if (isDemoModeActive && btnConnectGoogle && !btnConnectGoogle.disabled) {
            btnConnectGoogle.innerHTML = `Connect Demo Sheet &rarr;`;
          }
        }
        if (init.state) {
          if (init.state.deviceName && footerDevice) {
            footerDevice.textContent = `Device: ${init.state.deviceName}`;
          }
          if (init.state.companyId) {
            currentCompanyId = init.state.companyId;
            localStorage.setItem("finlayer-company-id", currentCompanyId);
            updateDebugCompanyId(currentCompanyId);
          }
          if (init.state.tallyCompanyName) {
            currentCompanyName = init.state.tallyCompanyName;
          }
          if (init.state.setupStatus === "ACTIVE") {
            goToStep(5);
            setFooter("FinLayer Connector Active 🟢");
          }
        }
      }

      // Populate version badges
      const verInfo = await window.finlayer.getAppVersion();
      if (verInfo) {
        if (appVersionBadge) {
          appVersionBadge.textContent = `v${verInfo.appVersion} (Windows)`;
        }
        if (footerVersion) {
          footerVersion.textContent = `FinLayer v${verInfo.appVersion} | Connector v${verInfo.connectorVersion}`;
        }
      }
    } catch (err) {
      console.warn("Failed to get initial state/version:", err);
    }
  });
})();

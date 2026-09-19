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

      console.log("[COMPANY STATE] fetchActiveCompany response:", res);
      console.log("  connectorId:", res?.connectorId);
      console.log("  companyId:", res?.companyId);
      console.log("  companyName:", res?.companyName);
      console.log("  localStorage finlayer-company-id before:", localStorage.getItem("finlayer-company-id"));
      console.log("  localStorage finlayer-company-name before:", localStorage.getItem("finlayer-company-name"));

      if (res.success && res.companyName) {
        currentCompanyName = res.companyName;
        currentCompanyId = res.companyId || null;

        if (!currentCompanyId) {
          try {
            const init = await window.finlayer.getInitialState();
            if (init?.state?.companyId) {
              currentCompanyId = init.state.companyId;
              console.log("[COMPANY STATE] Recovered companyId from getInitialState:", currentCompanyId);
            }
          } catch (e) {
            console.warn("[COMPANY STATE] getInitialState lookup failed:", e);
          }
        }

        if (!currentCompanyId) {
          const stored = localStorage.getItem("finlayer-company-id");
          if (stored) {
            currentCompanyId = stored;
            console.log("[COMPANY STATE] Recovered companyId from localStorage:", currentCompanyId);
          }
        }

        if (!currentCompanyId) {
          try {
            console.log("[COMPANY STATE] Attempting selectCompany IPC for:", currentCompanyName);
            const sel = await window.finlayer.selectCompany(currentCompanyName);
            console.log("[COMPANY STATE] selectCompany response:", sel);
            if (sel?.success && sel?.companyId) {
              currentCompanyId = sel.companyId;
            }
          } catch (e) {
            console.warn("[COMPANY STATE] Failed to map company during detection:", e);
          }
        }

        if (currentCompanyId) {
          localStorage.setItem("finlayer-company-id", currentCompanyId);
          updateDebugCompanyId(currentCompanyId);
        }
        if (currentCompanyName) {
          localStorage.setItem("finlayer-company-name", currentCompanyName);
        }

        console.log("[COMPANY STATE] State values after detection flow:");
        console.log("  connectorId:", res.connectorId);
        console.log("  companyId:", currentCompanyId);
        console.log("  companyName:", currentCompanyName);
        console.log("  localStorage finlayer-company-id:", localStorage.getItem("finlayer-company-id"));
        console.log("  localStorage finlayer-company-name:", localStorage.getItem("finlayer-company-name"));

        detectedCompanyName.textContent = res.companyName;
        companyFoundView.style.display = "block";
        noCompanyView.style.display = "none";

        if (currentCompanyId) {
          companyCardTitle.textContent = "Tally Connected ✅";
          companyCardSubtitle.textContent = "Active company detected automatically.";
          btnContinueCompany.disabled = false;
          setFooter(`Company found: ${res.companyName}`);
        } else {
          companyCardTitle.textContent = "Tally Connected ⚠️";
          companyCardSubtitle.textContent = "Company detected in Tally, but FinLayer API registration is pending. Click Continue or Retry.";
          btnContinueCompany.disabled = false;
          setFooter("Company detected, waiting for API registration");
        }
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
      googleErrorMessage.textContent = msg || "Please retry company detection";
      googleErrorMessage.style.display = "block";
    }
    setFooter("Please retry company detection");
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
      showGoogleError("Please retry company detection");
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
        showGoogleError(result?.error || "Please retry company detection");
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
      showGoogleError("Please retry company detection");
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
    btnContinueCompany.disabled = true;

    console.log("[COMPANY STATE] Continue button clicked. Resolving companyId...");
    console.log("  currentCompanyId:", currentCompanyId);
    console.log("  currentCompanyName:", currentCompanyName);
    console.log("  localStorage finlayer-company-id:", localStorage.getItem("finlayer-company-id"));
    console.log("  localStorage finlayer-company-name:", localStorage.getItem("finlayer-company-name"));

    // Priority:
    // 1. currentCompanyId
    // 2. localStorage finlayer-company-id
    // 3. window.finlayer.getInitialState()
    let companyId = currentCompanyId;

    if (!companyId) {
      companyId = localStorage.getItem("finlayer-company-id");
      if (companyId) {
        console.log("[COMPANY STATE] Resolved companyId from localStorage:", companyId);
      }
    }

    if (!companyId) {
      try {
        const init = await window.finlayer.getInitialState();
        if (init?.state?.companyId) {
          companyId = init.state.companyId;
          console.log("[COMPANY STATE] Resolved companyId from getInitialState:", companyId);
        }
        if (init?.state?.connectorId) {
          console.log("[COMPANY STATE] Current connectorId:", init.state.connectorId);
        }
      } catch (err) {
        console.warn("[COMPANY STATE] Error loading initial state:", err);
      }
    }

    // If still missing: call fetchActiveCompany() again.
    if (!companyId) {
      console.log("[COMPANY STATE] companyId missing on Continue. Retrying fetchActiveCompany()...");
      try {
        const retryRes = await window.finlayer.fetchActiveCompany();
        console.log("[COMPANY STATE] retry fetchActiveCompany response:", retryRes);
        if (retryRes?.success) {
          if (retryRes.companyName) {
            currentCompanyName = retryRes.companyName;
            localStorage.setItem("finlayer-company-name", currentCompanyName);
          }
          if (retryRes.companyId) {
            companyId = retryRes.companyId;
            console.log("[COMPANY STATE] Resolved companyId from retry fetchActiveCompany:", companyId);
          }
        }
      } catch (err) {
        console.warn("[COMPANY STATE] Retry fetchActiveCompany failed:", err);
      }
    }

    // If still missing and currentCompanyName is known, attempt selectCompany
    if (!companyId && currentCompanyName) {
      try {
        console.log("[COMPANY STATE] Attempting selectCompany with name:", currentCompanyName);
        const sel = await window.finlayer.selectCompany(currentCompanyName);
        console.log("[COMPANY STATE] selectCompany response:", sel);
        if (sel?.success && sel?.companyId) {
          companyId = sel.companyId;
          console.log("[COMPANY STATE] Resolved companyId from selectCompany:", companyId);
        }
      } catch (err) {
        console.warn("[COMPANY STATE] Dynamic selectCompany failed:", err);
      }
    }

    // Do not allow transition to Google step without companyId.
    if (!companyId) {
      btnContinueCompany.disabled = false;
      console.error("[COMPANY STATE] Transition prevented: companyId missing!");
      console.error("  companyName:", currentCompanyName);
      console.error("  localStorage finlayer-company-id:", localStorage.getItem("finlayer-company-id"));
      showGoogleError("Please retry company detection");
      companyCardSubtitle.textContent = "Please retry company detection";
      setFooter("Please retry company detection");
      return;
    }

    currentCompanyId = companyId;
    localStorage.setItem("finlayer-company-id", companyId);
    if (currentCompanyName) {
      localStorage.setItem("finlayer-company-name", currentCompanyName);
    }
    updateDebugCompanyId(companyId);

    console.log("[COMPANY STATE] Successfully resolved companyId. Moving to Google Step:", companyId);
    console.log("  localStorage finlayer-company-id:", localStorage.getItem("finlayer-company-id"));

    btnContinueCompany.disabled = false;
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

  const btnWinDownloadExport = document.getElementById("btn-win-download-export");
  if (btnWinDownloadExport) {
    btnWinDownloadExport.addEventListener("click", async () => {
      const type = document.getElementById("win-export-type")?.value || "vouchers";
      const format = document.getElementById("win-export-format")?.value || "csv";
      btnWinDownloadExport.disabled = true;
      btnWinDownloadExport.textContent = "Opening Export…";
      try {
        const res = await window.finlayer.downloadExport(type, format);
        if (!res.success && res.error) {
          alert("Export notice: " + res.error);
        }
      } catch (err) {
        alert("Export failed: " + err.message);
      } finally {
        btnWinDownloadExport.disabled = false;
        btnWinDownloadExport.textContent = "📥 Download Export";
      }
    });
  }


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
    const storedCompanyName = localStorage.getItem("finlayer-company-name");
    if (storedCompanyId) {
      currentCompanyId = storedCompanyId;
      updateDebugCompanyId(storedCompanyId);
    }
    if (storedCompanyName) {
      currentCompanyName = storedCompanyName;
    }

    try {
      const init = await window.finlayer.getInitialState();
      console.log("[COMPANY STATE] DOMContentLoaded initial state:", init);
      console.log("  connectorId:", init?.state?.connectorId);
      console.log("  companyId:", init?.state?.companyId);
      console.log("  companyName:", init?.state?.tallyCompanyName);
      console.log("  setupStatus:", init?.state?.setupStatus);
      console.log("  localStorage finlayer-company-id:", localStorage.getItem("finlayer-company-id"));
      console.log("  localStorage finlayer-company-name:", localStorage.getItem("finlayer-company-name"));

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
            localStorage.setItem("finlayer-company-name", currentCompanyName);
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

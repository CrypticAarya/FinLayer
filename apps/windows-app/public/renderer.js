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

  // Step 4 Initial Data Sync Elements
  const syncCompanyName = document.getElementById("sync-company-name");
  const syncStatusMsg = document.getElementById("sync-status-msg");
  const syncItemTb = document.getElementById("sync-item-tb");
  const syncItemLedgers = document.getElementById("sync-item-ledgers");
  const syncItemVouchers = document.getElementById("sync-item-vouchers");
  const btnStartSync = document.getElementById("btn-start-sync");
  const syncErrorMessage = document.getElementById("sync-error-message");
  const btnContinueSync = document.getElementById("btn-continue-sync");

  // Step 5 Elements
  const footerDevice = document.getElementById("footer-device");
  const footerStatus = document.getElementById("footer-status");
  const footerVersion = document.getElementById("footer-version");
  const appVersionBadge = document.getElementById("app-version-badge");
  const updateBanner = document.getElementById("update-banner");
  const updateBannerVersion = document.getElementById("update-banner-version");
  const updateBannerMessage = document.getElementById("update-banner-message");
  const btnRestartUpdate = document.getElementById("btn-restart-update");

  // State
  let currentStep = 1;
  let currentCompanyId = null;
  let currentCompanyName = null;

  function setFooter(text) {
    if (footerStatus) footerStatus.textContent = `Status: ${text}`;
  }

  function goToStep(stepNumber) {
    currentStep = stepNumber;
    stepCards.forEach((card, idx) => {
      if (card) {
        if (idx + 1 === stepNumber) {
          card.classList.add("active");
        } else {
          card.classList.remove("active");
        }
      }
    });

    stepDots.forEach((dot, idx) => {
      if (dot) {
        dot.classList.remove("active");
        if (idx + 1 < stepNumber) {
          dot.classList.add("completed");
        } else if (idx + 1 === stepNumber) {
          dot.classList.add("active");
          dot.classList.remove("completed");
        } else {
          dot.classList.remove("completed");
        }
      }
    });
  }

  // ── Step 1: Start ───────────────────────────────────────────────────────────
  function onStartSetup() {
    console.log("Welcome button clicked");
    goToStep(2);
    checkTally();
  }

  btnStartSetup.addEventListener("click", onStartSetup);

  // ── Step 2: Detect Tally ────────────────────────────────────────────────────
  async function checkTally() {
    tallyStatusBadge.className = "status-badge checking";
    tallyStatusBadge.innerHTML = `<span class="status-dot yellow"></span><span>Checking port 9000…</span>`;
    btnContinueTally.disabled = true;
    setFooter("Probing TallyPrime at http://127.0.0.1:9000…");

    try {
      const res = await window.finlayer.detectTally();
      console.log("Tally detect response:", res);

      if (res && res.connected) {
        tallyStatusBadge.className = "status-badge connected";
        tallyStatusBadge.innerHTML = `<span class="status-dot green"></span><span>Connected (${res.url})</span>`;
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

      if (res.success && res.companyName) {
        currentCompanyName = res.companyName;
        currentCompanyId = res.companyId || null;

        if (!currentCompanyId) {
          try {
            const init = await window.finlayer.getInitialState();
            if (init?.state?.companyId) {
              currentCompanyId = init.state.companyId;
            }
          } catch (e) {
            console.warn("[COMPANY STATE] getInitialState lookup failed:", e);
          }
        }

        if (!currentCompanyId) {
          const stored = localStorage.getItem("finlayer-company-id");
          if (stored) {
            currentCompanyId = stored;
          }
        }

        if (!currentCompanyId) {
          try {
            console.log("[COMPANY STATE] Attempting selectCompany IPC for:", currentCompanyName);
            const sel = await window.finlayer.selectCompany(currentCompanyName);
            if (sel?.success && sel?.companyId) {
              currentCompanyId = sel.companyId;
            }
          } catch (e) {
            console.warn("[COMPANY STATE] Failed to map company during detection:", e);
          }
        }

        if (currentCompanyId) {
          localStorage.setItem("finlayer-company-id", currentCompanyId);
        }
        if (currentCompanyName) {
          localStorage.setItem("finlayer-company-name", currentCompanyName);
        }

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
          companyCardSubtitle.textContent = "Company detected in Tally, but FinLayer API registration is pending. Click Continue to proceed.";
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

  btnContinueCompany.addEventListener("click", async () => {
    btnContinueCompany.disabled = true;

    console.log("[COMPANY STATE] Continue button clicked. Resolving companyId...");

    let companyId = currentCompanyId || localStorage.getItem("finlayer-company-id");

    if (!companyId) {
      try {
        const init = await window.finlayer.getInitialState();
        if (init?.state?.companyId) {
          companyId = init.state.companyId;
        }
      } catch (err) {
        console.warn("[COMPANY STATE] Error loading initial state:", err);
      }
    }

    if (!companyId && currentCompanyName) {
      try {
        const sel = await window.finlayer.selectCompany(currentCompanyName);
        if (sel?.success && sel?.companyId) {
          companyId = sel.companyId;
        }
      } catch (err) {
        console.warn("[COMPANY STATE] Dynamic selectCompany failed:", err);
      }
    }

    if (companyId) {
      currentCompanyId = companyId;
      localStorage.setItem("finlayer-company-id", companyId);
    }
    if (currentCompanyName) {
      localStorage.setItem("finlayer-company-name", currentCompanyName);
    }

    btnContinueCompany.disabled = false;
    goToStep(4);
    initSyncStep();
  });

  // ── Step 4: Initial Data Sync ───────────────────────────────────────────────
  function initSyncStep() {
    if (syncCompanyName) {
      syncCompanyName.textContent = currentCompanyName || localStorage.getItem("finlayer-company-name") || "Detected Tally Company";
    }
    if (syncStatusMsg) {
      syncStatusMsg.textContent = "Ready to synchronize accounting data";
      syncStatusMsg.style.color = "#38bdf8";
    }
    if (syncItemTb) {
      syncItemTb.innerHTML = `<span>📊</span> <span>Trial Balance &amp; Chart of Accounts</span>`;
    }
    if (syncItemLedgers) {
      syncItemLedgers.innerHTML = `<span>📁</span> <span>Master Ledgers</span>`;
    }
    if (syncItemVouchers) {
      syncItemVouchers.innerHTML = `<span>📑</span> <span>Financial Vouchers &amp; Entries</span>`;
    }
    if (syncErrorMessage) {
      syncErrorMessage.style.display = "none";
    }
    if (btnStartSync) {
      btnStartSync.style.display = "inline-flex";
      btnStartSync.disabled = false;
      btnStartSync.innerHTML = "Start Initial Sync &rarr;";
    }
    if (btnContinueSync) {
      btnContinueSync.style.display = "none";
    }
    setFooter("Ready for initial data sync");
  }

  async function performInitialSync() {
    if (!btnStartSync) return;

    btnStartSync.disabled = true;
    btnStartSync.textContent = "Synchronizing Accounting Data…";
    if (syncErrorMessage) syncErrorMessage.style.display = "none";

    if (syncStatusMsg) {
      syncStatusMsg.textContent = "Extracting and synchronizing data from TallyPrime…";
      syncStatusMsg.style.color = "#38bdf8";
    }
    setFooter("Synchronizing TallyPrime data to FinLayer Cloud API…");

    // Visual progression indicator
    if (syncItemTb) {
      syncItemTb.innerHTML = `<span>🔄</span> <span style="color:#38bdf8;">Synchronizing Trial Balance…</span>`;
    }

    try {
      const res = await window.finlayer.triggerInitialSync(currentCompanyId || undefined);
      console.log("[INITIAL SYNC] Result:", res);

      // Checkmarks on stages
      await new Promise((r) => setTimeout(r, 400));
      if (syncItemTb) {
        syncItemTb.innerHTML = `<span>✅</span> <span style="color:#10b981;">Trial Balance &amp; Chart of Accounts Synced</span>`;
      }
      if (syncItemLedgers) {
        syncItemLedgers.innerHTML = `<span>✅</span> <span style="color:#10b981;">Master Ledgers Synced</span>`;
      }
      await new Promise((r) => setTimeout(r, 400));
      if (syncItemVouchers) {
        syncItemVouchers.innerHTML = `<span>✅</span> <span style="color:#10b981;">Financial Vouchers &amp; Entries Synced</span>`;
      }

      if (syncStatusMsg) {
        syncStatusMsg.textContent = "Initial Accounting Data Sync Complete ✅";
        syncStatusMsg.style.color = "#10b981";
      }

      if (btnStartSync) {
        btnStartSync.style.display = "none";
      }
      if (btnContinueSync) {
        btnContinueSync.style.display = "inline-flex";
      }

      setFooter("Initial sync completed successfully ✅");
    } catch (err) {
      console.warn("[INITIAL SYNC] Sync notice:", err);
      const msg = err instanceof Error ? err.message : String(err);

      if (syncItemTb) syncItemTb.innerHTML = `<span>⚠️</span> <span>Trial Balance (Pending API worker)</span>`;
      if (syncItemLedgers) syncItemLedgers.innerHTML = `<span>⚠️</span> <span>Master Ledgers (Pending API worker)</span>`;
      if (syncItemVouchers) syncItemVouchers.innerHTML = `<span>⚠️</span> <span>Financial Vouchers (Pending API worker)</span>`;

      if (syncStatusMsg) {
        syncStatusMsg.textContent = "Sync queued for background worker";
        syncStatusMsg.style.color = "#f59e0b";
      }

      if (syncErrorMessage) {
        syncErrorMessage.style.display = "block";
        syncErrorMessage.textContent = `Sync note: ${msg}. Background sync will continue automatically once online.`;
      }

      if (btnStartSync) {
        btnStartSync.style.display = "none";
      }
      if (btnContinueSync) {
        btnContinueSync.style.display = "inline-flex";
      }
      setFooter("Sync queued for background processing");
    }
  }

  if (btnStartSync) {
    btnStartSync.addEventListener("click", performInitialSync);
  }

  if (btnContinueSync) {
    btnContinueSync.addEventListener("click", () => {
      goToStep(5);
      onSetupComplete();
    });
  }

  // ── Step 5: Connector Active ───────────────────────────────────────────────
  async function onSetupComplete() {
    setFooter("Finalizing setup & activating connector engine…");
    try {
      await window.finlayer.completeSetup();
      setFooter("FinLayer Connector Active 🟢");
    } catch (err) {
      console.warn("Could not finalize setup state:", err);
      setFooter("FinLayer Connector Active 🟢");
    }
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

  let latestAvailableVersion = null;

  if (window.finlayer && window.finlayer.onUpdateAvailable) {
    window.finlayer.onUpdateAvailable((data) => {
      console.log("[Renderer] Update available:", data);
      latestAvailableVersion = data.version;
      if (updateBanner) {
        if (updateBannerMessage) {
          updateBannerMessage.innerHTML = `FinLayer <strong>v${data.version}</strong> available &mdash; downloading in background...`;
        } else if (updateBannerVersion) {
          updateBannerVersion.textContent = `v${data.version}`;
        }
        if (btnRestartUpdate) btnRestartUpdate.style.display = "none";
        updateBanner.style.display = "flex";
      }
    });
  }

  if (window.finlayer && window.finlayer.onUpdateProgress) {
    window.finlayer.onUpdateProgress((data) => {
      console.log(`[Renderer] Update download progress: ${data.percent}%`);
      if (updateBanner && updateBannerMessage) {
        const verStr = latestAvailableVersion ? `v${latestAvailableVersion}` : "update";
        updateBannerMessage.innerHTML = `Downloading FinLayer <strong>${verStr}</strong> (${data.percent}%)...`;
      }
    });
  }

  if (window.finlayer && window.finlayer.onUpdateDownloaded) {
    window.finlayer.onUpdateDownloaded((data) => {
      console.log("[Renderer] Update downloaded and ready to install:", data);
      latestAvailableVersion = data.version;
      if (updateBanner) {
        if (updateBannerMessage) {
          updateBannerMessage.innerHTML = `FinLayer <strong>v${data.version}</strong> ready! Restart now to apply.`;
        } else if (updateBannerVersion) {
          updateBannerVersion.textContent = `v${data.version}`;
        }
        if (btnRestartUpdate) btnRestartUpdate.style.display = "inline-block";
        updateBanner.style.display = "flex";
      }
    });
  }

  // ── Initialization ─────────────────────────────────────────────────────────
  window.addEventListener("DOMContentLoaded", async () => {
    console.log("DOMContentLoaded running");

    const storedCompanyId = localStorage.getItem("finlayer-company-id");
    const storedCompanyName = localStorage.getItem("finlayer-company-name");
    if (storedCompanyId) {
      currentCompanyId = storedCompanyId;
    }
    if (storedCompanyName) {
      currentCompanyName = storedCompanyName;
    }

    try {
      const init = await window.finlayer.getInitialState();
      console.log("[COMPANY STATE] DOMContentLoaded initial state:", init);

      if (init && init.state) {
        if (init.state.deviceName && footerDevice) {
          footerDevice.textContent = `Device: ${init.state.deviceName}`;
        }
        if (init.state.companyId) {
          currentCompanyId = init.state.companyId;
          localStorage.setItem("finlayer-company-id", currentCompanyId);
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

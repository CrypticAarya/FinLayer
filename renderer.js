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
  let googlePollInterval = null;

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
        currentCompanyId = res.companyId;
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
      googleErrorMessage.textContent = msg || "Unable to connect Google Account. Please try again.";
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
    checkGoogleConnection(companyId);
  }

  async function checkGoogleConnection(companyId) {
    if (!companyId) return false;

    try {
      const res = await window.finlayer.checkGoogleStatus(companyId);
      if (res && res.connected) {
        googleStatusBadge.className = "status-badge connected";
        googleStatusBadge.innerHTML = `<span class="status-dot green"></span><span>Google Connected ✅</span>`;
        if (btnConnectGoogle) btnConnectGoogle.style.display = "none";
        if (btnContinueGoogle) btnContinueGoogle.style.display = "flex";
        hideGoogleError();
        setFooter("Google Sheet connected");

        if (googlePollInterval) {
          clearInterval(googlePollInterval);
          googlePollInterval = null;
        }
        return true;
      } else {
        googleStatusBadge.className = "status-badge not-connected";
        googleStatusBadge.innerHTML = `<span class="status-dot red"></span><span>Not Connected</span>`;
        setFooter("Waiting for Google connection");
        return false;
      }
    } catch {
      return false;
    }
  }

  async function handleGoogleConnectClick() {
    console.log("[Google] Connect button clicked");
    console.log("[Google] Current company ID:", currentCompanyId);

    hideGoogleError();

    let companyId = currentCompanyId;

    // Read from state: connector-state.json (Google button does not depend only on renderer memory)
    if (!companyId) {
      try {
        const init = await window.finlayer.getInitialState();
        if (init?.state?.companyId) {
          companyId = init.state.companyId;
          currentCompanyId = companyId;
          console.log("[Google] Read companyId from state:", companyId);
        }
      } catch (err) {
        console.warn("[Google] Error loading state:", err);
      }
    }

    if (!companyId) {
      console.error("[Google] Company ID missing!");
      showGoogleError("Unable to connect Google Account. Please try again.");
      return;
    }

    try {
      const result = await window.finlayer.startGoogleAuth(companyId);
      console.log("[Google] Google auth result:", result);

      if (!result || !result.success) {
        showGoogleError("Unable to connect Google Account. Please try again.");
        return;
      }

      setFooter("Browser opened for Google OAuth");

      // Start polling
      if (!googlePollInterval) {
        googlePollInterval = setInterval(async () => {
          const connected = await checkGoogleConnection(companyId);
          if (connected) {
            goToStep(5);
            onSetupComplete();
          }
        }, 3000);
      }
    } catch (err) {
      console.error("[Google] startGoogleAuth error:", err);
      showGoogleError("Unable to connect Google Account. Please try again.");
    }
  }

  btnContinueCompany.addEventListener("click", async () => {
    if (!currentCompanyId) {
      try {
        const init = await window.finlayer.getInitialState();
        if (init?.state?.companyId) {
          currentCompanyId = init.state.companyId;
        }
      } catch {}
    }
    goToStep(4);
    initGoogleStep(currentCompanyId);
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
    try {
      const init = await window.finlayer.getInitialState();
      if (init && init.state) {
        if (init.state.deviceName && footerDevice) {
          footerDevice.textContent = `Device: ${init.state.deviceName}`;
        }
        if (init.state.companyId) {
          currentCompanyId = init.state.companyId;
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

      // Attach Google Connect button listener after DOM is ready
      const btnGoogle = document.getElementById("btn-connect-google");
      if (btnGoogle) {
        btnGoogle.addEventListener("click", handleGoogleConnectClick);
        console.log("[Google] Attached click listener to btn-connect-google after DOMContentLoaded");
      }
    } catch (err) {
      console.warn("Failed to get initial state/version:", err);
    }
  });
})();

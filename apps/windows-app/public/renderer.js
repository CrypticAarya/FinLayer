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

  const companyDropdown = document.getElementById("company-dropdown");
  const btnConfirmCompany = document.getElementById("btn-confirm-company");

  const googleStatusBadge = document.getElementById("google-status-badge");
  const googleStatusText = document.getElementById("google-status-text");
  const btnConnectGoogle = document.getElementById("btn-connect-google");
  const btnMockGoogle = document.getElementById("btn-mock-google");
  const btnContinueGoogle = document.getElementById("btn-continue-google");

  const btnOpenDashboard = document.getElementById("btn-open-dashboard");
  const footerDevice = document.getElementById("footer-device");
  const footerStatus = document.getElementById("footer-status");

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
    loadTallyCompanies();
  });

  // ── Step 3: Company Selection ──────────────────────────────────────────────
  async function loadTallyCompanies() {
    companyDropdown.innerHTML = `<option value="">Fetching companies from TallyPrime…</option>`;
    btnConfirmCompany.disabled = true;
    setFooter("Querying Tally companies…");

    try {
      const res = await window.finlayer.fetchTallyCompanies();
      if (res.success && res.companies && res.companies.length > 0) {
        companyDropdown.innerHTML = `<option value="">-- Choose a company --</option>`;
        res.companies.forEach((comp) => {
          const opt = document.createElement("option");
          opt.value = comp.name;
          opt.textContent = comp.name;
          companyDropdown.appendChild(opt);
        });

        // Auto-select first company
        companyDropdown.selectedIndex = 1;
        btnConfirmCompany.disabled = false;
        setFooter(`${res.companies.length} company(ies) found`);
      } else {
        companyDropdown.innerHTML = `<option value="">No companies open in TallyPrime</option>`;
        setFooter("No open companies found in Tally");
      }
    } catch (err) {
      companyDropdown.innerHTML = `<option value="">Error fetching companies</option>`;
      setFooter("Company fetch error");
    }
  }

  companyDropdown.addEventListener("change", () => {
    btnConfirmCompany.disabled = !companyDropdown.value;
  });

  btnConfirmCompany.addEventListener("click", async () => {
    const selected = companyDropdown.value;
    if (!selected) return;

    btnConfirmCompany.disabled = true;
    btnConfirmCompany.textContent = "Connecting to FinLayer API…";
    setFooter(`Mapping company "${selected}"…`);

    try {
      const res = await window.finlayer.selectCompany(selected);
      if (res.success && res.companyId) {
        currentCompanyId = res.companyId;
        setFooter(`Company mapped: ID ${res.companyId}`);
        goToStep(4);
        initGoogleStep(res.companyId);
      } else {
        alert("Failed to map company: " + (res.error || "Unknown error"));
        btnConfirmCompany.disabled = false;
        btnConfirmCompany.textContent = "Confirm Company →";
      }
    } catch (err) {
      alert("Error: " + (err.message || err));
      btnConfirmCompany.disabled = false;
      btnConfirmCompany.textContent = "Confirm Company →";
    }
  });

  // ── Step 4: Google Sheet Connection ────────────────────────────────────────
  async function initGoogleStep(companyId) {
    checkGoogleConnection(companyId);
  }

  async function checkGoogleConnection(companyId) {
    if (!companyId) return;

    try {
      const res = await window.finlayer.checkGoogleStatus(companyId);
      if (res.connected) {
        googleStatusBadge.className = "status-badge connected";
        googleStatusBadge.innerHTML = `<span class="status-dot green"></span><span>Google Connected ✅</span>`;
        btnConnectGoogle.style.display = "none";
        btnMockGoogle.style.display = "none";
        btnContinueGoogle.style.display = "flex";
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

  btnConnectGoogle.addEventListener("click", async () => {
    if (!currentCompanyId) return;
    try {
      await window.finlayer.startGoogleAuth(currentCompanyId);
      setFooter("Browser opened for Google OAuth");

      // Start polling
      if (!googlePollInterval) {
        googlePollInterval = setInterval(async () => {
          const connected = await checkGoogleConnection(currentCompanyId);
          if (connected) {
            goToStep(5);
            onSetupComplete();
          }
        }, 3000);
      }
    } catch (err) {
      alert("Could not start Google auth: " + err.message);
    }
  });

  btnMockGoogle.addEventListener("click", async () => {
    if (!currentCompanyId) return;
    try {
      setFooter("Connecting Google account (mock)...");
      const res = await window.finlayer.mockConnectGoogle(currentCompanyId);
      if (res.success) {
        await checkGoogleConnection(currentCompanyId);
        goToStep(5);
        onSetupComplete();
      } else {
        alert("Mock connect failed: " + (res.error || "Unknown"));
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
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
    } catch (err) {
      console.warn("Failed to get initial state:", err);
    }
  });
})();

import { contextBridge, ipcRenderer } from "electron";

export interface FinlayerApi {
  getInitialState: () => Promise<any>;
  detectTally: () => Promise<{ connected: boolean; url: string; statusText: string }>;
  fetchActiveCompany: () => Promise<{ success: boolean; companyName?: string; companyId?: string; connectorId?: string; noCompanyOpen?: boolean; error?: string }>;
  fetchTallyCompanies: () => Promise<{ success: boolean; companies: Array<{ name: string }>; error?: string }>;
  selectCompany: (companyName: string) => Promise<{ success: boolean; companyId?: string; connectorId?: string; error?: string }>;
  startGoogleAuth: (companyId: string) => Promise<{ success: boolean; url?: string; error?: string }>;
  checkGoogleStatus: (companyId: string) => Promise<{ connected: boolean; connection?: any; demoMode?: boolean }>;
  getSyncStatus: (companyId: string) => Promise<{ completed: boolean; summary?: any; lastSync?: any }>;
  completeSetup: () => Promise<{ success: boolean }>;
  openDashboard: () => Promise<{ success: boolean }>;
  getAppVersion: () => Promise<{ appVersion: string; connectorVersion: string; updateUrl: string }>;
  checkForUpdates: () => Promise<{ success: boolean; updateInfo?: any; error?: string }>;
  restartAndInstall: () => Promise<{ success: boolean }>;
  onUpdateDownloaded: (callback: (data: { version: string }) => void) => () => void;
  downloadExport: (type: string, format: string) => Promise<{ success: boolean; url?: string; error?: string }>;
}

const api: FinlayerApi = {
  getInitialState: () => ipcRenderer.invoke("finlayer:get-initial-state"),
  detectTally: () => ipcRenderer.invoke("finlayer:detect-tally"),
  fetchActiveCompany: () => ipcRenderer.invoke("finlayer:fetch-active-company"),
  fetchTallyCompanies: () => ipcRenderer.invoke("finlayer:fetch-tally-companies"),
  selectCompany: (name: string) => ipcRenderer.invoke("finlayer:select-company", name),
  startGoogleAuth: (companyId: string) => ipcRenderer.invoke("finlayer:start-google-auth", companyId),
  checkGoogleStatus: (companyId: string) => ipcRenderer.invoke("finlayer:check-google-status", companyId),
  getSyncStatus: (companyId: string) => ipcRenderer.invoke("finlayer:get-sync-status", companyId),
  completeSetup: () => ipcRenderer.invoke("finlayer:complete-setup"),
  openDashboard: () => ipcRenderer.invoke("finlayer:open-dashboard"),
  getAppVersion: () => ipcRenderer.invoke("finlayer:get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("finlayer:check-for-updates"),
  restartAndInstall: () => ipcRenderer.invoke("finlayer:restart-and-install"),
  downloadExport: (type: string, format: string) => ipcRenderer.invoke("finlayer:download-export", { type, format }),
  onUpdateDownloaded: (callback: (data: { version: string }) => void) => {
    const listener = (_event: any, data: { version: string }) => callback(data);
    ipcRenderer.on("finlayer:update-downloaded", listener);
    return () => {
      ipcRenderer.removeListener("finlayer:update-downloaded", listener);
    };
  },
};

contextBridge.exposeInMainWorld("finlayer", api);

import { contextBridge, ipcRenderer } from "electron";

export interface FinlayerApi {
  getInitialState: () => Promise<any>;
  detectTally: () => Promise<{ connected: boolean; url: string; statusText: string }>;
  fetchActiveCompany: () => Promise<{ success: boolean; companyName?: string; companyId?: string; connectorId?: string; noCompanyOpen?: boolean; error?: string }>;
  fetchTallyCompanies: () => Promise<{ success: boolean; companies: Array<{ name: string }>; error?: string }>;
  selectCompany: (companyName: string) => Promise<{ success: boolean; companyId?: string; connectorId?: string; error?: string }>;
  startGoogleAuth: (companyId: string) => Promise<{ success: boolean; url: string }>;
  mockConnectGoogle: (companyId: string) => Promise<{ success: boolean; connection?: any }>;
  checkGoogleStatus: (companyId: string) => Promise<{ connected: boolean; connection?: any }>;
  completeSetup: () => Promise<{ success: boolean }>;
  openDashboard: () => Promise<{ success: boolean }>;
}

const api: FinlayerApi = {
  getInitialState: () => ipcRenderer.invoke("finlayer:get-initial-state"),
  detectTally: () => ipcRenderer.invoke("finlayer:detect-tally"),
  fetchActiveCompany: () => ipcRenderer.invoke("finlayer:fetch-active-company"),
  fetchTallyCompanies: () => ipcRenderer.invoke("finlayer:fetch-tally-companies"),
  selectCompany: (name: string) => ipcRenderer.invoke("finlayer:select-company", name),
  startGoogleAuth: (companyId: string) => ipcRenderer.invoke("finlayer:start-google-auth", companyId),
  mockConnectGoogle: (companyId: string) => ipcRenderer.invoke("finlayer:mock-connect-google", companyId),
  checkGoogleStatus: (companyId: string) => ipcRenderer.invoke("finlayer:check-google-status", companyId),
  completeSetup: () => ipcRenderer.invoke("finlayer:complete-setup"),
  openDashboard: () => ipcRenderer.invoke("finlayer:open-dashboard"),
};

contextBridge.exposeInMainWorld("finlayer", api);

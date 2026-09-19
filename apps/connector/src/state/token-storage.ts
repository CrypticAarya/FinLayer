import { loadConnectorState, saveConnectorState } from "./state-store.js";

/**
 * Interface for connector token storage.
 * Enables plugging in OS-level native secure storage (Electron safeStorage / DPAPI)
 * without coupling the connector to plaintext JSON storage.
 */
export interface ITokenStorage {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}

/**
 * Default fallback implementation for environments without Electron / OS secure storage.
 */
export class DefaultFileTokenStorage implements ITokenStorage {
  async getToken(): Promise<string | null> {
    const state = await loadConnectorState();
    return state?.connectorToken ?? null;
  }

  async setToken(token: string): Promise<void> {
    const state = await loadConnectorState();
    if (state) {
      state.connectorToken = token;
      await saveConnectorState(state);
    }
  }

  async clearToken(): Promise<void> {
    const state = await loadConnectorState();
    if (state) {
      delete state.connectorToken;
      delete state.encryptedConnectorToken;
      await saveConnectorState(state);
    }
  }
}

/**
 * Global TokenStorageManager providing access to the active token storage provider.
 * Allows Electron or Windows Desktop container to inject a secure provider via setProvider().
 */
export class TokenStorageManager {
  private static provider: ITokenStorage = new DefaultFileTokenStorage();

  public static setProvider(customProvider: ITokenStorage): void {
    TokenStorageManager.provider = customProvider;
  }

  public static getProvider(): ITokenStorage {
    return TokenStorageManager.provider;
  }

  public static async getToken(): Promise<string | null> {
    return TokenStorageManager.provider.getToken();
  }

  public static async setToken(token: string): Promise<void> {
    return TokenStorageManager.provider.setToken(token);
  }

  public static async clearToken(): Promise<void> {
    return TokenStorageManager.provider.clearToken();
  }
}

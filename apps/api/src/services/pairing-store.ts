import crypto from "node:crypto";

export interface PairingEntry {
  code: string;
  companyId: string;
  createdAt: number;
  expiresAt: number;
  createdBy?: string;
}

/**
 * Storage interface for connector-company pairing codes.
 * Allows seamless replacement of in-memory store with Redis or distributed KV store.
 */
export interface IPairingStore {
  createCode(companyId: string, createdBy?: string, ttlSeconds?: number): Promise<string>;
  verifyAndConsumeCode(code: string): Promise<PairingEntry | null>;
  peekCode(code: string): Promise<PairingEntry | null>;
  revokeCode(code: string): Promise<boolean>;
}

/**
 * In-memory implementation of IPairingStore.
 * Suitable for single-process deployments and testing.
 */
export class MemoryPairingStore implements IPairingStore {
  private readonly store = new Map<string, PairingEntry>();

  async createCode(
    companyId: string,
    createdBy?: string,
    ttlSeconds = 900 // 15 minutes default
  ): Promise<string> {
    const randomHex = crypto.randomBytes(3).toString("hex").toUpperCase();
    const code = `FL-${randomHex}`;
    const now = Date.now();

    this.store.set(code, {
      code,
      companyId,
      createdBy,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
    });

    return code;
  }

  async verifyAndConsumeCode(code: string): Promise<PairingEntry | null> {
    const cleanCode = code.trim().toUpperCase();
    const entry = this.store.get(cleanCode);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(cleanCode);
      return null;
    }

    // Single-use: delete once consumed to prevent replay attacks
    this.store.delete(cleanCode);
    return entry;
  }

  async peekCode(code: string): Promise<PairingEntry | null> {
    const cleanCode = code.trim().toUpperCase();
    const entry = this.store.get(cleanCode);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(cleanCode);
      return null;
    }
    return entry;
  }

  async revokeCode(code: string): Promise<boolean> {
    const cleanCode = code.trim().toUpperCase();
    return this.store.delete(cleanCode);
  }

  /**
   * Cleans up expired codes (can be called periodically or in tests).
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [code, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(code);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Global PairingStoreManager allowing runtime injection of Redis or other backing store.
 */
export class PairingStoreManager {
  private static instance: IPairingStore = new MemoryPairingStore();

  public static getStore(): IPairingStore {
    return PairingStoreManager.instance;
  }

  public static setStore(store: IPairingStore): void {
    PairingStoreManager.instance = store;
  }
}

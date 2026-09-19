import prisma from "../db/prisma.js";

export type SyncStage =
  | "SYNC_STARTED"
  | "SYNC_VALIDATING"
  | "SYNC_PROCESSING"
  | "SYNC_COMPLETED"
  | "SYNC_FAILED";

export interface StartSyncRunParams {
  companyId: string;
  syncRunId?: string;
  recordsFetched: number;
}

export interface CompleteSyncRunParams {
  syncRunId: string;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  errorSummary?: string;
}

export class SyncAuditService {
  /**
   * Initializes or claims a SyncRun in SYNC_STARTED state and records the audit log event.
   */
  public static async startSyncRun(params: StartSyncRunParams): Promise<string> {
    const { companyId, syncRunId, recordsFetched } = params;

    let syncRun;
    if (syncRunId) {
      syncRun = await prisma.syncRun.upsert({
        where: { id: syncRunId },
        update: {
          status: "SYNC_STARTED",
          recordsFetched,
          startedAt: new Date(),
          completedAt: null,
          errorSummary: null,
        },
        create: {
          id: syncRunId,
          companyId,
          status: "SYNC_STARTED",
          recordsFetched,
          startedAt: new Date(),
        },
      });
    } else {
      syncRun = await prisma.syncRun.create({
        data: {
          companyId,
          status: "SYNC_STARTED",
          recordsFetched,
          startedAt: new Date(),
        },
      });
    }

    await prisma.syncAuditLog.create({
      data: {
        syncRunId: syncRun.id,
        stage: "SYNC_STARTED",
        message: `Sync started with ${recordsFetched} vouchers received.`,
        metadata: { recordsFetched },
      },
    });

    return syncRun.id;
  }

  /**
   * Transitions the SyncRun stage and appends to the audit trail.
   */
  public static async recordStage(
    syncRunId: string,
    stage: SyncStage,
    message?: string,
    metadata?: any
  ): Promise<void> {
    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: syncRunId },
        data: { status: stage },
      }),
      prisma.syncAuditLog.create({
        data: {
          syncRunId,
          stage,
          message: message ?? null,
          metadata: metadata ?? undefined,
        },
      }),
    ]);
  }

  /**
   * Marks the SyncRun as COMPLETED (or FAILED if all records failed) and records final statistics.
   */
  public static async completeSyncRun(params: CompleteSyncRunParams): Promise<void> {
    const { syncRunId, recordsCreated, recordsUpdated, recordsFailed, errorSummary } = params;

    const status: SyncStage =
      recordsFailed > 0 && recordsCreated === 0 && recordsUpdated === 0
        ? "SYNC_FAILED"
        : "SYNC_COMPLETED";

    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: syncRunId },
        data: {
          status,
          completedAt: new Date(),
          recordsCreated,
          recordsUpdated,
          recordsFailed,
          errorSummary: errorSummary ?? null,
        },
      }),
      prisma.syncAuditLog.create({
        data: {
          syncRunId,
          stage: status,
          message: `Sync finished with status ${status}. Created: ${recordsCreated}, Updated: ${recordsUpdated}, Failed: ${recordsFailed}.`,
          metadata: {
            recordsCreated,
            recordsUpdated,
            recordsFailed,
            errorSummary: errorSummary ?? null,
          },
        },
      }),
    ]);
  }

  /**
   * Records a fatal sync failure.
   */
  public static async failSyncRun(syncRunId: string, error: string): Promise<void> {
    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: syncRunId },
        data: {
          status: "SYNC_FAILED",
          completedAt: new Date(),
          errorSummary: error,
        },
      }),
      prisma.syncAuditLog.create({
        data: {
          syncRunId,
          stage: "SYNC_FAILED",
          message: `Sync failed: ${error}`,
          metadata: { error },
        },
      }),
    ]);
  }
}

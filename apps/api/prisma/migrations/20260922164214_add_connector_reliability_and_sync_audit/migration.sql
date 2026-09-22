-- AlterTable
ALTER TABLE "Connector" ADD COLUMN     "connectorVersion" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syncType" TEXT NOT NULL DEFAULT 'VOUCHERS';

-- CreateTable
CREATE TABLE "ConnectorHeartbeat" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "companyId" TEXT,
    "connectorVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ONLINE',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectorHeartbeat_connectorId_idx" ON "ConnectorHeartbeat"("connectorId");

-- CreateIndex
CREATE INDEX "ConnectorHeartbeat_companyId_idx" ON "ConnectorHeartbeat"("companyId");

-- CreateIndex
CREATE INDEX "ConnectorHeartbeat_lastSeenAt_idx" ON "ConnectorHeartbeat"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Connector_companyId_status_idx" ON "Connector"("companyId", "status");

-- CreateIndex
CREATE INDEX "SyncRun_companyId_completedAt_idx" ON "SyncRun"("companyId", "completedAt");

-- AddForeignKey
ALTER TABLE "ConnectorHeartbeat" ADD CONSTRAINT "ConnectorHeartbeat_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

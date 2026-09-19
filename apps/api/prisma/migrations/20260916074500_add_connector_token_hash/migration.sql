-- AlterTable
ALTER TABLE "Connector" ADD COLUMN "tokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Connector_tokenHash_key" ON "Connector"("tokenHash");

-- CreateIndex
CREATE INDEX "Connector_tokenHash_idx" ON "Connector"("tokenHash");

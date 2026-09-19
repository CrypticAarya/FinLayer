-- AlterTable
ALTER TABLE "Connector" ADD COLUMN "tokenCreatedAt" TIMESTAMP(3),
ADD COLUMN "tokenLastUsedAt" TIMESTAMP(3),
ADD COLUMN "tokenRevokedAt" TIMESTAMP(3);

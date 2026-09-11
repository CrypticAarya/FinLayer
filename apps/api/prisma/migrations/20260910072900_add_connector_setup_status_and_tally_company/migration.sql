-- AlterTable
ALTER TABLE "Connector" ADD COLUMN     "setupStatus" TEXT NOT NULL DEFAULT 'REGISTERED',
ADD COLUMN     "tallyCompanyName" TEXT;

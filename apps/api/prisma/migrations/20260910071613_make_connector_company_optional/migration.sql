-- DropForeignKey
ALTER TABLE "Connector" DROP CONSTRAINT "Connector_companyId_fkey";

-- AlterTable
ALTER TABLE "Connector" ADD COLUMN     "operatingSystem" TEXT,
ALTER COLUMN "companyId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

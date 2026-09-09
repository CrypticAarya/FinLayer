-- CreateTable
CREATE TABLE "SaasApplication" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasCompanyMapping" (
    "id" TEXT NOT NULL,
    "saasApplicationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaasCompanyMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaasApplication_apiKey_key" ON "SaasApplication"("apiKey");

-- CreateIndex
CREATE INDEX "SaasCompanyMapping_saasApplicationId_idx" ON "SaasCompanyMapping"("saasApplicationId");

-- CreateIndex
CREATE INDEX "SaasCompanyMapping_companyId_idx" ON "SaasCompanyMapping"("companyId");

-- CreateIndex
CREATE INDEX "SaasCompanyMapping_externalCustomerId_idx" ON "SaasCompanyMapping"("externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "SaasCompanyMapping_saasApplicationId_companyId_key" ON "SaasCompanyMapping"("saasApplicationId", "companyId");

-- AddForeignKey
ALTER TABLE "SaasCompanyMapping" ADD CONSTRAINT "SaasCompanyMapping_saasApplicationId_fkey" FOREIGN KEY ("saasApplicationId") REFERENCES "SaasApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasCompanyMapping" ADD CONSTRAINT "SaasCompanyMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

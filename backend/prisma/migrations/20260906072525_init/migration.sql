-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('Drafting', 'Submitted', 'Abandoned');

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "originator" TEXT NOT NULL,
    "borrower" TEXT NOT NULL,
    "termsJson" JSONB NOT NULL,
    "manifestHash" TEXT,
    "manifestKey" TEXT,
    "proposalId" TEXT,
    "chainTxHash" TEXT,
    "status" "DraftStatus" NOT NULL DEFAULT 'Drafting',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "token" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "Nonce" (
    "value" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Nonce_pkey" PRIMARY KEY ("value")
);

-- CreateTable
CREATE TABLE "SpentAuthorization" (
    "nonce" TEXT NOT NULL,
    "payer" TEXT NOT NULL,
    "payTo" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "txHash" TEXT,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpentAuthorization_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE UNIQUE INDEX "Draft_proposalId_key" ON "Draft"("proposalId");

-- CreateIndex
CREATE INDEX "Draft_originator_idx" ON "Draft"("originator");

-- CreateIndex
CREATE INDEX "Draft_borrower_idx" ON "Draft"("borrower");

-- CreateIndex
CREATE UNIQUE INDEX "Document_r2Key_key" ON "Document"("r2Key");

-- CreateIndex
CREATE INDEX "Document_draftId_idx" ON "Document"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_draftId_contentHash_key" ON "Document"("draftId", "contentHash");

-- CreateIndex
CREATE INDEX "Session_address_idx" ON "Session"("address");

-- CreateIndex
CREATE INDEX "SpentAuthorization_payer_idx" ON "SpentAuthorization"("payer");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

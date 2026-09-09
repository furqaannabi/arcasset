-- CreateTable
CREATE TABLE "Mandate" (
    "noteId" TEXT NOT NULL,
    "periodIndex" INTEGER NOT NULL,
    "borrower" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "validAfter" TEXT NOT NULL,
    "validBefore" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "collectedTx" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("noteId","periodIndex")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mandate_nonce_key" ON "Mandate"("nonce");

-- CreateIndex
CREATE INDEX "Mandate_borrower_idx" ON "Mandate"("borrower");

-- Restore lands in recovery mode: external outbox rows stay paused until the owner releases them.
ALTER TABLE "Company" ADD COLUMN "recoveryMode" BOOLEAN NOT NULL DEFAULT false;

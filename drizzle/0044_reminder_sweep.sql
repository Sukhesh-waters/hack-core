-- Migration 0044: Reminder Sweep (Slice C1)
-- Adds notified_at column to hub_reminders for Resend reminder sweeps

ALTER TABLE "hub_reminders" ADD COLUMN IF NOT EXISTS "notified_at" timestamp;

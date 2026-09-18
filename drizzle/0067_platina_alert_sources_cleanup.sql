ALTER TABLE "platina_alert_rules" ADD COLUMN "source" text DEFAULT 'outcome' NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" DROP COLUMN "cadence";
ALTER TABLE "ai_usage" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "error" text;
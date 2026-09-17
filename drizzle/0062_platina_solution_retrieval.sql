ALTER TABLE "platina_campaigns" ADD COLUMN "use_case" text;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "similarity_floor" real DEFAULT 0.35 NOT NULL;
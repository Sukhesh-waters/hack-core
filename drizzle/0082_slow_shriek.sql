CREATE TABLE "platina_creative_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"creative_id" text NOT NULL,
	"captured_at" timestamp NOT NULL,
	"impressions" integer,
	"reach" integer,
	"clicks" integer,
	"engagements" integer,
	"saves" integer,
	"shares" integer,
	"video_views" integer,
	"leads" integer,
	"spend" real,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_creative_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"creative_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"verdict" text,
	"facts" jsonb NOT NULL,
	"what" text,
	"why" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"how" text,
	"keep" text,
	"drafted_by" text DEFAULT 'model' NOT NULL,
	"draft_error" text,
	"confirmed_by_id" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_creatives" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text,
	"plan_id" text,
	"phase_id" text,
	"opportunity_key" text,
	"title" text NOT NULL,
	"channel" text NOT NULL,
	"format" text NOT NULL,
	"topic" text,
	"hook_type" text,
	"cta" text,
	"url" text,
	"external_id" text,
	"hypothesis" text NOT NULL,
	"posted_at" timestamp,
	"status" text DEFAULT 'live' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_first_party_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text,
	"kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"source_url" text,
	"title" text,
	"content" text NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"embedding" vector(768),
	"embedding_model_version" text DEFAULT 'gemini-embedding-001' NOT NULL,
	"superseded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_learning_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text,
	"kind" text NOT NULL,
	"review_id" text,
	"target_ref" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_own_site_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"priority" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"content_hash" text,
	"sitemap_lastmod" text,
	"etag" text,
	"last_modified" text,
	"change_detected_at" timestamp,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"last_read_at" timestamp,
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "own_site_daily_pages" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "own_site_max_pages" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "learning_min_n" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "learning_explore_share" real DEFAULT 0.2 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "review_after_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "learning_half_life_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_creative_metrics" ADD CONSTRAINT "platina_creative_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_creative_metrics" ADD CONSTRAINT "platina_creative_metrics_creative_id_platina_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."platina_creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_creative_metrics" ADD CONSTRAINT "platina_creative_metrics_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_creative_reviews" ADD CONSTRAINT "platina_creative_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_creative_reviews" ADD CONSTRAINT "platina_creative_reviews_creative_id_platina_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."platina_creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_creative_reviews" ADD CONSTRAINT "platina_creative_reviews_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_creatives" ADD CONSTRAINT "platina_creatives_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_creatives" ADD CONSTRAINT "platina_creatives_plan_id_platina_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."platina_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_creatives" ADD CONSTRAINT "platina_creatives_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_first_party_chunks" ADD CONSTRAINT "platina_first_party_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_learning_events" ADD CONSTRAINT "platina_learning_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_own_site_pages" ADD CONSTRAINT "platina_own_site_pages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_creative_metrics_workspace_id_idx" ON "platina_creative_metrics" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_creative_metrics_creative_idx" ON "platina_creative_metrics" USING btree ("creative_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_creative_metrics_snapshot_unique" ON "platina_creative_metrics" USING btree ("workspace_id","creative_id","captured_at","source");--> statement-breakpoint
CREATE INDEX "platina_creative_reviews_workspace_id_idx" ON "platina_creative_reviews" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_creative_reviews_creative_unique" ON "platina_creative_reviews" USING btree ("creative_id");--> statement-breakpoint
CREATE INDEX "platina_creatives_workspace_id_idx" ON "platina_creatives" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_creatives_plan_idx" ON "platina_creatives" USING btree ("workspace_id","plan_id");--> statement-breakpoint
CREATE INDEX "platina_creatives_brand_idx" ON "platina_creatives" USING btree ("workspace_id","brand_id");--> statement-breakpoint
CREATE INDEX "platina_first_party_chunks_workspace_id_idx" ON "platina_first_party_chunks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_first_party_chunks_source_idx" ON "platina_first_party_chunks" USING btree ("workspace_id","source_ref");--> statement-breakpoint
CREATE INDEX "platina_first_party_chunks_brand_idx" ON "platina_first_party_chunks" USING btree ("workspace_id","brand_id","kind");--> statement-breakpoint
CREATE INDEX "platina_learning_events_workspace_id_idx" ON "platina_learning_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_learning_events_review_idx" ON "platina_learning_events" USING btree ("workspace_id","review_id");--> statement-breakpoint
CREATE INDEX "platina_own_site_pages_workspace_id_idx" ON "platina_own_site_pages" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_own_site_pages_unique" ON "platina_own_site_pages" USING btree ("workspace_id","brand_id","url");
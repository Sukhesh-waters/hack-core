CREATE TABLE "pattern_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"pattern_post_id" text NOT NULL,
	"author_handle" text,
	"text" text NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"taken_at" timestamp NOT NULL,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"handle" text NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"following" integer DEFAULT 0 NOT NULL,
	"posts_count" integer DEFAULT 0 NOT NULL,
	"bio" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"business_category" text,
	"profile_pic_url" text,
	"external_url" text,
	"taken_at" timestamp DEFAULT now() NOT NULL,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pattern_runs" ADD COLUMN "actor" text;--> statement-breakpoint
ALTER TABLE "pattern_comments" ADD CONSTRAINT "pattern_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_comments" ADD CONSTRAINT "pattern_comments_pattern_post_id_pattern_posts_id_fk" FOREIGN KEY ("pattern_post_id") REFERENCES "public"."pattern_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_profiles" ADD CONSTRAINT "pattern_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pattern_comments_workspace_id_idx" ON "pattern_comments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "pattern_comments_post_id_idx" ON "pattern_comments" USING btree ("pattern_post_id");--> statement-breakpoint
CREATE INDEX "pattern_profiles_workspace_id_idx" ON "pattern_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "pattern_profiles_handle_idx" ON "pattern_profiles" USING btree ("handle");
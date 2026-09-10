ALTER TYPE "public"."content_type" ADD VALUE 'talking_head';--> statement-breakpoint
ALTER TYPE "public"."content_type" ADD VALUE 'motion_graphic';--> statement-breakpoint
ALTER TYPE "public"."content_type" ADD VALUE 'static';--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "duration_sec" integer;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "pillar" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "strategy_note" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "due_at" timestamp;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_assignee_id_idx" ON "content" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "content_due_at_idx" ON "content" USING btree ("due_at");
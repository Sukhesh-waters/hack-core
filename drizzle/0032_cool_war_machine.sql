CREATE TYPE "public"."email_digest" AS ENUM('immediate', 'daily', 'off');--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "email_digest" "email_digest" DEFAULT 'immediate' NOT NULL;
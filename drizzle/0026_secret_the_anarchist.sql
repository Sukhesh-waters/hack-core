CREATE TYPE "public"."doc_kind" AS ENUM('doc', 'sop');--> statement-breakpoint
ALTER TABLE "workspace_docs" ADD COLUMN "kind" "doc_kind" DEFAULT 'doc' NOT NULL;
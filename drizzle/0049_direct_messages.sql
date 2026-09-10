-- Phase 2 Personal Chat / DM Subsystem Migration
DO $$ BEGIN
 CREATE TYPE "conversation_type" AS ENUM('direct', 'group');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
	"type" "conversation_type" DEFAULT 'direct' NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "conversations_workspace_id_idx" ON "conversations" ("workspace_id");

CREATE TABLE IF NOT EXISTS "conversation_participants" (
	"conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"last_read_at" timestamp,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);

CREATE INDEX IF NOT EXISTS "conversation_participants_user_idx" ON "conversation_participants" ("user_id");

CREATE TABLE IF NOT EXISTS "direct_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
	"sender_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"body" text NOT NULL,
	"attachments" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "direct_messages_conversation_id_idx" ON "direct_messages" ("conversation_id");
CREATE INDEX IF NOT EXISTS "direct_messages_created_at_idx" ON "direct_messages" ("created_at");

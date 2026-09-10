-- E1 Knowledge Plane Migration
ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "source_kind" text DEFAULT 'url' NOT NULL;
ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "doc_id" text REFERENCES "workspace_docs"("id") ON DELETE CASCADE;

CREATE TABLE "client_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"source" text DEFAULT 'confirmed' NOT NULL,
	"added_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_identities" ADD CONSTRAINT "client_identities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_identities" ADD CONSTRAINT "client_identities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_identities" ADD CONSTRAINT "client_identities_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_identities_workspace_id_idx" ON "client_identities" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_identities_unique" ON "client_identities" USING btree ("workspace_id","client_id","kind","value");
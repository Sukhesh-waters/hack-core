CREATE TABLE "platina_alert_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"severity" "platina_alert_severity" DEFAULT 'warning' NOT NULL,
	"route" text DEFAULT 'in_app' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_alert_deliveries" ADD CONSTRAINT "platina_alert_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_alert_deliveries" ADD CONSTRAINT "platina_alert_deliveries_rule_id_platina_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."platina_alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_alert_deliveries_workspace_id_idx" ON "platina_alert_deliveries" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_alert_deliveries_rule_id_idx" ON "platina_alert_deliveries" USING btree ("rule_id");
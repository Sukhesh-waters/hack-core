ALTER TABLE "tickets" ADD COLUMN "parent_ticket_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parent_ticket_id_tickets_id_fk" FOREIGN KEY ("parent_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_parent_ticket_id_idx" ON "tickets" USING btree ("parent_ticket_id");
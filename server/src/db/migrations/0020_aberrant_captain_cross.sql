ALTER TABLE "memory" ADD COLUMN "learned_finding_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_learned_finding_uq" ON "memory" USING btree ("learned_finding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_ws_owner_uq" ON "eval_cases" USING btree ("workspace_id","owner_kind","owner_id");
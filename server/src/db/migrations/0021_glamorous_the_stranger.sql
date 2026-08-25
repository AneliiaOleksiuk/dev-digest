ALTER TABLE "memory" ADD COLUMN "learned_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "multi_agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_multi_agent_run_id_multi_agent_runs_id_fk" FOREIGN KEY ("multi_agent_run_id") REFERENCES "public"."multi_agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_learned_finding_uq" ON "memory" USING btree ("learned_finding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_ws_owner_uq" ON "eval_cases" USING btree ("workspace_id","owner_kind","owner_id") WHERE "eval_cases"."owner_kind" = 'finding';--> statement-breakpoint
CREATE INDEX "agent_runs_multi_agent_run_id_idx" ON "agent_runs" USING btree ("multi_agent_run_id");
CREATE TABLE "eval_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_version" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"skills_fingerprint" jsonb,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"cases_total" integer NOT NULL,
	"cases_passed" integer NOT NULL,
	"cases_failed" integer NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"recall_cases" integer NOT NULL,
	"precision_cases" integer NOT NULL,
	"citation_cases" integer NOT NULL,
	"findings_total" integer,
	"duration_ms" integer,
	"cost_usd" double precision,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_batches" ADD CONSTRAINT "eval_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_batches_workspace_owner_ran_at_idx" ON "eval_batches" USING btree ("workspace_id","owner_id","ran_at");--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_batch_id_eval_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."eval_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_workspace_owner_idx" ON "eval_cases" USING btree ("workspace_id","owner_id");
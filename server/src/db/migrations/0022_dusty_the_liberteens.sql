ALTER TABLE "ci_installations" ADD COLUMN "token_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "ingest_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "workflow_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "agent_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "post_as" text DEFAULT 'github_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "triggers" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "base_branch" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "manifest_path" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "namespace" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "ci_installation_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "repo" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "external_pr_number" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "actions_run_id" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "job_url" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "critical" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "warning" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "suggestion" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_ci_installation_id_ci_installations_id_fk" FOREIGN KEY ("ci_installation_id") REFERENCES "public"."ci_installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_installations_agent_repo_uq" ON "ci_installations" USING btree ("agent_id","repo");--> statement-breakpoint
CREATE INDEX "ci_installations_token_hash_idx" ON "ci_installations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_ci_installation_actions_run_uq" ON "agent_runs" USING btree ("ci_installation_id","actions_run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_source_ran_at_idx" ON "agent_runs" USING btree ("workspace_id","source","ran_at");
ALTER TABLE "eval_batches" ALTER COLUMN "skills_fingerprint" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "eval_batches" ALTER COLUMN "skills_fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "findings_total" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "error" text;
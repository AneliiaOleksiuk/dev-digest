-- Manually completed (drizzle-kit cannot auto-resolve an unnamed PK's
-- constraint name yet — see its own comment, kept below for provenance).
-- Confirmed the live constraint name via:
--   SELECT constraint_name FROM information_schema.table_constraints
--   WHERE table_schema = 'public' AND table_name = 'pr_brief'
--     AND constraint_type = 'PRIMARY KEY';
-- => pr_brief_pkey. Reordered so the new column exists before the composite
-- PK is added, and the old single-column PK is dropped before it.
ALTER TABLE "pr_brief" ADD COLUMN "head_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" DROP CONSTRAINT "pr_brief_pkey";--> statement-breakpoint
ALTER TABLE "pr_brief" ADD CONSTRAINT "pr_brief_pr_id_head_sha_pk" PRIMARY KEY("pr_id","head_sha");--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "dropped_risk_refs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "dropped_focus_items" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "dropped_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "generated_at" timestamp with time zone DEFAULT now() NOT NULL;
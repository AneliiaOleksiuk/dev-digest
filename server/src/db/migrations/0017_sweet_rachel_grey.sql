ALTER TABLE "onboarding" ADD COLUMN "status" text NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "call_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "index_sha" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "files_indexed" integer;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "index_status" text;
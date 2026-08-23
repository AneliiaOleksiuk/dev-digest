ALTER TABLE "ci_installations" ADD COLUMN "manifest_path" text NOT NULL;--> statement-breakpoint
CREATE INDEX "ci_installations_token_hash_idx" ON "ci_installations" USING btree ("token_hash");
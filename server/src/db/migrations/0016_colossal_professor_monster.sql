CREATE TABLE "project_context_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"surface_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_context_attachments" ADD CONSTRAINT "project_context_attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_context_attachments" ADD CONSTRAINT "project_context_attachments_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_context_attachments_surface_path_uq" ON "project_context_attachments" USING btree ("surface","surface_id","repo_id","path");--> statement-breakpoint
CREATE INDEX "project_context_attachments_repo_idx" ON "project_context_attachments" USING btree ("repo_id");
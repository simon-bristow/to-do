CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" text,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'local' NOT NULL,
	"external_id" text,
	"external_url" text,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"due_date" text,
	"due_time" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"completed_at" timestamp with time zone,
	"context" jsonb,
	"local_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"remote_updated_at" timestamp with time zone,
	"dirty_fields" text[] DEFAULT '{}' NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_source_external_id" ON "tasks" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "tasks_due_date" ON "tasks" USING btree ("due_date");
ALTER TABLE "business_profiles" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN "completed_at" timestamp with time zone;
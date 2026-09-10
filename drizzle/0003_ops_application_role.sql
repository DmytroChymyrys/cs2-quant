ALTER TABLE "app_users" ADD COLUMN "role" text DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_user_role" CHECK ("app_users"."role" in ('USER', 'ADMIN'));
CREATE TYPE "public"."run_status" AS ENUM('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_hash_name" text NOT NULL,
	"category" text,
	"weapon" text,
	"skin" text,
	"wear" text,
	"is_stat_trak" boolean,
	"is_souvenir" boolean,
	"rarity" text,
	"collection" text,
	"is_tracked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_market_hash_name_unique" UNIQUE("market_hash_name")
);
--> statement-breakpoint
CREATE TABLE "asset_source_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_item_id" text,
	"source_market_hash_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"source" text NOT NULL,
	"collector_run_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"suggested_price" numeric(20, 8),
	"min_price" numeric(20, 8),
	"max_price" numeric(20, 8),
	"mean_price" numeric(20, 8),
	"median_price" numeric(20, 8),
	"quantity" integer NOT NULL,
	"source_created_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"sales_24h_min" numeric(20, 8),
	"sales_24h_max" numeric(20, 8),
	"sales_24h_avg" numeric(20, 8),
	"sales_24h_median" numeric(20, 8),
	"sales_24h_volume" integer,
	"sales_7d_min" numeric(20, 8),
	"sales_7d_max" numeric(20, 8),
	"sales_7d_avg" numeric(20, 8),
	"sales_7d_median" numeric(20, 8),
	"sales_7d_volume" integer,
	"sales_30d_min" numeric(20, 8),
	"sales_30d_max" numeric(20, 8),
	"sales_30d_avg" numeric(20, 8),
	"sales_30d_median" numeric(20, 8),
	"sales_30d_volume" integer,
	"sales_90d_min" numeric(20, 8),
	"sales_90d_max" numeric(20, 8),
	"sales_90d_avg" numeric(20, 8),
	"sales_90d_median" numeric(20, 8),
	"sales_90d_volume" integer,
	"raw_item_payload" jsonb NOT NULL,
	"raw_history_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observations_usd" CHECK ("market_observations"."currency" = 'USD'),
	CONSTRAINT "observations_quantity" CHECK ("market_observations"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "collector_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"claim_key" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "run_status" DEFAULT 'RUNNING' NOT NULL,
	"items_http_status" integer,
	"history_http_status" integer,
	"items_received" integer DEFAULT 0 NOT NULL,
	"history_items_received" integer DEFAULT 0 NOT NULL,
	"tracked_assets" integer DEFAULT 0 NOT NULL,
	"items_matched" integer DEFAULT 0 NOT NULL,
	"items_missing" integer DEFAULT 0 NOT NULL,
	"observations_inserted" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error_code" text,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collector_runs_claim_key_unique" UNIQUE("claim_key")
);
--> statement-breakpoint
ALTER TABLE "asset_source_mappings" ADD CONSTRAINT "asset_source_mappings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_collector_run_id_collector_runs_id_fk" FOREIGN KEY ("collector_run_id") REFERENCES "public"."collector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_asset_source" ON "asset_source_mappings" USING btree ("asset_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_source_name" ON "asset_source_mappings" USING btree ("source","source_market_hash_name");--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_source_id" ON "asset_source_mappings" USING btree ("source","source_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_run_asset" ON "market_observations" USING btree ("collector_run_id","asset_id");--> statement-breakpoint
CREATE INDEX "observations_asset_source_time" ON "market_observations" USING btree ("asset_id","source","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "observations_source_time" ON "market_observations" USING btree ("source","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_source_started" ON "collector_runs" USING btree ("source","started_at" DESC NULLS LAST);
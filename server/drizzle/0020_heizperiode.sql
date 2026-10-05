CREATE TABLE `closed_heating_settlement_history` (
	`id` text PRIMARY KEY NOT NULL,
	`plant_id` text NOT NULL,
	`period` text NOT NULL,
	`closed_at` text NOT NULL,
	`sent_at` text,
	`reopened_at` text NOT NULL,
	`settlement` text NOT NULL,
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "closed_heating_settlement_history_period_valid" CHECK("period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "closed_heating_settlement_history_settlement_is_json" CHECK(json_valid("settlement"))
);
--> statement-breakpoint
CREATE INDEX `closed_heating_settlement_history_plant_period_idx` ON `closed_heating_settlement_history` (`plant_id`,`period`);--> statement-breakpoint
CREATE TABLE `closed_heating_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`plant_id` text NOT NULL,
	`period` text NOT NULL,
	`closed_at` text NOT NULL,
	`sent_at` text,
	`settlement` text NOT NULL,
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "closed_heating_settlements_period_valid" CHECK("period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "closed_heating_settlements_settlement_is_json" CHECK(json_valid("settlement"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `closed_heating_settlements_plant_period_idx` ON `closed_heating_settlements` (`plant_id`,`period`);--> statement-breakpoint
CREATE TABLE `heating_period_changes` (
	`plant_id` text NOT NULL,
	`from_month` text NOT NULL,
	PRIMARY KEY(`plant_id`, `from_month`),
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_period_changes_from_month_valid" CHECK("from_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("from_month", 6, 2) AS INTEGER) BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE `heating_prepayment_overrides` (
	`tenancy_id` text NOT NULL,
	`plant_id` text NOT NULL,
	`period` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`provisional` integer DEFAULT false NOT NULL,
	`from_month` text,
	`to_month` text,
	PRIMARY KEY(`tenancy_id`, `plant_id`, `period`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "heating_prepayment_overrides_period_valid" CHECK("period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_prepayment_overrides_from_valid" CHECK("from_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("from_month", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_prepayment_overrides_to_valid" CHECK("to_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("to_month", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_prepayment_overrides_amount_not_negative" CHECK("amount_cents" >= 0),
	CONSTRAINT "heating_prepayment_overrides_provisional_complete" CHECK(("provisional" = 1) = ("from_month" IS NOT NULL) AND ("from_month" IS NULL) = ("to_month" IS NULL)),
	CONSTRAINT "heating_prepayment_overrides_months_order_valid" CHECK("to_month" IS NULL OR "to_month" >= "from_month")
);
--> statement-breakpoint
CREATE TABLE `heating_prepayments` (
	`tenancy_id` text NOT NULL,
	`from` text NOT NULL,
	`monthly_cents` integer NOT NULL,
	PRIMARY KEY(`tenancy_id`, `from`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_prepayments_monthly_not_negative" CHECK("monthly_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `heating_separate_spans` (
	`plant_id` text NOT NULL,
	`from_month` text NOT NULL,
	`until_period` text,
	PRIMARY KEY(`plant_id`, `from_month`),
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_separate_spans_from_valid" CHECK("from_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("from_month", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_separate_spans_until_valid" CHECK("until_period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("until_period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_separate_spans_order_valid" CHECK("until_period" IS NULL OR "until_period" > "from_month")
);

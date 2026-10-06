CREATE TABLE `heating_self_spans` (
	`plant_id` text NOT NULL,
	`from_period` text NOT NULL,
	`until_period` text,
	PRIMARY KEY(`plant_id`, `from_period`),
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_self_spans_from_valid" CHECK("from_period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("from_period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_self_spans_until_valid" CHECK("until_period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("until_period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_self_spans_order_valid" CHECK("until_period" IS NULL OR "until_period" > "from_period")
);
--> statement-breakpoint
CREATE TABLE `interim_reading_gaps` (
	`unit_id` text NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`unit_id`, `date`),
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "interim_reading_gaps_status_known" CHECK("status" IN ('impossible', 'missed', 'imprecise', 'useReading')),
	CONSTRAINT "interim_reading_gaps_date_valid" CHECK("date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
ALTER TABLE `cost_items` ADD `heating_target` text;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `hot_water` text DEFAULT 'combined' NOT NULL;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `capture` text;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `area_basis_heat` text DEFAULT 'area' NOT NULL;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `heat_pump_installed_on` text;--> statement-breakpoint
ALTER TABLE `readings` ADD `interim_for` text;
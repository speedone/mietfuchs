CREATE TABLE `heating_service_values` (
	`heating_period_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`heat_value` real NOT NULL,
	`water_value` real,
	`heat_unit` text DEFAULT 'units' NOT NULL,
	PRIMARY KEY(`heating_period_id`, `unit_id`, `from`),
	FOREIGN KEY (`heating_period_id`) REFERENCES `heating_periods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_service_values_dates_valid" CHECK("from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND "to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND "from" <= "to"),
	CONSTRAINT "heating_service_values_heat_not_negative" CHECK("heat_value" >= 0),
	CONSTRAINT "heating_service_values_water_not_negative" CHECK("water_value" >= 0),
	CONSTRAINT "heating_service_values_heat_unit_known" CHECK("heat_unit" IN ('units', 'kWh'))
);
--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `hca_model` text;--> statement-breakpoint
ALTER TABLE `heating_self_spans` ADD `capture` text;--> statement-breakpoint
ALTER TABLE `heating_self_spans` ADD `hot_water` text;--> statement-breakpoint
ALTER TABLE `meters` ADD `hca_scale` text;--> statement-breakpoint
ALTER TABLE `meters` ADD `rating_factor` real;
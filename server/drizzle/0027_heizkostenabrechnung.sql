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
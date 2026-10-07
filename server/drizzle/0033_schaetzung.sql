CREATE TABLE `heating_estimates` (
	`heating_period_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`part` text NOT NULL,
	`value` real NOT NULL,
	`method` text NOT NULL,
	`reason` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`heating_period_id`, `unit_id`, `part`),
	FOREIGN KEY (`heating_period_id`) REFERENCES `heating_periods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_estimates_part_known" CHECK("part" IN ('heat', 'water')),
	CONSTRAINT "heating_estimates_method_known" CHECK("method" IN ('previousPeriod', 'comparableUnit', 'buildingAverage')),
	CONSTRAINT "heating_estimates_value_not_negative" CHECK("value" >= 0),
	CONSTRAINT "heating_estimates_reason_complete" CHECK(length(trim("reason")) > 0)
);

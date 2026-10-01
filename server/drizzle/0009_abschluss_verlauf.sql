CREATE TABLE `closed_settlement_history` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`year` integer NOT NULL,
	`closed_at` text NOT NULL,
	`sent_at` text,
	`reopened_at` text NOT NULL,
	`settlement` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "closed_settlement_history_settlement_is_json" CHECK(json_valid("settlement"))
);
--> statement-breakpoint
CREATE INDEX `closed_settlement_history_property_year_idx` ON `closed_settlement_history` (`property_id`,`year`);
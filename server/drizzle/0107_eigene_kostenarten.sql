CREATE TABLE `cost_types` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`period` text NOT NULL,
	`name` text NOT NULL,
	`base_category` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cost_types_name_valid" CHECK(length(trim("name")) BETWEEN 1 AND 80 AND "name" = trim("name"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_types_property_period_name_idx` ON `cost_types` (`property_id`,`period`,`name`);--> statement-breakpoint
ALTER TABLE `cost_items` ADD `cost_type_id` text REFERENCES cost_types(id);
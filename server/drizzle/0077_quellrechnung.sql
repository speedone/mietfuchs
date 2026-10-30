CREATE TABLE `cost_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`rule` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cost_sources_rule_known" CHECK("rule" IN ('days'))
);
--> statement-breakpoint
ALTER TABLE `cost_items` ADD `source_id` text REFERENCES cost_sources(id);--> statement-breakpoint
CREATE INDEX `cost_items_source_idx` ON `cost_items` (`source_id`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cost_item_meter_rest` (
	`cost_item_id` text PRIMARY KEY NOT NULL,
	`reference_meter_id` text,
	`key` text NOT NULL,
	`unit_ids_all` integer NOT NULL,
	`behind_all` integer NOT NULL,
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cost_item_meter_rest_key_known" CHECK("key" IN ('area', 'persons', 'units', 'meter', 'landlord', 'selfUse', 'standard')),
	CONSTRAINT "cost_item_meter_rest_behind_all_valid" CHECK("reference_meter_id" IS NULL OR "behind_all" = 0)
);
--> statement-breakpoint
INSERT INTO `__new_cost_item_meter_rest`("cost_item_id", "reference_meter_id", "key", "unit_ids_all", "behind_all") SELECT "cost_item_id", "reference_meter_id", "key", "unit_ids_all", "behind_all" FROM `cost_item_meter_rest`;--> statement-breakpoint
DROP TABLE `cost_item_meter_rest`;--> statement-breakpoint
ALTER TABLE `__new_cost_item_meter_rest` RENAME TO `cost_item_meter_rest`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
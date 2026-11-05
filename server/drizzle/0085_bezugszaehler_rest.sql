CREATE TABLE `cost_item_meter_rest` (
	`cost_item_id` text PRIMARY KEY NOT NULL,
	`reference_meter_id` text,
	`key` text NOT NULL,
	`unit_ids_all` integer NOT NULL,
	`behind_all` integer NOT NULL,
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cost_item_meter_rest_key_known" CHECK("key" IN ('area', 'persons', 'units', 'meter', 'landlord', 'selfUse')),
	CONSTRAINT "cost_item_meter_rest_behind_all_valid" CHECK("reference_meter_id" IS NULL OR "behind_all" = 0)
);
--> statement-breakpoint
CREATE TABLE `cost_item_meter_rest_behind` (
	`cost_item_id` text NOT NULL,
	`meter_id` text NOT NULL,
	PRIMARY KEY(`cost_item_id`, `meter_id`),
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `cost_item_meter_rest_subs` (
	`cost_item_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_key` text,
	`target_unit_ids` text,
	PRIMARY KEY(`cost_item_id`, `meter_id`),
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cost_item_meter_rest_subs_kind_known" CHECK("target_kind" IN ('landlord', 'selfUse', 'excluded', 'group')),
	CONSTRAINT "cost_item_meter_rest_subs_key_known" CHECK("target_key" IN ('area', 'persons', 'units', 'direct')),
	CONSTRAINT "cost_item_meter_rest_subs_group_valid" CHECK(("target_kind" = 'group') = ("target_key" IS NOT NULL AND "target_unit_ids" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `cost_item_meter_rest_units` (
	`cost_item_id` text NOT NULL,
	`unit_id` text NOT NULL,
	PRIMARY KEY(`cost_item_id`, `unit_id`),
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `meters` ADD `scope` text;
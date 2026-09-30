PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_closed_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`year` integer NOT NULL,
	`closed_at` text NOT NULL,
	`sent_at` text,
	`settlement` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "closed_settlements_settlement_is_json" CHECK(json_valid("__new_closed_settlements"."settlement"))
);
--> statement-breakpoint
INSERT INTO `__new_closed_settlements`("id", "property_id", "year", "closed_at", "sent_at", "settlement") SELECT "id", "property_id", "year", "closed_at", "sent_at", "settlement" FROM `closed_settlements`;--> statement-breakpoint
DROP TABLE `closed_settlements`;--> statement-breakpoint
ALTER TABLE `__new_closed_settlements` RENAME TO `closed_settlements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `closed_settlements_property_year_idx` ON `closed_settlements` (`property_id`,`year`);--> statement-breakpoint
CREATE TABLE `__new_cost_items` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`year` integer NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`vendor` text,
	`amount_cents` integer NOT NULL,
	`key` text NOT NULL,
	`direct_unit_id` text,
	`meter_type` text,
	`labor_35a_cents` integer,
	`invoice_file` text,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`direct_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "cost_items_key_known" CHECK("key" IN ('area', 'persons', 'units', 'direct', 'meter', 'custom')),
	CONSTRAINT "cost_items_meter_type_known" CHECK("meter_type" IN ('kaltwasser', 'strom', 'waerme', 'sonstig'))
);
--> statement-breakpoint
INSERT INTO `__new_cost_items`("id", "property_id", "year", "category", "description", "vendor", "amount_cents", "key", "direct_unit_id", "meter_type", "labor_35a_cents", "invoice_file") SELECT "id", "property_id", "year", "category", "description", "vendor", "amount_cents", "key", "direct_unit_id", "meter_type", "labor_35a_cents", "invoice_file" FROM `cost_items`;--> statement-breakpoint
DROP TABLE `cost_items`;--> statement-breakpoint
ALTER TABLE `__new_cost_items` RENAME TO `cost_items`;--> statement-breakpoint
CREATE INDEX `cost_items_property_year_idx` ON `cost_items` (`property_id`,`year`);--> statement-breakpoint
CREATE TABLE `__new_meters` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`unit_id` text,
	`type` text NOT NULL,
	`meter_number` text,
	`unit` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meters_type_known" CHECK("type" IN ('kaltwasser', 'strom', 'waerme', 'sonstig'))
);
--> statement-breakpoint
INSERT INTO `__new_meters`("id", "property_id", "name", "unit_id", "type", "meter_number", "unit") SELECT "id", "property_id", "name", "unit_id", "type", "meter_number", "unit" FROM `meters`;--> statement-breakpoint
DROP TABLE `meters`;--> statement-breakpoint
ALTER TABLE `__new_meters` RENAME TO `meters`;--> statement-breakpoint
CREATE TABLE `__new_units` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`area_m2` real NOT NULL,
	`participates` integer NOT NULL,
	`self_used` integer,
	`self_persons` integer,
	`rooms` integer,
	`floor` text,
	`notes` text,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "units_area_not_negative" CHECK("area_m2" >= 0),
	CONSTRAINT "units_self_persons_not_negative" CHECK("self_persons" >= 0),
	CONSTRAINT "units_rooms_not_negative" CHECK("rooms" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_units`("id", "property_id", "name", "area_m2", "participates", "self_used", "self_persons", "rooms", "floor", "notes") SELECT "id", "property_id", "name", "area_m2", "participates", "self_used", "self_persons", "rooms", "floor", "notes" FROM `units`;--> statement-breakpoint
DROP TABLE `units`;--> statement-breakpoint
ALTER TABLE `__new_units` RENAME TO `units`;
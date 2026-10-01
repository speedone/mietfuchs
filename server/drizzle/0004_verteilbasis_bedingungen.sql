PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`external_measure` text,
	`external_total` real,
	`external_total_cents` integer,
	`participants_limited` integer,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`direct_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "cost_items_key_known" CHECK("key" IN ('area', 'persons', 'units', 'direct', 'meter', 'custom', 'external', 'amounts')),
	CONSTRAINT "cost_items_meter_type_known" CHECK("meter_type" IN ('kaltwasser', 'strom', 'waerme', 'sonstig')),
	CONSTRAINT "cost_items_external_measure_known" CHECK("external_measure" IN ('mea', 'area', 'units')),
	CONSTRAINT "cost_items_external_total_positive" CHECK("external_total" > 0),
	CONSTRAINT "cost_items_external_complete" CHECK(("external_measure" IS NULL) = ("external_total" IS NULL) AND ("external_measure" IS NULL) = ("external_total_cents" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_cost_items`("id", "property_id", "year", "category", "description", "vendor", "amount_cents", "key", "direct_unit_id", "meter_type", "labor_35a_cents", "invoice_file", "external_measure", "external_total", "external_total_cents", "participants_limited") SELECT "id", "property_id", "year", "category", "description", "vendor", "amount_cents", "key", "direct_unit_id", "meter_type", "labor_35a_cents", "invoice_file", "external_measure", "external_total", "external_total_cents", "participants_limited" FROM `cost_items`;--> statement-breakpoint
DROP TABLE `cost_items`;--> statement-breakpoint
ALTER TABLE `__new_cost_items` RENAME TO `cost_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cost_items_property_year_idx` ON `cost_items` (`property_id`,`year`);--> statement-breakpoint
CREATE TABLE `__new_units` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`area_m2` real NOT NULL,
	`participates` integer NOT NULL,
	`self_used` integer,
	`self_persons` integer,
	`mea` real,
	`rooms` integer,
	`floor` text,
	`notes` text,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "units_area_not_negative" CHECK("area_m2" >= 0),
	CONSTRAINT "units_self_persons_not_negative" CHECK("self_persons" >= 0),
	CONSTRAINT "units_rooms_not_negative" CHECK("rooms" >= 0),
	CONSTRAINT "units_mea_not_negative" CHECK("mea" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_units`("id", "property_id", "name", "area_m2", "participates", "self_used", "self_persons", "mea", "rooms", "floor", "notes") SELECT "id", "property_id", "name", "area_m2", "participates", "self_used", "self_persons", "mea", "rooms", "floor", "notes" FROM `units`;--> statement-breakpoint
DROP TABLE `units`;--> statement-breakpoint
ALTER TABLE `__new_units` RENAME TO `units`;
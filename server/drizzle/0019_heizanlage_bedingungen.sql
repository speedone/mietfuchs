PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cost_items` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`period` text NOT NULL,
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
	`service_from` text,
	`service_to` text,
	`tax_year` integer,
	`heating_part` text,
	`heating_plant_id` text,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`direct_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`heating_plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cost_items_period_valid" CHECK("period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "cost_items_key_known" CHECK("key" IN ('area', 'persons', 'units', 'direct', 'meter', 'custom', 'external', 'amounts')),
	CONSTRAINT "cost_items_meter_type_known" CHECK("meter_type" IN ('kaltwasser', 'warmwasser', 'strom', 'waerme', 'hkv', 'sonstig')),
	CONSTRAINT "cost_items_external_measure_known" CHECK("external_measure" IN ('mea', 'area', 'units')),
	CONSTRAINT "cost_items_service_complete" CHECK(("service_from" IS NULL) = ("service_to" IS NULL)),
	CONSTRAINT "cost_items_service_from_valid" CHECK("service_from" IS NULL OR "service_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "cost_items_service_to_valid" CHECK("service_to" IS NULL OR "service_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "cost_items_service_order_valid" CHECK("service_from" IS NULL OR "service_from" <= "service_to"),
	CONSTRAINT "cost_items_tax_year_valid" CHECK("tax_year" IS NULL OR "tax_year" BETWEEN 1900 AND 2200),
	CONSTRAINT "cost_items_heating_part_known" CHECK("heating_part" IN ('fuel', 'operating', 'metering')),
	CONSTRAINT "cost_items_heating_part_category_valid" CHECK("heating_part" IS NULL OR "category" = 'Heizung und Warmwasser'),
	CONSTRAINT "cost_items_external_total_positive" CHECK("external_total" > 0),
	CONSTRAINT "cost_items_external_complete" CHECK(("external_measure" IS NULL) = ("external_total" IS NULL) AND ("external_measure" IS NULL) = ("external_total_cents" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_cost_items`("id", "property_id", "period", "category", "description", "vendor", "amount_cents", "key", "direct_unit_id", "meter_type", "labor_35a_cents", "invoice_file", "external_measure", "external_total", "external_total_cents", "participants_limited", "service_from", "service_to", "tax_year", "heating_part", "heating_plant_id") SELECT "id", "property_id", "period", "category", "description", "vendor", "amount_cents", "key", "direct_unit_id", "meter_type", "labor_35a_cents", "invoice_file", "external_measure", "external_total", "external_total_cents", "participants_limited", "service_from", "service_to", "tax_year", "heating_part", "heating_plant_id" FROM `cost_items`;--> statement-breakpoint
DROP TABLE `cost_items`;--> statement-breakpoint
ALTER TABLE `__new_cost_items` RENAME TO `cost_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cost_items_property_period_idx` ON `cost_items` (`property_id`,`period`);--> statement-breakpoint
CREATE TABLE `__new_meters` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`unit_id` text,
	`type` text NOT NULL,
	`meter_number` text,
	`unit` text NOT NULL,
	`heating_plant_id` text,
	`heating_role` text,
	`remote_readable` integer,
	`installed_on` text,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`heating_plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "meters_type_known" CHECK("type" IN ('kaltwasser', 'warmwasser', 'strom', 'waerme', 'hkv', 'sonstig')),
	CONSTRAINT "meters_heating_role_known" CHECK("heating_role" IN ('supply', 'dhwHeat', 'totalHeat')),
	CONSTRAINT "meters_heating_role_plant_valid" CHECK(("heating_plant_id" IS NULL) = ("heating_role" IS NULL)),
	CONSTRAINT "meters_heating_plant_unit_valid" CHECK("heating_plant_id" IS NULL OR "unit_id" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_meters`("id", "property_id", "name", "unit_id", "type", "meter_number", "unit", "heating_plant_id", "heating_role", "remote_readable", "installed_on") SELECT "id", "property_id", "name", "unit_id", "type", "meter_number", "unit", "heating_plant_id", "heating_role", "remote_readable", "installed_on" FROM `meters`;--> statement-breakpoint
DROP TABLE `meters`;--> statement-breakpoint
ALTER TABLE `__new_meters` RENAME TO `meters`;--> statement-breakpoint
CREATE TABLE `__new_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`address` text NOT NULL,
	`landlord_name` text,
	`iban` text,
	`payment_deadline_days` integer,
	`cable_built_before_dec_2021` integer,
	`period_start_month` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "properties_kind_known" CHECK("kind" IN ('mfh', 'etw', 'efh', 'zfh', 'sonstiges')),
	CONSTRAINT "properties_deadline_not_negative" CHECK("payment_deadline_days" >= 0),
	CONSTRAINT "properties_period_start_month_valid" CHECK("period_start_month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
INSERT INTO `__new_properties`("id", "name", "kind", "address", "landlord_name", "iban", "payment_deadline_days", "cable_built_before_dec_2021", "period_start_month") SELECT "id", "name", "kind", "address", "landlord_name", "iban", "payment_deadline_days", "cable_built_before_dec_2021", "period_start_month" FROM `properties`;--> statement-breakpoint
DROP TABLE `properties`;--> statement-breakpoint
ALTER TABLE `__new_properties` RENAME TO `properties`;--> statement-breakpoint
CREATE TABLE `__new_unit_no_connection` (
	`unit_id` text NOT NULL,
	`meter_type` text NOT NULL,
	PRIMARY KEY(`unit_id`, `meter_type`),
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "unit_no_connection_meter_type_known" CHECK("meter_type" IN ('kaltwasser', 'warmwasser', 'strom', 'waerme', 'hkv', 'sonstig'))
);
--> statement-breakpoint
INSERT INTO `__new_unit_no_connection`("unit_id", "meter_type") SELECT "unit_id", "meter_type" FROM `unit_no_connection`;--> statement-breakpoint
DROP TABLE `unit_no_connection`;--> statement-breakpoint
ALTER TABLE `__new_unit_no_connection` RENAME TO `unit_no_connection`;
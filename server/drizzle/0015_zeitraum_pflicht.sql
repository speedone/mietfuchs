PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`file` text NOT NULL,
	`property_id` text,
	`year` integer NOT NULL,
	`detected_year` integer,
	`requested_period` text,
	`vendor` text,
	`invoice_date` text,
	`total_gross_cents` integer,
	`amounts_adjusted` text,
	`labor_from_total` integer DEFAULT false NOT NULL,
	`next_idx` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assessments_year_positive" CHECK("year" > 0),
	CONSTRAINT "assessments_requested_period_with_property" CHECK("requested_period" IS NULL OR "property_id" IS NOT NULL),
	CONSTRAINT "assessments_requested_period_valid" CHECK("requested_period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("requested_period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "assessments_next_idx_not_negative" CHECK("next_idx" >= 0),
	CONSTRAINT "assessments_amounts_adjusted_known" CHECK("amounts_adjusted" IN ('netto'))
);
--> statement-breakpoint
INSERT INTO `__new_assessments`("id", "file", "property_id", "year", "detected_year", "requested_period", "vendor", "invoice_date", "total_gross_cents", "amounts_adjusted", "labor_from_total", "next_idx", "created_at") SELECT "id", "file", "property_id", "year", "detected_year", "requested_period", "vendor", "invoice_date", "total_gross_cents", "amounts_adjusted", "labor_from_total", "next_idx", "created_at" FROM `assessments`;--> statement-breakpoint
DROP TABLE `assessments`;--> statement-breakpoint
ALTER TABLE `__new_assessments` RENAME TO `assessments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `assessments_file_unique` ON `assessments` (`file`);--> statement-breakpoint
CREATE INDEX `assessments_property_idx` ON `assessments` (`property_id`);--> statement-breakpoint
CREATE TABLE `__new_closed_settlement_history` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`period` text NOT NULL,
	`closed_at` text NOT NULL,
	`sent_at` text,
	`reopened_at` text NOT NULL,
	`settlement` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "closed_settlement_history_period_valid" CHECK("period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "closed_settlement_history_settlement_is_json" CHECK(json_valid("settlement"))
);
--> statement-breakpoint
INSERT INTO `__new_closed_settlement_history`("id", "property_id", "period", "closed_at", "sent_at", "reopened_at", "settlement") SELECT "id", "property_id", "period", "closed_at", "sent_at", "reopened_at", "settlement" FROM `closed_settlement_history`;--> statement-breakpoint
DROP TABLE `closed_settlement_history`;--> statement-breakpoint
ALTER TABLE `__new_closed_settlement_history` RENAME TO `closed_settlement_history`;--> statement-breakpoint
CREATE INDEX `closed_settlement_history_property_period_idx` ON `closed_settlement_history` (`property_id`,`period`);--> statement-breakpoint
CREATE TABLE `__new_closed_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`period` text NOT NULL,
	`closed_at` text NOT NULL,
	`sent_at` text,
	`settlement` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "closed_settlements_period_valid" CHECK("period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "closed_settlements_settlement_is_json" CHECK(json_valid("settlement"))
);
--> statement-breakpoint
INSERT INTO `__new_closed_settlements`("id", "property_id", "period", "closed_at", "sent_at", "settlement") SELECT "id", "property_id", "period", "closed_at", "sent_at", "settlement" FROM `closed_settlements`;--> statement-breakpoint
DROP TABLE `closed_settlements`;--> statement-breakpoint
ALTER TABLE `__new_closed_settlements` RENAME TO `closed_settlements`;--> statement-breakpoint
CREATE UNIQUE INDEX `closed_settlements_property_period_idx` ON `closed_settlements` (`property_id`,`period`);--> statement-breakpoint
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
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`direct_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "cost_items_period_valid" CHECK("period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "cost_items_key_known" CHECK("key" IN ('area', 'persons', 'units', 'direct', 'meter', 'custom', 'external', 'amounts')),
	CONSTRAINT "cost_items_meter_type_known" CHECK("meter_type" IN ('kaltwasser', 'strom', 'waerme', 'sonstig')),
	CONSTRAINT "cost_items_external_measure_known" CHECK("external_measure" IN ('mea', 'area', 'units')),
	CONSTRAINT "cost_items_external_total_positive" CHECK("external_total" > 0),
	CONSTRAINT "cost_items_external_complete" CHECK(("external_measure" IS NULL) = ("external_total" IS NULL) AND ("external_measure" IS NULL) = ("external_total_cents" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_cost_items`("id", "property_id", "period", "category", "description", "vendor", "amount_cents", "key", "direct_unit_id", "meter_type", "labor_35a_cents", "invoice_file", "external_measure", "external_total", "external_total_cents", "participants_limited") SELECT "id", "property_id", "period", "category", "description", "vendor", "amount_cents", "key", "direct_unit_id", "meter_type", "labor_35a_cents", "invoice_file", "external_measure", "external_total", "external_total_cents", "participants_limited" FROM `cost_items`;--> statement-breakpoint
DROP TABLE `cost_items`;--> statement-breakpoint
ALTER TABLE `__new_cost_items` RENAME TO `cost_items`;--> statement-breakpoint
CREATE INDEX `cost_items_property_period_idx` ON `cost_items` (`property_id`,`period`);--> statement-breakpoint
CREATE TABLE `__new_prepayment_overrides` (
	`tenancy_id` text NOT NULL,
	`period` text NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`tenancy_id`, `period`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prepayment_overrides_period_valid" CHECK("period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "prepayment_overrides_amount_not_negative" CHECK("amount_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_prepayment_overrides`("tenancy_id", "period", "amount_cents") SELECT "tenancy_id", "period", "amount_cents" FROM `prepayment_overrides`;--> statement-breakpoint
DROP TABLE `prepayment_overrides`;--> statement-breakpoint
ALTER TABLE `__new_prepayment_overrides` RENAME TO `prepayment_overrides`;--> statement-breakpoint
CREATE TABLE `__new_period_changes` (
	`property_id` text NOT NULL,
	`from_month` text NOT NULL,
	PRIMARY KEY(`property_id`, `from_month`),
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "period_changes_from_month_valid" CHECK("from_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("from_month", 6, 2) AS INTEGER) BETWEEN 1 AND 12)
);
--> statement-breakpoint
INSERT INTO `__new_period_changes`("property_id", "from_month") SELECT "property_id", "from_month" FROM `period_changes`;--> statement-breakpoint
DROP TABLE `period_changes`;--> statement-breakpoint
ALTER TABLE `__new_period_changes` RENAME TO `period_changes`;--> statement-breakpoint
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
	CONSTRAINT "properties_kind_known" CHECK("kind" IN ('mfh', 'etw', 'efh', 'sonstiges')),
	CONSTRAINT "properties_deadline_not_negative" CHECK("payment_deadline_days" >= 0),
	CONSTRAINT "properties_period_start_month_valid" CHECK("period_start_month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
INSERT INTO `__new_properties`("id", "name", "kind", "address", "landlord_name", "iban", "payment_deadline_days", "cable_built_before_dec_2021", "period_start_month") SELECT "id", "name", "kind", "address", "landlord_name", "iban", "payment_deadline_days", "cable_built_before_dec_2021", "period_start_month" FROM `properties`;--> statement-breakpoint
DROP TABLE `properties`;--> statement-breakpoint
ALTER TABLE `__new_properties` RENAME TO `properties`;
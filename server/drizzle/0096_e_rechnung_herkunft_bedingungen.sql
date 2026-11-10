PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`file` text NOT NULL,
	`property_id` text,
	`year` integer NOT NULL,
	`detected_year` integer,
	`requested_year` integer,
	`requested_period` text,
	`vendor` text,
	`invoice_date` text,
	`total_gross_cents` integer,
	`amounts_adjusted` text,
	`labor_from_total` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'ki' NOT NULL,
	`invoice_number` text,
	`e_invoice_notes` text DEFAULT '[]' NOT NULL,
	`next_idx` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assessments_year_positive" CHECK("year" > 0),
	CONSTRAINT "assessments_requested_year_positive" CHECK("requested_year" IS NULL OR "requested_year" > 0),
	CONSTRAINT "assessments_requested_period_with_property" CHECK("requested_period" IS NULL OR "property_id" IS NOT NULL),
	CONSTRAINT "assessments_requested_period_valid" CHECK("requested_period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("requested_period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "assessments_next_idx_not_negative" CHECK("next_idx" >= 0),
	CONSTRAINT "assessments_amounts_adjusted_known" CHECK("amounts_adjusted" IN ('netto')),
	CONSTRAINT "assessments_source_known" CHECK("source" IN ('ki', 'e-rechnung'))
);
--> statement-breakpoint
INSERT INTO `__new_assessments`("id", "file", "property_id", "year", "detected_year", "requested_year", "requested_period", "vendor", "invoice_date", "total_gross_cents", "amounts_adjusted", "labor_from_total", "source", "invoice_number", "e_invoice_notes", "next_idx", "created_at") SELECT "id", "file", "property_id", "year", "detected_year", "requested_year", "requested_period", "vendor", "invoice_date", "total_gross_cents", "amounts_adjusted", "labor_from_total", "source", "invoice_number", "e_invoice_notes", "next_idx", "created_at" FROM `assessments`;--> statement-breakpoint
DROP TABLE `assessments`;--> statement-breakpoint
ALTER TABLE `__new_assessments` RENAME TO `assessments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `assessments_file_unique` ON `assessments` (`file`);--> statement-breakpoint
CREATE INDEX `assessments_property_idx` ON `assessments` (`property_id`);
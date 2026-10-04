CREATE TABLE `assessment_lines` (
	`assessment_id` text NOT NULL,
	`idx` integer NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`category_guessed` integer DEFAULT false NOT NULL,
	`amount_cents` integer,
	`labor_35a_cents` integer,
	`booking` text,
	`cost_item_id` text,
	`dismissed` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`assessment_id`, `idx`),
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assessment_lines_idx_not_negative" CHECK("idx" >= 0),
	CONSTRAINT "assessment_lines_booking_known" CHECK("booking" IN ('created', 'linked')),
	CONSTRAINT "assessment_lines_booking_complete" CHECK("cost_item_id" IS NULL OR "booking" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `assessment_lines_cost_item_idx` ON `assessment_lines` (`cost_item_id`);--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`file` text NOT NULL,
	`property_id` text,
	`year` integer NOT NULL,
	`detected_year` integer,
	`requested_year` integer,
	`vendor` text,
	`invoice_date` text,
	`total_gross_cents` integer,
	`amounts_adjusted` text,
	`labor_from_total` integer DEFAULT false NOT NULL,
	`next_idx` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assessments_year_positive" CHECK("year" > 0),
	CONSTRAINT "assessments_requested_year_positive" CHECK("requested_year" IS NULL OR "requested_year" > 0),
	CONSTRAINT "assessments_next_idx_not_negative" CHECK("next_idx" >= 0),
	CONSTRAINT "assessments_amounts_adjusted_known" CHECK("amounts_adjusted" IN ('netto'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessments_file_unique` ON `assessments` (`file`);--> statement-breakpoint
CREATE INDEX `assessments_property_idx` ON `assessments` (`property_id`);
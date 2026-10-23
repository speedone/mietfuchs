CREATE TABLE `tenancy_direct_charges` (
	`tenancy_id` text NOT NULL,
	`from` text NOT NULL,
	`monthly_cents` integer NOT NULL,
	PRIMARY KEY(`tenancy_id`, `from`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenancy_direct_charges_from_valid" CHECK("from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("from", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "tenancy_direct_charges_monthly_not_negative" CHECK("monthly_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `unit_local_rents` (
	`unit_id` text NOT NULL,
	`from` text NOT NULL,
	`monthly_cents` integer NOT NULL,
	`source` text NOT NULL,
	`source_date` text NOT NULL,
	PRIMARY KEY(`unit_id`, `from`),
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "unit_local_rents_from_valid" CHECK("from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("from", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "unit_local_rents_monthly_positive" CHECK("monthly_cents" > 0),
	CONSTRAINT "unit_local_rents_source_valid" CHECK(length(trim("source")) > 0),
	CONSTRAINT "unit_local_rents_source_date_valid" CHECK("source_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

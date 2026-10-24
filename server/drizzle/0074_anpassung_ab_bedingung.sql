PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tenancy_letter_adjustments` (
	`tenancy_id` text NOT NULL,
	`doc` text NOT NULL,
	`mode` text NOT NULL,
	`cents` integer,
	`from_month` text,
	PRIMARY KEY(`tenancy_id`, `doc`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenancy_letter_adjustments_mode_known" CHECK("mode" IN ('none', 'suggestion', 'custom')),
	CONSTRAINT "tenancy_letter_adjustments_doc_complete" CHECK(length("doc") > 0),
	CONSTRAINT "tenancy_letter_adjustments_from_valid" CHECK("from_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("from_month", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "tenancy_letter_adjustments_cents_valid" CHECK(("mode" = 'custom' AND "cents" IS NOT NULL AND typeof("cents") = 'integer' AND "cents" >= 0) OR ("mode" <> 'custom' AND "cents" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_tenancy_letter_adjustments`("tenancy_id", "doc", "mode", "cents", "from_month") SELECT "tenancy_id", "doc", "mode", "cents", "from_month" FROM `tenancy_letter_adjustments`;--> statement-breakpoint
DROP TABLE `tenancy_letter_adjustments`;--> statement-breakpoint
ALTER TABLE `__new_tenancy_letter_adjustments` RENAME TO `tenancy_letter_adjustments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
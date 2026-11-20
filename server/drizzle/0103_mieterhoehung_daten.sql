CREATE TABLE `rent_increases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenancy_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_on` text NOT NULL,
	`received_on` text,
	`effective_from` text NOT NULL,
	`from_cents` integer NOT NULL,
	`to_cents` integer NOT NULL,
	`basis` text NOT NULL,
	`status` text NOT NULL,
	`agreed_cents` integer,
	`decided_on` text,
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rent_increases_kind_known" CHECK("kind" IN ('comparison', 'index')),
	CONSTRAINT "rent_increases_status_known" CHECK("status" IN ('draft', 'sent', 'agreed', 'partial', 'refused', 'withdrawn')),
	CONSTRAINT "rent_increases_created_on_valid" CHECK("created_on" IS NULL OR "created_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "rent_increases_received_on_valid" CHECK("received_on" IS NULL OR "received_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "rent_increases_decided_on_valid" CHECK("decided_on" IS NULL OR "decided_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "rent_increases_effective_from_valid" CHECK("effective_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("effective_from", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "rent_increases_from_not_negative" CHECK("from_cents" >= 0),
	CONSTRAINT "rent_increases_to_not_negative" CHECK("to_cents" >= 0),
	CONSTRAINT "rent_increases_agreed_valid" CHECK(("status" IS 'partial') = ("agreed_cents" IS NOT NULL) AND ("agreed_cents" IS NULL OR "agreed_cents" >= 0)),
	CONSTRAINT "rent_increases_basis_is_json" CHECK(json_valid("basis") AND json_type("basis") = 'object')
);
--> statement-breakpoint
CREATE INDEX `rent_increases_tenancy_idx` ON `rent_increases` (`tenancy_id`);--> statement-breakpoint
ALTER TABLE `base_rents` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `base_rents` ADD `index_month` text;--> statement-breakpoint
ALTER TABLE `base_rents` ADD `index_tenths` integer;--> statement-breakpoint
ALTER TABLE `base_rents` ADD `index_base` integer;--> statement-breakpoint
ALTER TABLE `properties` ADD `rent_cap_reduced` integer;--> statement-breakpoint
ALTER TABLE `tenancies` ADD `rent_kind` text;--> statement-breakpoint
ALTER TABLE `tenancies` ADD `rent_increase_excluded` integer;
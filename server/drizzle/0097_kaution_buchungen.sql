CREATE TABLE `deposit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenancy_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`purpose` text,
	`payment_id` text,
	`note` text,
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deposit_entries_amount_positive" CHECK("amount_cents" > 0),
	CONSTRAINT "deposit_entries_kind_known" CHECK("kind" IN ('received', 'interest', 'applied', 'refunded')),
	CONSTRAINT "deposit_entries_purpose_known" CHECK("purpose" IN ('rent', 'settlement', 'damage', 'other')),
	CONSTRAINT "deposit_entries_purpose_valid" CHECK(("kind" = 'applied') = ("purpose" IS NOT NULL)),
	CONSTRAINT "deposit_entries_payment_valid" CHECK("payment_id" IS NULL OR "purpose" IN ('rent', 'settlement')),
	CONSTRAINT "deposit_entries_date_valid" CHECK("date" IS NULL OR "date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
ALTER TABLE `tenancies` ADD `deposit_form` text;
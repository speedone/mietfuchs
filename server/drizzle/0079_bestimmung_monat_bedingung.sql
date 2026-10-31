PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenancy_id` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text,
	`kind` text DEFAULT 'rent' NOT NULL,
	`designated_month` text,
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payments_kind_known" CHECK("kind" IN ('rent', 'settlement')),
	CONSTRAINT "payments_designated_month_valid" CHECK("designated_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("designated_month", 6, 2) AS INTEGER) BETWEEN 1 AND 12)
);
--> statement-breakpoint
INSERT INTO `__new_payments`("id", "tenancy_id", "date", "amount_cents", "note", "kind", "designated_month") SELECT "id", "tenancy_id", "date", "amount_cents", "note", "kind", "designated_month" FROM `payments`;--> statement-breakpoint
DROP TABLE `payments`;--> statement-breakpoint
ALTER TABLE `__new_payments` RENAME TO `payments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
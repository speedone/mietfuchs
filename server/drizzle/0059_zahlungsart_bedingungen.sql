PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenancy_id` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text,
	`kind` text DEFAULT 'rent' NOT NULL,
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payments_kind_known" CHECK("kind" IN ('rent', 'settlement'))
);
--> statement-breakpoint
INSERT INTO `__new_payments`("id", "tenancy_id", "date", "amount_cents", "note", "kind") SELECT "id", "tenancy_id", "date", "amount_cents", "note", "kind" FROM `payments`;--> statement-breakpoint
DROP TABLE `payments`;--> statement-breakpoint
ALTER TABLE `__new_payments` RENAME TO `payments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
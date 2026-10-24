PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_change_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`method` text NOT NULL,
	`route` text NOT NULL,
	`description` text NOT NULL,
	`subject_table` text,
	`schema_steps` integer NOT NULL,
	`request_id` text,
	`reverted_by` integer,
	`barrier` text,
	FOREIGN KEY (`reverted_by`) REFERENCES `change_groups`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "change_groups_barrier_known" CHECK("barrier" IN ('restore', 'priorVersion', 'changeover'))
);
--> statement-breakpoint
INSERT INTO `__new_change_groups`("id", "at", "method", "route", "description", "subject_table", "schema_steps", "request_id", "reverted_by", "barrier") SELECT "id", "at", "method", "route", "description", "subject_table", "schema_steps", "request_id", "reverted_by", "barrier" FROM `change_groups`;--> statement-breakpoint
DROP TABLE `change_groups`;--> statement-breakpoint
ALTER TABLE `__new_change_groups` RENAME TO `change_groups`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `change_groups_at_idx` ON `change_groups` (`at`);--> statement-breakpoint
CREATE INDEX `change_groups_request_idx` ON `change_groups` (`request_id`);--> statement-breakpoint
CREATE INDEX `change_groups_reverted_idx` ON `change_groups` (`reverted_by`);
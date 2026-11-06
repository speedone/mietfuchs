PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`meter_id` text NOT NULL,
	`date` text NOT NULL,
	`value` real NOT NULL,
	`replacement` integer,
	`old_end_value` real,
	`note` text,
	`interim_for` text,
	`estimated` integer,
	`estimate_reason` text,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "readings_value_not_negative" CHECK("value" >= 0),
	CONSTRAINT "readings_old_end_value_not_negative" CHECK("old_end_value" >= 0),
	CONSTRAINT "readings_estimated_valid" CHECK("estimated" IS NULL OR "estimated" = 1),
	CONSTRAINT "readings_estimate_reason_valid" CHECK(("estimated" IS NULL AND "estimate_reason" IS NULL) OR ("estimated" = 1 AND trim("estimate_reason") <> ''))
);
--> statement-breakpoint
INSERT INTO `__new_readings`("id", "meter_id", "date", "value", "replacement", "old_end_value", "note", "interim_for", "estimated", "estimate_reason") SELECT "id", "meter_id", "date", "value", "replacement", "old_end_value", "note", "interim_for", "estimated", "estimate_reason" FROM `readings`;--> statement-breakpoint
DROP TABLE `readings`;--> statement-breakpoint
ALTER TABLE `__new_readings` RENAME TO `readings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
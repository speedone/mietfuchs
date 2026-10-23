CREATE TABLE `change_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`method` text NOT NULL,
	`route` text NOT NULL,
	`description` text NOT NULL,
	`subject_table` text,
	`property_id` text,
	`schema_steps` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_groups_property_idx` ON `change_groups` (`property_id`,`id`);--> statement-breakpoint
CREATE INDEX `change_groups_at_idx` ON `change_groups` (`at`);--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`table_name` text NOT NULL,
	`row_key` text NOT NULL,
	`op` text NOT NULL,
	`before` text,
	`after` text,
	FOREIGN KEY (`group_id`) REFERENCES `change_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "change_log_op_known" CHECK("op" IN ('insert', 'update', 'delete'))
);
--> statement-breakpoint
CREATE INDEX `change_log_group_idx` ON `change_log` (`group_id`);
CREATE TABLE `unit_usage_changes` (
	`unit_id` text NOT NULL,
	`from` text NOT NULL,
	`usage` text NOT NULL,
	PRIMARY KEY(`unit_id`, `from`),
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "unit_usage_changes_usage_known" CHECK("usage" IN ('vermietet', 'eigen', 'ausgenommen')),
	CONSTRAINT "unit_usage_changes_from_valid" CHECK("from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

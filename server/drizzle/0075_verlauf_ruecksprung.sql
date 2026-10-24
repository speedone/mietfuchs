ALTER TABLE `change_groups` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `change_groups` ADD `reverted_by` integer REFERENCES change_groups(id);--> statement-breakpoint
ALTER TABLE `change_groups` ADD `barrier` text;--> statement-breakpoint
CREATE INDEX `change_groups_request_idx` ON `change_groups` (`request_id`);--> statement-breakpoint
CREATE INDEX `change_groups_reverted_idx` ON `change_groups` (`reverted_by`);
CREATE TABLE `cost_item_amounts` (
	`cost_item_id` text NOT NULL,
	`tenancy_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`cost_item_id`, `tenancy_id`),
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cost_item_amounts_not_negative" CHECK("amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `cost_item_participants` (
	`cost_item_id` text NOT NULL,
	`unit_id` text NOT NULL,
	PRIMARY KEY(`cost_item_id`, `unit_id`),
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `cost_items` ADD `external_measure` text;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `external_total` real;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `external_total_cents` integer;--> statement-breakpoint
ALTER TABLE `units` ADD `mea` real;
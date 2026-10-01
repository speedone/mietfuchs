CREATE TABLE `cost_item_self_amounts` (
	`cost_item_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`cost_item_id`, `unit_id`),
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cost_item_self_amounts_not_negative" CHECK("amount_cents" >= 0)
);

CREATE TABLE `cost_item_contract` (
	`cost_item_id` text NOT NULL,
	`tenancy_id` text NOT NULL,
	`in_contract` integer NOT NULL,
	PRIMARY KEY(`cost_item_id`, `tenancy_id`),
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade
);

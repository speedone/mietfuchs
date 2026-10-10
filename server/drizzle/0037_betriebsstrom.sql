ALTER TABLE `cost_items` ADD `operating_power` text;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `operating_power_item_id` text REFERENCES cost_items(id);--> statement-breakpoint
ALTER TABLE `cost_items` ADD `operating_power_basis` text;
ALTER TABLE `heating_plants` ADD `contracting` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `heat_delivery_since` text;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `previous_supply` text;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `switch_announced_on` text;
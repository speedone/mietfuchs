ALTER TABLE `heating_plants` ADD `gmodg43_installed_on` text;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `emergency_install` integer;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `emergency_prior_duty` integer;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `new_building_first_use` text;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `building_application_before_2026_05_13` integer;--> statement-breakpoint
ALTER TABLE `properties` ADD `tight_market` integer;--> statement-breakpoint
ALTER TABLE `properties` ADD `tight_market_from` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `tight_market_to` text;--> statement-breakpoint
ALTER TABLE `tenancies` ADD `half_split_notice_on` text;
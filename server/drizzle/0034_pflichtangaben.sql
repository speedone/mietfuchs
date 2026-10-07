ALTER TABLE `heating_periods` ADD `info_reference_kwh_per_m2` real;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `info_reference_source` text;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `climate_factor_source` text;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `exemption` text;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `exemption_scope` text;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `exemption_billing_agreed` integer;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `agreed_otherwise` text;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `monthly_info_elsewhere` integer;
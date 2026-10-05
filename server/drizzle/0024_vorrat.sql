ALTER TABLE `heating_periods` ADD `stock_unit` text;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `opening_quantity` real;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `opening_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `opening_emissions_kg` real;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `opening_co2_cents` integer;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `opening_invoiced_before_2023` integer;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `closing_quantity` real;--> statement-breakpoint
ALTER TABLE `heating_periods` ADD `closing_measured_on` text;
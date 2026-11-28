PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_co2_statements` (
	`heating_period_id` text PRIMARY KEY NOT NULL,
	`method` text NOT NULL,
	`area_m2` real,
	`service_emissions_kg` real,
	`service_area_m2` real,
	`service_kg_per_m2` real,
	`service_landlord_permille` integer,
	`service_total_cents` integer,
	`service_landlord_cents` integer,
	`service_users_total_cents` integer,
	`service_users_total_approx` integer DEFAULT false NOT NULL,
	`service_units_count` integer,
	`service_cost_item_id` text,
	`service_self_landlord_cents` integer,
	`service_fuel_gross_cents` integer,
	`service_fuel_net_cents` integer,
	FOREIGN KEY (`heating_period_id`) REFERENCES `heating_periods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "co2_statements_method_known" CHECK("method" IN ('serviceDeducted', 'serviceShown', 'selfAfterService', 'self', 'serviceEnclosed')),
	CONSTRAINT "co2_statements_service_complete" CHECK("method" NOT IN ('serviceDeducted', 'serviceShown') OR ("service_users_total_cents" IS NOT NULL AND "service_landlord_cents" IS NOT NULL AND "service_units_count" IS NOT NULL)),
	CONSTRAINT "co2_statements_users_total_not_negative" CHECK("service_users_total_cents" >= 0),
	CONSTRAINT "co2_statements_landlord_not_negative" CHECK("service_landlord_cents" >= 0),
	CONSTRAINT "co2_statements_total_not_negative" CHECK("service_total_cents" >= 0),
	CONSTRAINT "co2_statements_self_landlord_not_negative" CHECK("service_self_landlord_cents" >= 0),
	CONSTRAINT "co2_statements_fuel_gross_not_negative" CHECK("service_fuel_gross_cents" >= 0),
	CONSTRAINT "co2_statements_fuel_net_not_negative" CHECK("service_fuel_net_cents" >= 0),
	CONSTRAINT "co2_statements_emissions_not_negative" CHECK("service_emissions_kg" >= 0),
	CONSTRAINT "co2_statements_kg_per_m2_not_negative" CHECK("service_kg_per_m2" >= 0),
	CONSTRAINT "co2_statements_permille_valid" CHECK("service_landlord_permille" BETWEEN 0 AND 1000),
	CONSTRAINT "co2_statements_units_positive" CHECK("service_units_count" > 0),
	CONSTRAINT "co2_statements_area_positive" CHECK("area_m2" > 0),
	CONSTRAINT "co2_statements_service_area_positive" CHECK("service_area_m2" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_co2_statements`("heating_period_id", "method", "area_m2", "service_emissions_kg", "service_area_m2", "service_kg_per_m2", "service_landlord_permille", "service_total_cents", "service_landlord_cents", "service_users_total_cents", "service_users_total_approx", "service_units_count", "service_cost_item_id", "service_self_landlord_cents", "service_fuel_gross_cents", "service_fuel_net_cents") SELECT "heating_period_id", "method", "area_m2", "service_emissions_kg", "service_area_m2", "service_kg_per_m2", "service_landlord_permille", "service_total_cents", "service_landlord_cents", "service_users_total_cents", "service_users_total_approx", "service_units_count", "service_cost_item_id", "service_self_landlord_cents", "service_fuel_gross_cents", "service_fuel_net_cents" FROM `co2_statements`;--> statement-breakpoint
DROP TABLE `co2_statements`;--> statement-breakpoint
ALTER TABLE `__new_co2_statements` RENAME TO `co2_statements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `includes_water` integer;
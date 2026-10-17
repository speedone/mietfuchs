CREATE TABLE `degree_day_values` (
	`property_id` text NOT NULL,
	`month` text NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`property_id`, `month`),
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "degree_day_values_month_valid" CHECK("month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("month", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "degree_day_values_value_positive" CHECK("value" > 0)
);
--> statement-breakpoint
CREATE TABLE `fuel_carry_frozen` (
	`delivery_id` text NOT NULL,
	`heating_period_id` text NOT NULL,
	`cents` integer NOT NULL,
	`emissions_kg` real DEFAULT 0 NOT NULL,
	`co2_cents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`delivery_id`, `heating_period_id`),
	FOREIGN KEY (`delivery_id`) REFERENCES `fuel_deliveries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`heating_period_id`) REFERENCES `heating_periods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fuel_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`plant_id` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`invoice_date` text,
	`delivered_at` text,
	`invoice_from` text,
	`invoice_to` text,
	`unit_id` text,
	`amount_cents` integer,
	`quantity` real,
	`quantity_unit` text,
	`energy_kwh` real,
	`gas_basis` text,
	`heating_value` real,
	`emissions_kg` real,
	`co2_cost_cents` integer,
	`emission_factor` real,
	`grid_fee_cents` integer,
	`bio_cost_cents` integer,
	`share_permille` real,
	`fixed_cents` integer,
	`estimated` integer DEFAULT false NOT NULL,
	`used_by_service` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fuel_deliveries_quantity_unit_known" CHECK("quantity_unit" IN ('l', 'kg', 'm3', 'kWh', 'srm')),
	CONSTRAINT "fuel_deliveries_gas_basis_known" CHECK("gas_basis" IN ('hs', 'hi')),
	CONSTRAINT "fuel_deliveries_invoice_complete" CHECK(("invoice_from" IS NULL) = ("invoice_to" IS NULL)),
	CONSTRAINT "fuel_deliveries_invoice_from_valid" CHECK("invoice_from" IS NULL OR "invoice_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "fuel_deliveries_invoice_to_valid" CHECK("invoice_to" IS NULL OR "invoice_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "fuel_deliveries_invoice_date_valid" CHECK("invoice_date" IS NULL OR "invoice_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "fuel_deliveries_delivered_at_valid" CHECK("delivered_at" IS NULL OR "delivered_at" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "fuel_deliveries_invoice_order_valid" CHECK("invoice_from" IS NULL OR "invoice_from" <= "invoice_to"),
	CONSTRAINT "fuel_deliveries_share_valid" CHECK("share_permille" BETWEEN 0 AND 1000),
	CONSTRAINT "fuel_deliveries_heating_value_positive" CHECK("heating_value" > 0),
	CONSTRAINT "fuel_deliveries_quantity_not_negative" CHECK("quantity" >= 0),
	CONSTRAINT "fuel_deliveries_energy_not_negative" CHECK("energy_kwh" >= 0),
	CONSTRAINT "fuel_deliveries_emissions_not_negative" CHECK("emissions_kg" >= 0),
	CONSTRAINT "fuel_deliveries_co2_not_negative" CHECK("co2_cost_cents" >= 0),
	CONSTRAINT "fuel_deliveries_factor_not_negative" CHECK("emission_factor" >= 0),
	CONSTRAINT "fuel_deliveries_fixed_not_negative" CHECK("fixed_cents" >= 0),
	CONSTRAINT "fuel_deliveries_grid_fee_not_negative" CHECK("grid_fee_cents" >= 0),
	CONSTRAINT "fuel_deliveries_bio_not_negative" CHECK("bio_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `fuel_delivery_parts` (
	`delivery_id` text NOT NULL,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`energy_kwh` real,
	`amount_cents` integer NOT NULL,
	`fixed_cents` integer,
	`emissions_kg` real,
	`co2_cost_cents` integer,
	PRIMARY KEY(`delivery_id`, `from`),
	FOREIGN KEY (`delivery_id`) REFERENCES `fuel_deliveries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fuel_delivery_parts_from_valid" CHECK("from" IS NULL OR "from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "fuel_delivery_parts_to_valid" CHECK("to" IS NULL OR "to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "fuel_delivery_parts_order_valid" CHECK("from" <= "to"),
	CONSTRAINT "fuel_delivery_parts_energy_not_negative" CHECK("energy_kwh" >= 0),
	CONSTRAINT "fuel_delivery_parts_fixed_not_negative" CHECK("fixed_cents" >= 0),
	CONSTRAINT "fuel_delivery_parts_emissions_not_negative" CHECK("emissions_kg" >= 0),
	CONSTRAINT "fuel_delivery_parts_co2_not_negative" CHECK("co2_cost_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE `cost_items` ADD `fuel_delivery_id` text REFERENCES fuel_deliveries(id);--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `non_residential` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `restriction` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `heating_plants` ADD `district_ets_new` integer DEFAULT false NOT NULL;
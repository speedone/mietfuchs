CREATE TABLE `heating_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`plant_id` text NOT NULL,
	`period` text NOT NULL,
	`heat_consumption_pct` real,
	`water_consumption_pct` real,
	`above_70_agreed` integer,
	`insulation_rule` text,
	`dhw_method` text,
	`dhw_heat_kwh` real,
	`total_heat_kwh` real,
	`dhw_volume_m3` real,
	`dhw_temp_c` real,
	`dhw_unmeasurable` integer,
	`info_taxes_text` text,
	`info_district_ghg` real,
	`info_district_pef` real,
	`climate_factor` real,
	`climate_factor_prev` real,
	`consumer_contract` text,
	`info_contacts_confirmed` integer,
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_periods_period_valid" CHECK("period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_periods_heat_pct_valid" CHECK("heat_consumption_pct" BETWEEN 0 AND 100),
	CONSTRAINT "heating_periods_water_pct_valid" CHECK("water_consumption_pct" BETWEEN 0 AND 100),
	CONSTRAINT "heating_periods_insulation_rule_known" CHECK("insulation_rule" IN ('applies', 'notApplies', 'unknown')),
	CONSTRAINT "heating_periods_dhw_method_known" CHECK("dhw_method" IN ('heatMeter', 'volumeFormula', 'areaFormula')),
	CONSTRAINT "heating_periods_dhw_heat_not_negative" CHECK("dhw_heat_kwh" >= 0),
	CONSTRAINT "heating_periods_total_heat_not_negative" CHECK("total_heat_kwh" >= 0),
	CONSTRAINT "heating_periods_dhw_volume_not_negative" CHECK("dhw_volume_m3" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `heating_periods_plant_period_idx` ON `heating_periods` (`plant_id`,`period`);--> statement-breakpoint
CREATE TABLE `heating_plant_units` (
	`plant_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`heated_area_m2` real,
	PRIMARY KEY(`plant_id`, `unit_id`),
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_plant_units_heated_area_positive" CHECK("heated_area_m2" > 0)
);
--> statement-breakpoint
CREATE TABLE `heating_plants` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`energy` text NOT NULL,
	`supply` text DEFAULT 'central' NOT NULL,
	`method` text DEFAULT 'manual' NOT NULL,
	`separate_settlement` integer,
	`devices_remote` text DEFAULT 'unknown' NOT NULL,
	`devices_installed_after_2021_12` text DEFAULT 'unknown' NOT NULL,
	`new_devices_install` text,
	`source` text DEFAULT 'building' NOT NULL,
	`capture_installed_on` text,
	`captured_on_2024_10_01` integer,
	`warm_rent_average_2022_2024` integer,
	`change_split` text DEFAULT 'degreeDays' NOT NULL,
	`period_start_month` integer,
	`units_limited` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "heating_plants_energy_known" CHECK("energy" IN ('gas', 'oil', 'lpg', 'pellets', 'wood', 'districtHeating', 'heatPump', 'electric', 'coal', 'other')),
	CONSTRAINT "heating_plants_supply_known" CHECK("supply" IN ('central', 'perUnit')),
	CONSTRAINT "heating_plants_method_known" CHECK("method" IN ('service', 'self', 'manual')),
	CONSTRAINT "heating_plants_devices_remote_known" CHECK("devices_remote" IN ('all', 'none', 'partial', 'unknown')),
	CONSTRAINT "heating_plants_devices_installed_known" CHECK("devices_installed_after_2021_12" IN ('all', 'some', 'none', 'unknown')),
	CONSTRAINT "heating_plants_new_devices_install_known" CHECK("new_devices_install" IN ('single', 'whole')),
	CONSTRAINT "heating_plants_source_known" CHECK("source" IN ('building', 'homeowners')),
	CONSTRAINT "heating_plants_change_split_known" CHECK("change_split" IN ('degreeDays', 'time')),
	CONSTRAINT "heating_plants_period_start_month_valid" CHECK("period_start_month" BETWEEN 1 AND 12),
	CONSTRAINT "heating_plants_source_method_valid" CHECK("source" <> 'homeowners' OR "method" = 'service'),
	CONSTRAINT "heating_plants_warm_rent_not_negative" CHECK("warm_rent_average_2022_2024" >= 0)
);
--> statement-breakpoint
ALTER TABLE `cost_items` ADD `heating_plant_id` text REFERENCES heating_plants(id);--> statement-breakpoint
ALTER TABLE `meters` ADD `heating_plant_id` text REFERENCES heating_plants(id);--> statement-breakpoint
ALTER TABLE `meters` ADD `heating_role` text;--> statement-breakpoint
ALTER TABLE `meters` ADD `remote_readable` integer;--> statement-breakpoint
ALTER TABLE `meters` ADD `installed_on` text;
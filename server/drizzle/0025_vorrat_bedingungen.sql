PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_heating_periods` (
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
	`stock_unit` text,
	`opening_quantity` real,
	`opening_cost_cents` integer,
	`opening_emissions_kg` real,
	`opening_co2_cents` integer,
	`opening_invoiced_before_2023` integer,
	`opening_already_settled` integer,
	`closing_quantity` real,
	`closing_measured_on` text,
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_periods_period_valid" CHECK("period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_periods_heat_pct_valid" CHECK("heat_consumption_pct" BETWEEN 0 AND 100),
	CONSTRAINT "heating_periods_water_pct_valid" CHECK("water_consumption_pct" BETWEEN 0 AND 100),
	CONSTRAINT "heating_periods_insulation_rule_known" CHECK("insulation_rule" IN ('applies', 'notApplies', 'unknown')),
	CONSTRAINT "heating_periods_dhw_method_known" CHECK("dhw_method" IN ('heatMeter', 'volumeFormula', 'areaFormula')),
	CONSTRAINT "heating_periods_dhw_heat_not_negative" CHECK("dhw_heat_kwh" >= 0),
	CONSTRAINT "heating_periods_total_heat_not_negative" CHECK("total_heat_kwh" >= 0),
	CONSTRAINT "heating_periods_dhw_volume_not_negative" CHECK("dhw_volume_m3" >= 0),
	CONSTRAINT "heating_periods_stock_unit_known" CHECK("stock_unit" IN ('l', 'kg', 'srm')),
	CONSTRAINT "heating_periods_opening_quantity_not_negative" CHECK("opening_quantity" >= 0),
	CONSTRAINT "heating_periods_opening_cost_not_negative" CHECK("opening_cost_cents" >= 0),
	CONSTRAINT "heating_periods_opening_emissions_not_negative" CHECK("opening_emissions_kg" >= 0),
	CONSTRAINT "heating_periods_opening_co2_not_negative" CHECK("opening_co2_cents" >= 0),
	CONSTRAINT "heating_periods_closing_quantity_not_negative" CHECK("closing_quantity" >= 0),
	CONSTRAINT "heating_periods_closing_measured_on_valid" CHECK("closing_measured_on" IS NULL OR "closing_measured_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
INSERT INTO `__new_heating_periods`("id", "plant_id", "period", "heat_consumption_pct", "water_consumption_pct", "above_70_agreed", "insulation_rule", "dhw_method", "dhw_heat_kwh", "total_heat_kwh", "dhw_volume_m3", "dhw_temp_c", "dhw_unmeasurable", "info_taxes_text", "info_district_ghg", "info_district_pef", "climate_factor", "climate_factor_prev", "consumer_contract", "info_contacts_confirmed", "stock_unit", "opening_quantity", "opening_cost_cents", "opening_emissions_kg", "opening_co2_cents", "opening_invoiced_before_2023", "opening_already_settled", "closing_quantity", "closing_measured_on") SELECT "id", "plant_id", "period", "heat_consumption_pct", "water_consumption_pct", "above_70_agreed", "insulation_rule", "dhw_method", "dhw_heat_kwh", "total_heat_kwh", "dhw_volume_m3", "dhw_temp_c", "dhw_unmeasurable", "info_taxes_text", "info_district_ghg", "info_district_pef", "climate_factor", "climate_factor_prev", "consumer_contract", "info_contacts_confirmed", "stock_unit", "opening_quantity", "opening_cost_cents", "opening_emissions_kg", "opening_co2_cents", "opening_invoiced_before_2023", "opening_already_settled", "closing_quantity", "closing_measured_on" FROM `heating_periods`;--> statement-breakpoint
DROP TABLE `heating_periods`;--> statement-breakpoint
ALTER TABLE `__new_heating_periods` RENAME TO `heating_periods`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `heating_periods_plant_period_idx` ON `heating_periods` (`plant_id`,`period`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_meters` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`unit_id` text,
	`type` text NOT NULL,
	`meter_number` text,
	`unit` text NOT NULL,
	`heating_plant_id` text,
	`heating_role` text,
	`remote_readable` integer,
	`installed_on` text,
	`hca_scale` text,
	`rating_factor` real,
	`calibrated_until` integer,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`heating_plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "meters_type_known" CHECK("type" IN ('kaltwasser', 'warmwasser', 'strom', 'waerme', 'hkv', 'sonstig')),
	CONSTRAINT "meters_heating_role_known" CHECK("heating_role" IN ('supply', 'dhwHeat', 'totalHeat')),
	CONSTRAINT "meters_heating_role_plant_valid" CHECK(("heating_plant_id" IS NULL) = ("heating_role" IS NULL)),
	CONSTRAINT "meters_heating_plant_unit_valid" CHECK("heating_plant_id" IS NULL OR "unit_id" IS NULL),
	CONSTRAINT "meters_hca_scale_known" CHECK("hca_scale" IN ('unit', 'product')),
	CONSTRAINT "meters_rating_factor_positive" CHECK("rating_factor" > 0),
	CONSTRAINT "meters_hca_fields_valid" CHECK("type" = 'hkv' OR ("rating_factor" IS NULL AND "hca_scale" IS NULL)),
	CONSTRAINT "meters_calibrated_until_valid" CHECK("calibrated_until" IS NULL OR (typeof("calibrated_until") = 'integer' AND "calibrated_until" BETWEEN 1000 AND 9999)),
	CONSTRAINT "meters_calibrated_until_hca_valid" CHECK("calibrated_until" IS NULL OR "type" <> 'hkv')
);
--> statement-breakpoint
INSERT INTO `__new_meters`("id", "property_id", "name", "unit_id", "type", "meter_number", "unit", "heating_plant_id", "heating_role", "remote_readable", "installed_on", "hca_scale", "rating_factor", "calibrated_until") SELECT "id", "property_id", "name", "unit_id", "type", "meter_number", "unit", "heating_plant_id", "heating_role", "remote_readable", "installed_on", "hca_scale", "rating_factor", "calibrated_until" FROM `meters`;--> statement-breakpoint
DROP TABLE `meters`;--> statement-breakpoint
ALTER TABLE `__new_meters` RENAME TO `meters`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
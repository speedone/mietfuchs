PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_heating_self_spans` (
	`plant_id` text NOT NULL,
	`from_period` text NOT NULL,
	`until_period` text,
	`capture` text,
	`hot_water` text,
	PRIMARY KEY(`plant_id`, `from_period`),
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_self_spans_from_valid" CHECK("from_period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("from_period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_self_spans_until_valid" CHECK("until_period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("until_period", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_self_spans_order_valid" CHECK("until_period" IS NULL OR "until_period" > "from_period"),
	CONSTRAINT "heating_self_spans_capture_known" CHECK("capture" IN ('heatMeter', 'hca', 'serviceValues')),
	CONSTRAINT "heating_self_spans_hot_water_known" CHECK("hot_water" IN ('combined', 'separate', 'none'))
);
--> statement-breakpoint
INSERT INTO `__new_heating_self_spans`("plant_id", "from_period", "until_period", "capture", "hot_water") SELECT "plant_id", "from_period", "until_period", "capture", "hot_water" FROM `heating_self_spans`;--> statement-breakpoint
DROP TABLE `heating_self_spans`;--> statement-breakpoint
ALTER TABLE `__new_heating_self_spans` RENAME TO `heating_self_spans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
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
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`heating_plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "meters_type_known" CHECK("type" IN ('kaltwasser', 'warmwasser', 'strom', 'waerme', 'hkv', 'sonstig')),
	CONSTRAINT "meters_heating_role_known" CHECK("heating_role" IN ('supply', 'dhwHeat', 'totalHeat')),
	CONSTRAINT "meters_heating_role_plant_valid" CHECK(("heating_plant_id" IS NULL) = ("heating_role" IS NULL)),
	CONSTRAINT "meters_heating_plant_unit_valid" CHECK("heating_plant_id" IS NULL OR "unit_id" IS NULL),
	CONSTRAINT "meters_hca_scale_known" CHECK("hca_scale" IN ('unit', 'product')),
	CONSTRAINT "meters_rating_factor_positive" CHECK("rating_factor" > 0),
	CONSTRAINT "meters_hca_fields_valid" CHECK("type" = 'hkv' OR ("rating_factor" IS NULL AND "hca_scale" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_meters`("id", "property_id", "name", "unit_id", "type", "meter_number", "unit", "heating_plant_id", "heating_role", "remote_readable", "installed_on", "hca_scale", "rating_factor") SELECT "id", "property_id", "name", "unit_id", "type", "meter_number", "unit", "heating_plant_id", "heating_role", "remote_readable", "installed_on", "hca_scale", "rating_factor" FROM `meters`;--> statement-breakpoint
DROP TABLE `meters`;--> statement-breakpoint
ALTER TABLE `__new_meters` RENAME TO `meters`;
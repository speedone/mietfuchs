CREATE TABLE `heating_monthly_info` (
	`plant_id` text NOT NULL,
	`month` text NOT NULL,
	`reference_kwh_per_m2` real,
	`reference_source` text,
	`sent_on` text,
	PRIMARY KEY(`plant_id`, `month`),
	FOREIGN KEY (`plant_id`) REFERENCES `heating_plants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "heating_monthly_info_month_valid" CHECK("month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("month", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "heating_monthly_info_reference_positive" CHECK("reference_kwh_per_m2" IS NULL OR "reference_kwh_per_m2" > 0),
	CONSTRAINT "heating_monthly_info_reference_source_complete" CHECK("reference_kwh_per_m2" IS NULL OR length(trim(coalesce("reference_source", ''))) > 0),
	CONSTRAINT "heating_monthly_info_sent_on_valid" CHECK("sent_on" IS NULL OR "sent_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

CREATE TABLE `flat_rates` (
	`tenancy_id` text NOT NULL,
	`from` text NOT NULL,
	`monthly_cents` integer NOT NULL,
	PRIMARY KEY(`tenancy_id`, `from`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flat_rates_monthly_not_negative" CHECK("monthly_cents" >= 0)
);

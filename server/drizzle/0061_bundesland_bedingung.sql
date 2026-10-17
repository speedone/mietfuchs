PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`address` text NOT NULL,
	`landlord_name` text,
	`iban` text,
	`payment_deadline_days` integer,
	`cable_built_before_dec_2021` integer,
	`period_start_month` integer DEFAULT 1 NOT NULL,
	`tight_market` integer,
	`tight_market_from` text,
	`tight_market_to` text,
	`state` text,
	CONSTRAINT "properties_kind_known" CHECK("kind" IN ('mfh', 'etw', 'efh', 'zfh', 'sonstiges')),
	CONSTRAINT "properties_deadline_not_negative" CHECK("payment_deadline_days" >= 0),
	CONSTRAINT "properties_period_start_month_valid" CHECK("period_start_month" BETWEEN 1 AND 12),
	CONSTRAINT "properties_tight_market_dates_valid" CHECK(("tight_market_from" IS NULL AND "tight_market_to" IS NULL) OR "tight_market" IS 1),
	CONSTRAINT "properties_tight_market_from_valid" CHECK("tight_market_from" IS NULL OR "tight_market_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "properties_tight_market_to_valid" CHECK("tight_market_to" IS NULL OR "tight_market_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "properties_tight_market_order_valid" CHECK("tight_market_from" IS NULL OR "tight_market_to" IS NULL OR "tight_market_from" <= "tight_market_to"),
	CONSTRAINT "properties_state_known" CHECK("state" IN ('BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'))
);
--> statement-breakpoint
INSERT INTO `__new_properties`("id", "name", "kind", "address", "landlord_name", "iban", "payment_deadline_days", "cable_built_before_dec_2021", "period_start_month", "tight_market", "tight_market_from", "tight_market_to", "state") SELECT "id", "name", "kind", "address", "landlord_name", "iban", "payment_deadline_days", "cable_built_before_dec_2021", "period_start_month", "tight_market", "tight_market_from", "tight_market_to", "state" FROM `properties`;--> statement-breakpoint
DROP TABLE `properties`;--> statement-breakpoint
ALTER TABLE `__new_properties` RENAME TO `properties`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
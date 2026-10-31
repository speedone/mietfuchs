PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`address` text NOT NULL,
	`landlord_name` text,
	`iban` text,
	`payment_deadline_days` integer,
	`landlord_address` text,
	`landlord_contact` text,
	`print_letter` integer,
	`cable_built_before_dec_2021` integer,
	`period_start_month` integer DEFAULT 1 NOT NULL,
	`tight_market` integer,
	`tight_market_from` text,
	`tight_market_to` text,
	`state` text,
	`ground_tax_file_number` text,
	`purchase_contract_on` text,
	`ownership_transfer_on` text,
	`building_application_on` text,
	`completed_on` text,
	CONSTRAINT "properties_kind_known" CHECK("kind" IN ('mfh', 'etw', 'efh', 'zfh', 'sonstiges')),
	CONSTRAINT "properties_deadline_not_negative" CHECK("payment_deadline_days" >= 0),
	CONSTRAINT "properties_period_start_month_valid" CHECK("period_start_month" BETWEEN 1 AND 12),
	CONSTRAINT "properties_tight_market_dates_valid" CHECK(("tight_market_from" IS NULL AND "tight_market_to" IS NULL) OR "tight_market" IS 1),
	CONSTRAINT "properties_tight_market_from_valid" CHECK("tight_market_from" IS NULL OR "tight_market_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "properties_tight_market_to_valid" CHECK("tight_market_to" IS NULL OR "tight_market_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "properties_tight_market_order_valid" CHECK("tight_market_from" IS NULL OR "tight_market_to" IS NULL OR "tight_market_from" <= "tight_market_to"),
	CONSTRAINT "properties_state_known" CHECK("state" IN ('BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH')),
	CONSTRAINT "properties_ground_tax_file_number_valid" CHECK("ground_tax_file_number" IS NULL OR length("ground_tax_file_number") <= 40),
	CONSTRAINT "properties_purchase_contract_on_valid" CHECK("purchase_contract_on" IS NULL OR "purchase_contract_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "properties_ownership_transfer_on_valid" CHECK("ownership_transfer_on" IS NULL OR "ownership_transfer_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "properties_building_application_on_valid" CHECK("building_application_on" IS NULL OR "building_application_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "properties_completed_on_valid" CHECK("completed_on" IS NULL OR "completed_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
INSERT INTO `__new_properties`("id", "name", "kind", "address", "landlord_name", "iban", "payment_deadline_days", "landlord_address", "landlord_contact", "print_letter", "cable_built_before_dec_2021", "period_start_month", "tight_market", "tight_market_from", "tight_market_to", "state", "ground_tax_file_number", "purchase_contract_on", "ownership_transfer_on", "building_application_on", "completed_on") SELECT "id", "name", "kind", "address", "landlord_name", "iban", "payment_deadline_days", "landlord_address", "landlord_contact", "print_letter", "cable_built_before_dec_2021", "period_start_month", "tight_market", "tight_market_from", "tight_market_to", "state", "ground_tax_file_number", "purchase_contract_on", "ownership_transfer_on", "building_application_on", "completed_on" FROM `properties`;--> statement-breakpoint
DROP TABLE `properties`;--> statement-breakpoint
ALTER TABLE `__new_properties` RENAME TO `properties`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_tenancies` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`tenant_name` text NOT NULL,
	`persons` integer NOT NULL,
	`start` text NOT NULL,
	`end` text,
	`email` text,
	`phone` text,
	`correspondence_address` text,
	`letter_salutation` text,
	`iban` text,
	`contract_date` text,
	`deposit_cents` integer,
	`deposit_status` text,
	`notes` text,
	`cost_model` text,
	`heating_model` text,
	`self_supply_kind` text,
	`half_split_notice_on` text,
	`relative` integer,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenancies_persons_not_negative" CHECK("persons" >= 0),
	CONSTRAINT "tenancies_deposit_not_negative" CHECK("deposit_cents" >= 0),
	CONSTRAINT "tenancies_deposit_status_known" CHECK("deposit_status" IN ('offen', 'erhalten', 'teilweise', 'zurückgezahlt')),
	CONSTRAINT "tenancies_cost_model_known" CHECK("cost_model" IN ('settlement', 'flatRate', 'inclusive')),
	CONSTRAINT "tenancies_heating_model_known" CHECK("heating_model" IN ('settlement', 'flatRate', 'inclusive', 'selfSupply')),
	CONSTRAINT "tenancies_self_supply_kind_known" CHECK("self_supply_kind" IN ('perUnit', 'central')),
	CONSTRAINT "tenancies_self_supply_kind_valid" CHECK("self_supply_kind" IS NULL OR "heating_model" IS 'selfSupply'),
	CONSTRAINT "tenancies_half_split_notice_valid" CHECK("half_split_notice_on" IS NULL OR "half_split_notice_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "tenancies_relative_known" CHECK("relative" IS NULL OR "relative" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_tenancies`("id", "unit_id", "tenant_name", "persons", "start", "end", "email", "phone", "correspondence_address", "letter_salutation", "iban", "contract_date", "deposit_cents", "deposit_status", "notes", "cost_model", "heating_model", "self_supply_kind", "half_split_notice_on", "relative") SELECT "id", "unit_id", "tenant_name", "persons", "start", "end", "email", "phone", "correspondence_address", "letter_salutation", "iban", "contract_date", "deposit_cents", "deposit_status", "notes", "cost_model", "heating_model", "self_supply_kind", "half_split_notice_on", "relative" FROM `tenancies`;--> statement-breakpoint
DROP TABLE `tenancies`;--> statement-breakpoint
ALTER TABLE `__new_tenancies` RENAME TO `tenancies`;
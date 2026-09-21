CREATE TABLE `ai_slots` (
	`slot` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`preset` text NOT NULL,
	`url` text NOT NULL,
	`model` text NOT NULL,
	`vision` integer,
	`consent_url` text,
	`consent_model` text,
	`consent_date` text,
	CONSTRAINT "ai_slots_slot_known" CHECK("slot" IN ('text', 'images')),
	CONSTRAINT "ai_slots_provider_known" CHECK("provider" IN ('ollama', 'openai'))
);
--> statement-breakpoint
CREATE TABLE `base_rents` (
	`tenancy_id` text NOT NULL,
	`from` text NOT NULL,
	`monthly_cents` integer NOT NULL,
	PRIMARY KEY(`tenancy_id`, `from`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "base_rents_monthly_not_negative" CHECK("monthly_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `closed_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`closed_at` text NOT NULL,
	`sent_at` text,
	`settlement` text NOT NULL,
	CONSTRAINT "closed_settlements_settlement_is_json" CHECK(json_valid("closed_settlements"."settlement"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `closed_settlements_year_idx` ON `closed_settlements` (`year`);--> statement-breakpoint
CREATE TABLE `cost_item_shares` (
	`cost_item_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`percent` real NOT NULL,
	PRIMARY KEY(`cost_item_id`, `unit_id`),
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cost_item_shares_percent_not_negative" CHECK("percent" >= 0)
);
--> statement-breakpoint
CREATE TABLE `cost_items` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`vendor` text,
	`amount_cents` integer NOT NULL,
	`key` text NOT NULL,
	`direct_unit_id` text,
	`meter_type` text,
	`labor_35a_cents` integer,
	`invoice_file` text,
	FOREIGN KEY (`direct_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "cost_items_key_known" CHECK("key" IN ('area', 'persons', 'units', 'direct', 'meter', 'custom')),
	CONSTRAINT "cost_items_meter_type_known" CHECK("meter_type" IN ('kaltwasser', 'strom', 'waerme', 'sonstig'))
);
--> statement-breakpoint
CREATE INDEX `cost_items_year_idx` ON `cost_items` (`year`);--> statement-breakpoint
CREATE TABLE `meters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`unit_id` text,
	`type` text NOT NULL,
	`meter_number` text,
	`unit` text NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meters_type_known" CHECK("type" IN ('kaltwasser', 'strom', 'waerme', 'sonstig'))
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenancy_id` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `person_history` (
	`tenancy_id` text NOT NULL,
	`from` text NOT NULL,
	`persons` integer NOT NULL,
	PRIMARY KEY(`tenancy_id`, `from`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "person_history_persons_not_negative" CHECK("persons" >= 0)
);
--> statement-breakpoint
CREATE TABLE `prepayment_overrides` (
	`tenancy_id` text NOT NULL,
	`year` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`tenancy_id`, `year`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prepayment_overrides_amount_not_negative" CHECK("amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `prepayments` (
	`tenancy_id` text NOT NULL,
	`from` text NOT NULL,
	`monthly_cents` integer NOT NULL,
	PRIMARY KEY(`tenancy_id`, `from`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prepayments_monthly_not_negative" CHECK("monthly_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `readings` (
	`id` text PRIMARY KEY NOT NULL,
	`meter_id` text NOT NULL,
	`date` text NOT NULL,
	`value` real NOT NULL,
	`replacement` integer,
	`old_end_value` real,
	`note` text,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "readings_value_not_negative" CHECK("value" >= 0),
	CONSTRAINT "readings_old_end_value_not_negative" CHECK("old_end_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`house_name` text NOT NULL,
	`address` text NOT NULL,
	`landlord_name` text NOT NULL,
	`iban` text NOT NULL,
	`payment_deadline_days` integer NOT NULL,
	`ollama_url` text NOT NULL,
	`ollama_model` text NOT NULL,
	`print_adjust_suggestion` integer,
	`print_attachments` integer,
	`update_check` text,
	`update_dismissed` text,
	`ai_timeout_seconds` integer,
	`ai_num_ctx` integer,
	`ai_max_output_tokens` integer,
	`ai_page_image_edge` integer,
	`ai_json_mode` text NOT NULL,
	`ai_reasoning_effort` text,
	`ai_extra_instructions` text NOT NULL,
	CONSTRAINT "settings_single_row" CHECK("settings"."id" = 1),
	CONSTRAINT "settings_deadline_not_negative" CHECK("payment_deadline_days" >= 0),
	CONSTRAINT "settings_update_check_known" CHECK("update_check" IN ('on', 'off')),
	CONSTRAINT "settings_ai_json_mode_known" CHECK("ai_json_mode" IN ('auto', 'schema', 'object', 'prompt'))
);
--> statement-breakpoint
CREATE TABLE `tenancies` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`tenant_name` text NOT NULL,
	`persons` integer NOT NULL,
	`start` text NOT NULL,
	`end` text,
	`email` text,
	`phone` text,
	`correspondence_address` text,
	`iban` text,
	`contract_date` text,
	`deposit_cents` integer,
	`deposit_status` text,
	`notes` text,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenancies_persons_not_negative" CHECK("persons" >= 0),
	CONSTRAINT "tenancies_deposit_not_negative" CHECK("deposit_cents" >= 0),
	CONSTRAINT "tenancies_deposit_status_known" CHECK("deposit_status" IN ('offen', 'erhalten', 'teilweise', 'zurückgezahlt'))
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`area_m2` real NOT NULL,
	`participates` integer NOT NULL,
	`self_used` integer,
	`self_persons` integer,
	`rooms` integer,
	`floor` text,
	`notes` text,
	CONSTRAINT "units_area_not_negative" CHECK("area_m2" >= 0),
	CONSTRAINT "units_self_persons_not_negative" CHECK("self_persons" >= 0),
	CONSTRAINT "units_rooms_not_negative" CHECK("rooms" >= 0)
);

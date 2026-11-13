CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`iban` text,
	`other_id` text,
	`label` text NOT NULL,
	`kind` text DEFAULT 'mixed' NOT NULL,
	`rental_confirmed_at` text,
	CONSTRAINT "bank_accounts_kind_known" CHECK("kind" IN ('mixed', 'rental')),
	CONSTRAINT "bank_accounts_rental_valid" CHECK("kind" <> 'rental' OR "rental_confirmed_at" IS NOT NULL),
	CONSTRAINT "bank_accounts_identity_complete" CHECK("iban" IS NOT NULL OR "other_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounts_iban_idx` ON `bank_accounts` (`iban`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounts_other_id_idx` ON `bank_accounts` (`other_id`);--> statement-breakpoint
CREATE TABLE `bank_days` (
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`import_id` text NOT NULL,
	`entry_count` integer NOT NULL,
	`credit_cents` integer NOT NULL,
	`debit_cents` integer NOT NULL,
	PRIMARY KEY(`account_id`, `date`),
	FOREIGN KEY (`account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `bank_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bank_days_entry_count_not_negative" CHECK("entry_count" >= 0),
	CONSTRAINT "bank_days_credit_not_negative" CHECK("credit_cents" >= 0),
	CONSTRAINT "bank_days_debit_not_negative" CHECK("debit_cents" >= 0),
	CONSTRAINT "bank_days_date_valid" CHECK("date" IS NULL OR "date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE TABLE `bank_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`file_sha256` text NOT NULL,
	`file_name` text NOT NULL,
	`format` text NOT NULL,
	`statement_id` text,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`opening_balance_cents` integer,
	`closing_balance_cents` integer,
	`imported_at` text NOT NULL,
	`fingerprint_version` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bank_imports_format_known" CHECK("format" IN ('camt.052', 'camt.053', 'camt.054', 'mt940')),
	CONSTRAINT "bank_imports_from_valid" CHECK("from_date" IS NULL OR "from_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "bank_imports_to_valid" CHECK("to_date" IS NULL OR "to_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_imports_file_idx` ON `bank_imports` (`account_id`,`file_sha256`,`from_date`,`to_date`);--> statement-breakpoint
CREATE TABLE `bank_transaction_links` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`payment_id` text,
	`deposit_entry_id` text,
	`created` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `bank_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deposit_entry_id`) REFERENCES `deposit_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bank_transaction_links_target_valid" CHECK(("payment_id" IS NULL) <> ("deposit_entry_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `bank_transaction_links_transaction_idx` ON `bank_transaction_links` (`transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_transaction_links_payment_idx` ON `bank_transaction_links` (`payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_transaction_links_deposit_idx` ON `bank_transaction_links` (`deposit_entry_id`);--> statement-breakpoint
CREATE TABLE `bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`import_id` text NOT NULL,
	`booking_date` text NOT NULL,
	`value_date` text,
	`amount_cents` integer NOT NULL,
	`counterparty_name` text,
	`counterparty_iban` text,
	`ultimate_party_name` text,
	`purpose` text NOT NULL,
	`bank_reference` text,
	`end_to_end_id` text,
	`reversal` integer DEFAULT false NOT NULL,
	`fingerprint` text NOT NULL,
	`batch_reference` text,
	`batch_part` integer,
	`batch_parts` integer,
	`batch_total_cents` integer,
	`set_aside` text,
	FOREIGN KEY (`account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `bank_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bank_transactions_amount_valid" CHECK("amount_cents" <> 0),
	CONSTRAINT "bank_transactions_set_aside_known" CHECK("set_aside" IN ('transfer', 'notRental', 'other')),
	CONSTRAINT "bank_transactions_booking_date_valid" CHECK("booking_date" IS NULL OR "booking_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "bank_transactions_value_date_valid" CHECK("value_date" IS NULL OR "value_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `bank_transactions_account_date_idx` ON `bank_transactions` (`account_id`,`booking_date`);--> statement-breakpoint
CREATE INDEX `bank_transactions_fingerprint_idx` ON `bank_transactions` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `tenancy_payers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenancy_id` text NOT NULL,
	`iban` text NOT NULL,
	`name` text,
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenancy_payers_tenancy_iban_idx` ON `tenancy_payers` (`tenancy_id`,`iban`);--> statement-breakpoint
CREATE INDEX `tenancy_payers_iban_idx` ON `tenancy_payers` (`iban`);
CREATE TABLE `letter_texts` (
	`block` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	CONSTRAINT "letter_texts_block_known" CHECK("block" IN ('subject', 'salutation', 'intro', 'credit', 'backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'receipts', 'attachments', 'closing', 'greeting', 'signature'))
);
--> statement-breakpoint
CREATE TABLE `property_letter_texts` (
	`property_id` text NOT NULL,
	`block` text NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`property_id`, `block`),
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "property_letter_texts_block_known" CHECK("block" IN ('subject', 'salutation', 'intro', 'credit', 'backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'receipts', 'attachments', 'closing', 'greeting', 'signature'))
);
--> statement-breakpoint
CREATE TABLE `tenancy_letter_adjustments` (
	`tenancy_id` text NOT NULL,
	`doc` text NOT NULL,
	`mode` text NOT NULL,
	`cents` integer,
	PRIMARY KEY(`tenancy_id`, `doc`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenancy_letter_adjustments_mode_known" CHECK("mode" IN ('none', 'suggestion', 'custom')),
	CONSTRAINT "tenancy_letter_adjustments_doc_complete" CHECK(length("doc") > 0),
	CONSTRAINT "tenancy_letter_adjustments_cents_valid" CHECK(("mode" = 'custom' AND "cents" IS NOT NULL AND typeof("cents") = 'integer' AND "cents" >= 0) OR ("mode" <> 'custom' AND "cents" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `tenancy_letter_texts` (
	`tenancy_id` text NOT NULL,
	`doc` text NOT NULL,
	`block` text NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`tenancy_id`, `doc`, `block`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenancy_letter_texts_block_known" CHECK("block" IN ('subject', 'salutation', 'intro', 'credit', 'backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'receipts', 'attachments', 'closing', 'greeting', 'signature')),
	CONSTRAINT "tenancy_letter_texts_doc_complete" CHECK(length("doc") > 0)
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `print_fold_marks` integer;
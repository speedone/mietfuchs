PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_letter_texts` (
	`block` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	CONSTRAINT "letter_texts_block_known" CHECK("block" IN ('subject', 'salutation', 'intro', 'credit', 'backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'receipts', 'attachments', 'closing', 'greeting', 'signature', 'paymentPurpose'))
);
--> statement-breakpoint
INSERT INTO `__new_letter_texts`("block", "text") SELECT "block", "text" FROM `letter_texts`;--> statement-breakpoint
DROP TABLE `letter_texts`;--> statement-breakpoint
ALTER TABLE `__new_letter_texts` RENAME TO `letter_texts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_property_letter_texts` (
	`property_id` text NOT NULL,
	`block` text NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`property_id`, `block`),
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "property_letter_texts_block_known" CHECK("block" IN ('subject', 'salutation', 'intro', 'credit', 'backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'receipts', 'attachments', 'closing', 'greeting', 'signature', 'paymentPurpose'))
);
--> statement-breakpoint
INSERT INTO `__new_property_letter_texts`("property_id", "block", "text") SELECT "property_id", "block", "text" FROM `property_letter_texts`;--> statement-breakpoint
DROP TABLE `property_letter_texts`;--> statement-breakpoint
ALTER TABLE `__new_property_letter_texts` RENAME TO `property_letter_texts`;--> statement-breakpoint
CREATE TABLE `__new_tenancy_letter_texts` (
	`tenancy_id` text NOT NULL,
	`doc` text NOT NULL,
	`block` text NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`tenancy_id`, `doc`, `block`),
	FOREIGN KEY (`tenancy_id`) REFERENCES `tenancies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenancy_letter_texts_block_known" CHECK("block" IN ('subject', 'salutation', 'intro', 'credit', 'backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'receipts', 'attachments', 'closing', 'greeting', 'signature', 'paymentPurpose')),
	CONSTRAINT "tenancy_letter_texts_doc_complete" CHECK(length("doc") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_tenancy_letter_texts`("tenancy_id", "doc", "block", "text") SELECT "tenancy_id", "doc", "block", "text" FROM `tenancy_letter_texts`;--> statement-breakpoint
DROP TABLE `tenancy_letter_texts`;--> statement-breakpoint
ALTER TABLE `__new_tenancy_letter_texts` RENAME TO `tenancy_letter_texts`;--> statement-breakpoint
ALTER TABLE `settings` ADD `print_payment_qr` integer;
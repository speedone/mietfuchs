ALTER TABLE `assessment_lines` ADD `labor_guessed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `source` text DEFAULT 'ki' NOT NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `invoice_number` text;--> statement-breakpoint
ALTER TABLE `assessments` ADD `e_invoice_notes` text DEFAULT '[]' NOT NULL;
CREATE INDEX `deposit_entries_tenancy_idx` ON `deposit_entries` (`tenancy_id`);--> statement-breakpoint
CREATE INDEX `deposit_entries_payment_idx` ON `deposit_entries` (`payment_id`);
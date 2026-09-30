PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`iban` text,
	`contract_date` text,
	`deposit_cents` integer,
	`deposit_status` text,
	`notes` text,
	`cost_model` text,
	`heating_model` text,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenancies_persons_not_negative" CHECK("persons" >= 0),
	CONSTRAINT "tenancies_deposit_not_negative" CHECK("deposit_cents" >= 0),
	CONSTRAINT "tenancies_deposit_status_known" CHECK("deposit_status" IN ('offen', 'erhalten', 'teilweise', 'zurückgezahlt')),
	CONSTRAINT "tenancies_cost_model_known" CHECK("cost_model" IN ('settlement', 'flatRate', 'inclusive')),
	CONSTRAINT "tenancies_heating_model_known" CHECK("heating_model" IN ('settlement', 'flatRate', 'inclusive'))
);
--> statement-breakpoint
INSERT INTO `__new_tenancies`("id", "unit_id", "tenant_name", "persons", "start", "end", "email", "phone", "correspondence_address", "iban", "contract_date", "deposit_cents", "deposit_status", "notes", "cost_model", "heating_model") SELECT "id", "unit_id", "tenant_name", "persons", "start", "end", "email", "phone", "correspondence_address", "iban", "contract_date", "deposit_cents", "deposit_status", "notes", "cost_model", "heating_model" FROM `tenancies`;--> statement-breakpoint
DROP TABLE `tenancies`;--> statement-breakpoint
ALTER TABLE `__new_tenancies` RENAME TO `tenancies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
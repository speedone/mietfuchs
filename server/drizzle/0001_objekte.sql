CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`address` text NOT NULL,
	`landlord_name` text,
	`iban` text,
	`payment_deadline_days` integer,
	CONSTRAINT "properties_kind_known" CHECK("kind" IN ('mfh', 'etw', 'efh', 'sonstiges')),
	CONSTRAINT "properties_deadline_not_negative" CHECK("payment_deadline_days" >= 0)
);
--> statement-breakpoint
DROP INDEX `closed_settlements_year_idx`;--> statement-breakpoint
ALTER TABLE `closed_settlements` ADD `property_id` text REFERENCES properties(id);--> statement-breakpoint
CREATE UNIQUE INDEX `closed_settlements_property_year_idx` ON `closed_settlements` (`property_id`,`year`);--> statement-breakpoint
DROP INDEX `cost_items_year_idx`;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `property_id` text REFERENCES properties(id);--> statement-breakpoint
CREATE INDEX `cost_items_property_year_idx` ON `cost_items` (`property_id`,`year`);--> statement-breakpoint
ALTER TABLE `meters` ADD `property_id` text REFERENCES properties(id);--> statement-breakpoint
ALTER TABLE `units` ADD `property_id` text REFERENCES properties(id);--> statement-breakpoint
-- Ab hier von Hand angehängt (#92), siehe „Datenanweisungen“ in README.md: Der Aufbau darüber
-- ist erzeugt; welches Objekt die vorhandenen Zeilen bekommen, kann drizzle-kit nicht wissen.
-- Objekt 1 trägt Name und Adresse des bisherigen Hauses. Ohne Zeile in den Einstellungen, auf
-- einem frischen Rechner die Regel, bleibt beides leer.
INSERT INTO `properties` (`id`, `name`, `kind`, `address`)
  SELECT 'objekt-1',
    COALESCE((SELECT `house_name` FROM `settings` WHERE `id` = 1), ''),
    'mfh',
    COALESCE((SELECT `address` FROM `settings` WHERE `id` = 1), '');--> statement-breakpoint
UPDATE `units` SET `property_id` = 'objekt-1';--> statement-breakpoint
UPDATE `meters` SET `property_id` = 'objekt-1';--> statement-breakpoint
UPDATE `cost_items` SET `property_id` = 'objekt-1';--> statement-breakpoint
UPDATE `closed_settlements` SET `property_id` = 'objekt-1';

CREATE TABLE `period_changes` (
	`property_id` text NOT NULL,
	`from_month` text NOT NULL,
	PRIMARY KEY(`property_id`, `from_month`),
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `assessments` ADD `requested_period` text;--> statement-breakpoint
ALTER TABLE `closed_settlement_history` ADD `period` text;--> statement-breakpoint
ALTER TABLE `closed_settlements` ADD `period` text;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `period` text;--> statement-breakpoint
ALTER TABLE `prepayment_overrides` ADD `period` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `period_start_month` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Ab hier von Hand angehängt (#208), siehe „Datenanweisungen“ in README.md: Der Aufbau darüber
-- ist erzeugt; welchen Zeitraum die vorhandenen Zeilen bekommen, kann drizzle-kit nicht wissen.
-- Jedes vorhandene Jahr ist ein Kalenderjahr, sein Zeitraum beginnt im Januar ('JJJJ-01'). Ein
-- gewähltes Jahr einer Auswertung ohne Objekt entfällt: Ein Zeitraum ist nur am Objekt bestimmt
-- (Prüfbedingung in 0015, G-B7).
UPDATE `cost_items` SET `period` = printf('%04d-01', `year`);--> statement-breakpoint
UPDATE `closed_settlements` SET `period` = printf('%04d-01', `year`);--> statement-breakpoint
UPDATE `closed_settlement_history` SET `period` = printf('%04d-01', `year`);--> statement-breakpoint
UPDATE `prepayment_overrides` SET `period` = printf('%04d-01', `year`);--> statement-breakpoint
UPDATE `assessments` SET `requested_period` = printf('%04d-01', `requested_year`) WHERE `requested_year` IS NOT NULL AND `property_id` IS NOT NULL;

ALTER TABLE `properties` ADD `landlord_address` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `landlord_contact` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `print_letter` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `print_letter` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `print_footer` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `landlord_address` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `landlord_contact` text;--> statement-breakpoint
ALTER TABLE `tenancies` ADD `letter_salutation` text;--> statement-breakpoint
-- Ab hier von Hand angehängt (Integrationsdurchsicht zu #415), siehe „Datenanweisungen“ in README.md: Der Schlüssel
-- der Anschreiben je Mieter nennt jetzt das Objekt, „<Objekt>:<Zeitraum>“; der Schlüssel einer getrennten
-- Heizkostenabrechnung („heating:<Anlage>:<Heizperiode>“) bleibt.
UPDATE `tenancy_letter_texts` SET `doc` = (SELECT `u`.`property_id` FROM `tenancies` `t` JOIN `units` `u` ON `u`.`id` = `t`.`unit_id` WHERE `t`.`id` = `tenancy_letter_texts`.`tenancy_id`) || ':' || `doc` WHERE `doc` NOT LIKE '%:%';--> statement-breakpoint
UPDATE `tenancy_letter_adjustments` SET `doc` = (SELECT `u`.`property_id` FROM `tenancies` `t` JOIN `units` `u` ON `u`.`id` = `t`.`unit_id` WHERE `t`.`id` = `tenancy_letter_adjustments`.`tenancy_id`) || ':' || `doc` WHERE `doc` NOT LIKE '%:%';
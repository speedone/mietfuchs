ALTER TABLE `cost_items` ADD `operating_power_general_id` text REFERENCES cost_items(id);--> statement-breakpoint
-- Ab hier von Hand angehängt (Durchsicht von #252, G-K3), siehe „Datenanweisungen“ in README.md: Der
-- Aufbau darüber ist erzeugt. Ein Abzug aus 0037/0038 kennt seine Stromrechnung nicht; er bekommt die
-- Allgemeinstrom-Position seines Objekts und Zeitraums mit dem größten Betrag, denn aus ihr hat ihn die
-- Schätzhilfe gerechnet, wenn es nur eine gab. Gibt es keine, verliert er seine Kennzeichnung und bleibt
-- als gewöhnliche Gutschrift stehen; der Betrag ändert sich in keinem Fall.
UPDATE `cost_items` SET `operating_power_general_id` = (
  SELECT g.`id` FROM `cost_items` AS g
  WHERE g.`property_id` = `cost_items`.`property_id` AND g.`period` = `cost_items`.`period`
    AND g.`category` = 'Beleuchtung/Allgemeinstrom' AND g.`amount_cents` > 0 AND g.`operating_power` IS NULL
  ORDER BY g.`amount_cents` DESC, g.`rowid` LIMIT 1
) WHERE `operating_power` = 'deduction';--> statement-breakpoint
UPDATE `cost_items` SET `operating_power` = NULL, `operating_power_item_id` = NULL, `operating_power_basis` = NULL
  WHERE `operating_power` = 'deduction' AND `operating_power_general_id` IS NULL;

ALTER TABLE `cost_items` ADD `room_split` text;--> statement-breakpoint
ALTER TABLE `units` ADD `parent_unit_id` text REFERENCES units(id);
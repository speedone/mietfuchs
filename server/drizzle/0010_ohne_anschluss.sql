CREATE TABLE `unit_no_connection` (
	`unit_id` text NOT NULL,
	`meter_type` text NOT NULL,
	PRIMARY KEY(`unit_id`, `meter_type`),
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "unit_no_connection_meter_type_known" CHECK("meter_type" IN ('kaltwasser', 'strom', 'waerme', 'sonstig'))
);

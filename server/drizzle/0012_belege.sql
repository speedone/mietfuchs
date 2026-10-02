CREATE TABLE `uploads` (
	`file` text PRIMARY KEY NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`property_id` text,
	`year` integer,
	`invoice_date` text,
	`kind` text DEFAULT 'receipt' NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "uploads_size_not_negative" CHECK("size_bytes" >= 0),
	CONSTRAINT "uploads_kind_known" CHECK("kind" IN ('receipt', 'meterPhoto')),
	CONSTRAINT "uploads_year_positive" CHECK("year" > 0)
);

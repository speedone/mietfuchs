CREATE TABLE `law_overrides` (
	`param_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`value_json` text NOT NULL,
	`source` text NOT NULL,
	`entered_at` text NOT NULL,
	PRIMARY KEY(`param_id`, `valid_from`),
	CONSTRAINT "law_overrides_valid_from_valid" CHECK("valid_from" GLOB '[0-9][0-9][0-9][0-9]-01-01'),
	CONSTRAINT "law_overrides_source_complete" CHECK(length(trim("source")) > 0),
	CONSTRAINT "law_overrides_value_is_json" CHECK(json_valid("value_json"))
);

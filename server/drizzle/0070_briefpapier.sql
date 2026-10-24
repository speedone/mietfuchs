CREATE TABLE `letter_design` (
	`id` integer PRIMARY KEY NOT NULL,
	`logo_file` text,
	`paper_file` text,
	`paper_next` text NOT NULL,
	`paper_next_file` text,
	`margin_top` integer NOT NULL,
	`margin_right` integer NOT NULL,
	`margin_bottom` integer NOT NULL,
	`margin_left` integer NOT NULL,
	CONSTRAINT "letter_design_id_valid" CHECK("letter_design"."id" = 1),
	CONSTRAINT "letter_design_paper_next_known" CHECK("paper_next" IN ('same', 'other', 'none')),
	CONSTRAINT "letter_design_paper_next_file_valid" CHECK("paper_next_file" IS NULL OR "paper_next" = 'other'),
	CONSTRAINT "letter_design_margins_valid" CHECK(typeof("margin_top") = 'integer' AND "margin_top" BETWEEN 10 AND 70 AND typeof("margin_right") = 'integer' AND "margin_right" BETWEEN 10 AND 40 AND typeof("margin_bottom") = 'integer' AND "margin_bottom" BETWEEN 10 AND 60 AND typeof("margin_left") = 'integer' AND "margin_left" BETWEEN 15 AND 40)
);
--> statement-breakpoint
CREATE TABLE `property_letter_designs` (
	`property_id` text PRIMARY KEY NOT NULL,
	`logo_file` text,
	`paper_file` text,
	`paper_next` text NOT NULL,
	`paper_next_file` text,
	`margin_top` integer NOT NULL,
	`margin_right` integer NOT NULL,
	`margin_bottom` integer NOT NULL,
	`margin_left` integer NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "property_letter_designs_paper_next_known" CHECK("paper_next" IN ('same', 'other', 'none')),
	CONSTRAINT "property_letter_designs_paper_next_file_valid" CHECK("paper_next_file" IS NULL OR "paper_next" = 'other'),
	CONSTRAINT "property_letter_designs_margins_valid" CHECK(typeof("margin_top") = 'integer' AND "margin_top" BETWEEN 10 AND 70 AND typeof("margin_right") = 'integer' AND "margin_right" BETWEEN 10 AND 40 AND typeof("margin_bottom") = 'integer' AND "margin_bottom" BETWEEN 10 AND 60 AND typeof("margin_left") = 'integer' AND "margin_left" BETWEEN 15 AND 40)
);

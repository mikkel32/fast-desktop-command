CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`redirects` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`client` text NOT NULL,
	`redirect` text NOT NULL,
	`challenge` text NOT NULL,
	`resource` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`params` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`user_code` text NOT NULL,
	`expires` integer NOT NULL,
	`paired` integer,
	`seen` integer,
	`revoked` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_code_hash_unique` ON `devices` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_user_code_unique` ON `devices` (`user_code`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`device` text NOT NULL,
	`owner` text NOT NULL,
	`session` text NOT NULL,
	`dedupe` text NOT NULL,
	`request` text NOT NULL,
	`state` text NOT NULL,
	`lease` text,
	`result` text,
	`created` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_unique` ON `jobs` (`dedupe`);--> statement-breakpoint
CREATE INDEX `jobs_device_state` ON `jobs` (`device`,`state`);--> statement-breakpoint
CREATE INDEX `jobs_expiry` ON `jobs` (`expires`);--> statement-breakpoint
CREATE TABLE `mcp_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`client` text NOT NULL,
	`resource` text NOT NULL,
	`kind` text NOT NULL,
	`expires` integer NOT NULL
);

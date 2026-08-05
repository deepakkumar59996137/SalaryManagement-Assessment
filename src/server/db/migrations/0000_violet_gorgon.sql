CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`entity` text NOT NULL,
	`entity_id` integer NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`summary` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `compensations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`base_salary_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`annual_base_usd_minor` integer NOT NULL,
	`change_reason` text NOT NULL,
	`note` text,
	`changed_by_user_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `compensations_employee_from_idx` ON `compensations` (`employee_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `compensations_effective_from_idx` ON `compensations` (`effective_from`);--> statement-breakpoint
CREATE UNIQUE INDEX `compensations_one_open_per_employee_idx` ON `compensations` (`employee_id`) WHERE effective_to is null;--> statement-breakpoint
CREATE TABLE `countries` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_name_unique` ON `departments` (`name`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_code` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`department_id` integer NOT NULL,
	`job_level_id` integer NOT NULL,
	`job_title` text NOT NULL,
	`country_code` text NOT NULL,
	`currency` text NOT NULL,
	`manager_id` integer,
	`hire_date` text NOT NULL,
	`employment_type` text NOT NULL,
	`gender` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`current_compensation_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_level_id`) REFERENCES `job_levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`country_code`) REFERENCES `countries`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`manager_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_employee_code_unique` ON `employees` (`employee_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `employees_email_unique` ON `employees` (`email`);--> statement-breakpoint
CREATE INDEX `employees_department_idx` ON `employees` (`department_id`);--> statement-breakpoint
CREATE INDEX `employees_country_idx` ON `employees` (`country_code`);--> statement-breakpoint
CREATE INDEX `employees_level_idx` ON `employees` (`job_level_id`);--> statement-breakpoint
CREATE INDEX `employees_status_idx` ON `employees` (`status`);--> statement-breakpoint
CREATE INDEX `employees_last_name_idx` ON `employees` (`last_name`);--> statement-breakpoint
CREATE INDEX `employees_manager_idx` ON `employees` (`manager_id`);--> statement-breakpoint
CREATE INDEX `employees_current_comp_idx` ON `employees` (`current_compensation_id`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`currency` text PRIMARY KEY NOT NULL,
	`rate_to_usd` real NOT NULL,
	`as_of` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_levels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`rank` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_levels_code_unique` ON `job_levels` (`code`);--> statement-breakpoint
CREATE TABLE `salary_bands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_level_id` integer NOT NULL,
	`country_code` text NOT NULL,
	`currency` text NOT NULL,
	`min_minor` integer NOT NULL,
	`mid_minor` integer NOT NULL,
	`max_minor` integer NOT NULL,
	FOREIGN KEY (`job_level_id`) REFERENCES `job_levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`country_code`) REFERENCES `countries`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salary_bands_level_country_idx` ON `salary_bands` (`job_level_id`,`country_code`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'HR_MANAGER' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
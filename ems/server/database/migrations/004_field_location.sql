-- 004_field_location.sql
-- Add field_location to track deployment location/site for field workers

ALTER TABLE employees ADD COLUMN field_location TEXT;
ALTER TABLE employee_field_status_history ADD COLUMN field_location TEXT;

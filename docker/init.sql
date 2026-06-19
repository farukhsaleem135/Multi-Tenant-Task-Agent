-- Create app_user: a non-superuser role so that RLS is enforced for all its queries.
-- The postgres superuser used for migrations bypasses RLS by design;
-- application queries MUST always go through app_user.
CREATE ROLE app_user WITH LOGIN PASSWORD 'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Allow app_user to connect and use the public schema
GRANT CONNECT ON DATABASE agent_db TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- Future tables created by postgres (during migrations) are automatically accessible to app_user
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

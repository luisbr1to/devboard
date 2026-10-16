-- What a key may do: only publish new suites, or also read and edit the project's suites and tests.
ALTER TABLE integration_keys ADD COLUMN scope text NOT NULL DEFAULT 'publish' CHECK (scope IN ('publish', 'manage'));

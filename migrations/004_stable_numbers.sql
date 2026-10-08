-- Stable, human-friendly identifiers: SU-n per project and TC-n per suite.
-- Existing rows keep the numbers the interface already showed (creation order / position).
ALTER TABLE suites ADD COLUMN number integer;
ALTER TABLE tests ADD COLUMN number integer;

UPDATE suites s SET number = ordered.n
FROM (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS n
  FROM suites
) ordered
WHERE s.id = ordered.id;

UPDATE tests t SET number = ordered.n
FROM (
  SELECT id, row_number() OVER (PARTITION BY suite_id ORDER BY position, created_at, id) AS n
  FROM tests
) ordered
WHERE t.id = ordered.id;

ALTER TABLE suites ALTER COLUMN number SET NOT NULL;
ALTER TABLE tests ALTER COLUMN number SET NOT NULL;
CREATE UNIQUE INDEX suites_project_number ON suites(project_id, number);
CREATE UNIQUE INDEX tests_suite_number ON tests(suite_id, number);

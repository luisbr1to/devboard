-- Files attached to comments and rejection reasons, stored in PostgreSQL (max 10 MB each).
CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  suite_id uuid NOT NULL REFERENCES suites(id),
  test_id uuid REFERENCES tests(id),
  activity_id uuid REFERENCES activities(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  file_name text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL CHECK (size > 0 AND size <= 10485760),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX attachments_activity ON attachments(activity_id);
CREATE INDEX attachments_pending ON attachments(uploaded_by) WHERE activity_id IS NULL;

CREATE TABLE project_activities (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  actor_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('project_archived', 'project_restored')),
  body text NOT NULL DEFAULT '',
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX activity_project ON project_activities(project_id, created_at, id);

-- Preserve transaction order for new timeline entries, including bulk creation.
ALTER TABLE activities ALTER COLUMN created_at SET DEFAULT clock_timestamp();

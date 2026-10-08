-- Development area: per-project issues with configurable statuses, modules and labels.
-- Colours are palette names resolved to theme tokens by the client.
CREATE TABLE issue_statuses (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  color text NOT NULL DEFAULT 'gray',
  category text NOT NULL CHECK (category IN ('todo', 'doing', 'done')),
  position integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX issue_statuses_name ON issue_statuses(project_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX issue_statuses_project ON issue_statuses(project_id, position) WHERE deleted_at IS NULL;

CREATE TABLE issue_modules (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  color text NOT NULL DEFAULT 'gray',
  position integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX issue_modules_name ON issue_modules(project_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE issue_labels (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  color text NOT NULL DEFAULT 'gray',
  position integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX issue_labels_name ON issue_labels(project_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE issues (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  number integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status_id uuid NOT NULL REFERENCES issue_statuses(id),
  priority smallint CHECK (priority BETWEEN 1 AND 5),
  estimate numeric(7, 2) CHECK (estimate >= 0),
  reported_at timestamptz NOT NULL DEFAULT now(),
  deployed_at date,
  reporter_id uuid NOT NULL REFERENCES users(id),
  reporter_note text,
  external_ref text,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX issues_project_number ON issues(project_id, number);
CREATE INDEX issues_board ON issues(project_id, status_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX issues_external_ref ON issues(project_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE issue_assignees (
  issue_id uuid NOT NULL REFERENCES issues(id),
  user_id uuid NOT NULL REFERENCES users(id),
  assigned_by uuid REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX issue_assignees_user ON issue_assignees(user_id);
CREATE TABLE issue_module_links (
  issue_id uuid NOT NULL REFERENCES issues(id),
  module_id uuid NOT NULL REFERENCES issue_modules(id),
  PRIMARY KEY (issue_id, module_id)
);
CREATE TABLE issue_label_links (
  issue_id uuid NOT NULL REFERENCES issues(id),
  label_id uuid NOT NULL REFERENCES issue_labels(id),
  PRIMARY KEY (issue_id, label_id)
);

-- Spreadsheet imports are retry-safe per project and key.
CREATE TABLE issue_imports (
  project_id uuid NOT NULL REFERENCES projects(id),
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  imported_by uuid NOT NULL REFERENCES users(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, idempotency_key)
);

-- Activity and attachments belong to exactly one suite or one issue.
ALTER TABLE activities ALTER COLUMN suite_id DROP NOT NULL;
ALTER TABLE activities ADD COLUMN issue_id uuid REFERENCES issues(id);
ALTER TABLE activities ADD CONSTRAINT activities_target CHECK ((suite_id IS NULL) <> (issue_id IS NULL));
CREATE INDEX activity_issue ON activities(issue_id, created_at, id) WHERE issue_id IS NOT NULL;
ALTER TABLE attachments ALTER COLUMN suite_id DROP NOT NULL;
ALTER TABLE attachments ADD COLUMN issue_id uuid REFERENCES issues(id);
ALTER TABLE attachments ADD CONSTRAINT attachments_target CHECK ((suite_id IS NULL) <> (issue_id IS NULL));

ALTER TABLE notifications ADD COLUMN issue_id uuid REFERENCES issues(id);
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'result', 'comment', 'mention', 'assignment', 'suite_created', 'test_added',
  'suite_archived', 'suite_restored', 'suite_edited', 'test_edited',
  'test_deleted', 'suite_deleted',
  'issue_assignment', 'issue_comment', 'issue_mention', 'issue_status', 'issue_deleted'
));

-- Per-user interface preferences (e.g. visible issue table columns).
CREATE TABLE user_preferences (
  user_id uuid NOT NULL REFERENCES users(id),
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Default workflow for every existing project; new projects get it from the API.
INSERT INTO issue_statuses(id, project_id, name, color, category, position)
SELECT gen_random_uuid(), p.id, s.name, s.color, s.category, s.position
FROM projects p
CROSS JOIN (VALUES
  ('Backlog', 'gray', 'todo', 0),
  ('Em análise', 'purple', 'todo', 1),
  ('A aguardar informação', 'amber', 'todo', 2),
  ('Em curso', 'blue', 'doing', 3),
  ('Para testar', 'teal', 'doing', 4),
  ('Resolvido', 'green', 'done', 5),
  ('Fechado', 'gray', 'done', 6),
  ('Duplicado', 'gray', 'done', 7)
) AS s(name, color, category, position);

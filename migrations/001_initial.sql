CREATE TABLE users (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, oid uuid NOT NULL, name text NOT NULL, email text NOT NULL,
  UNIQUE (tenant_id, oid)
);
CREATE TABLE projects (
  id uuid PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz, archived_by uuid REFERENCES users(id), version integer NOT NULL DEFAULT 1
);
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id), user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner', 'member')), PRIMARY KEY (project_id, user_id)
);
CREATE TABLE suites (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), title text NOT NULL, description text NOT NULL DEFAULT '',
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz, archived_by uuid REFERENCES users(id), provenance jsonb, version integer NOT NULL DEFAULT 1
);
CREATE INDEX suites_project ON suites(project_id, created_at DESC);
CREATE TABLE tests (
  id uuid PRIMARY KEY, suite_id uuid NOT NULL REFERENCES suites(id), title text NOT NULL,
  instructions text NOT NULL DEFAULT '', expected_result text NOT NULL DEFAULT '', assignee_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revoked')),
  position integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE INDEX tests_suite ON tests(suite_id, position);
CREATE TABLE activities (
  id uuid PRIMARY KEY, suite_id uuid NOT NULL REFERENCES suites(id), test_id uuid REFERENCES tests(id),
  actor_id uuid REFERENCES users(id), actor_name text NOT NULL, kind text NOT NULL, body text NOT NULL DEFAULT '', detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_suite ON activities(suite_id, created_at, id);
CREATE TABLE integration_keys (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), name text NOT NULL, secret_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE import_requests (
  integration_key_id uuid NOT NULL REFERENCES integration_keys(id), idempotency_key text NOT NULL, payload_hash text NOT NULL,
  suite_id uuid NOT NULL REFERENCES suites(id), PRIMARY KEY (integration_key_id, idempotency_key)
);

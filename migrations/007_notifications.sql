-- In-app notification centre. Rows are written in the same transaction as the activity.
CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  suite_id uuid REFERENCES suites(id),
  test_id uuid REFERENCES tests(id),
  activity_id uuid REFERENCES activities(id),
  kind text NOT NULL CHECK (kind IN (
    'result', 'comment', 'mention', 'assignment', 'suite_created', 'test_added',
    'suite_archived', 'suite_restored'
  )),
  actor_name text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

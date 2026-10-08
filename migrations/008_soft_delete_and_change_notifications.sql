-- Logical deletion of suites and tests: hidden everywhere, data and history preserved.
ALTER TABLE suites ADD COLUMN deleted_at timestamptz;
ALTER TABLE suites ADD COLUMN deleted_by uuid REFERENCES users(id);
ALTER TABLE tests ADD COLUMN deleted_at timestamptz;
ALTER TABLE tests ADD COLUMN deleted_by uuid REFERENCES users(id);
CREATE INDEX suites_visible ON suites(project_id) WHERE deleted_at IS NULL;
CREATE INDEX tests_visible ON tests(suite_id, position) WHERE deleted_at IS NULL;

-- Notifications about edits and deletions of suites and tests.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'result', 'comment', 'mention', 'assignment', 'suite_created', 'test_added',
  'suite_archived', 'suite_restored', 'suite_edited', 'test_edited',
  'test_deleted', 'suite_deleted'
));

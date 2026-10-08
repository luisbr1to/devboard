-- Read-only members ("viewer") and temporary access blocks, managed by owners.
ALTER TABLE project_members DROP CONSTRAINT project_members_role_check;
ALTER TABLE project_members ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('owner', 'member', 'viewer'));
-- A block is active while blocked_at is set and blocked_until is empty or in the future.
ALTER TABLE project_members ADD COLUMN blocked_at timestamptz;
ALTER TABLE project_members ADD COLUMN blocked_until timestamptz;
ALTER TABLE project_members ADD COLUMN blocked_by uuid REFERENCES users(id);

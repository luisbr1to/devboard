-- Application administrators create projects and act as owners in every project.
-- The first-run setup records exactly one master, who can never be removed.
-- Removals keep the row for audit; a person can be made administrator again later.
CREATE TABLE app_admins (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  master boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  removed_at timestamptz,
  removed_by uuid REFERENCES users(id),
  CHECK (NOT (master AND removed_at IS NOT NULL))
);
CREATE UNIQUE INDEX app_admins_active ON app_admins(user_id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX app_admins_master ON app_admins(master) WHERE master;

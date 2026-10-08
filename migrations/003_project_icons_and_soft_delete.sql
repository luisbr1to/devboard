ALTER TABLE projects ADD COLUMN icon_data_url text;
ALTER TABLE projects ADD COLUMN deleted_at timestamptz;
ALTER TABLE projects ADD COLUMN deleted_by uuid REFERENCES users(id);

CREATE INDEX projects_active_membership ON projects(id) WHERE deleted_at IS NULL;

-- Drafts are also personal tasks: «Por fazer», «Em curso» and «Concluído», with checkable steps.
ALTER TABLE issue_drafts DROP CONSTRAINT issue_drafts_state_check;
UPDATE issue_drafts SET state='todo' WHERE state='review';
UPDATE issue_drafts SET state='doing' WHERE state='ready';
ALTER TABLE issue_drafts ADD CONSTRAINT issue_drafts_state_check CHECK (state IN ('todo', 'doing', 'done', 'created', 'discarded'));
ALTER TABLE issue_drafts ALTER COLUMN state SET DEFAULT 'todo';
ALTER TABLE issue_drafts ADD COLUMN steps jsonb NOT NULL DEFAULT '[]';

-- Description templates owners add to a project, besides the built-in feature and bug ones.
CREATE TABLE issue_templates (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  body text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX issue_templates_name ON issue_templates(project_id, lower(name)) WHERE deleted_at IS NULL;

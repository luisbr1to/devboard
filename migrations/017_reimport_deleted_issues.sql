-- Deleted issues are permanent, so their external reference no longer blocks a new import.
DROP INDEX issues_external_ref;
CREATE UNIQUE INDEX issues_external_ref ON issues(project_id, external_ref) WHERE external_ref IS NOT NULL AND deleted_at IS NULL;

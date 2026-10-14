-- Chosen when a project is created: deleted issues are kept (soft delete) or removed for good.
ALTER TABLE projects ADD COLUMN issue_soft_delete boolean NOT NULL DEFAULT true;

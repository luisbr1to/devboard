-- GitLab-style discussions: a comment can open a thread that members reply to and resolve.
ALTER TABLE activities ADD COLUMN discussion boolean NOT NULL DEFAULT false;
ALTER TABLE activities ADD COLUMN reply_to uuid REFERENCES activities(id);
ALTER TABLE activities ADD COLUMN resolved_at timestamptz;
ALTER TABLE activities ADD COLUMN resolved_by uuid REFERENCES users(id);
ALTER TABLE activities ADD COLUMN resolved_by_name text;
ALTER TABLE activities ADD CONSTRAINT activities_discussion CHECK (
  (NOT discussion OR (kind = 'comment' AND reply_to IS NULL))
  AND (reply_to IS NULL OR kind = 'comment')
  AND (resolved_at IS NULL OR discussion)
);
CREATE INDEX activity_replies ON activities(reply_to) WHERE reply_to IS NOT NULL;

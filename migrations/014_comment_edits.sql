-- Authors can edit their comments; edited_at marks the comment as edited.
ALTER TABLE activities ADD COLUMN edited_at timestamptz;

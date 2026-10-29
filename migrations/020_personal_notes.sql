-- Personal notes (folders, tags, Markdown) and issue drafts, private to their author and outside projects.
CREATE TABLE note_folders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  parent_id uuid REFERENCES note_folders(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX note_folders_name ON note_folders(user_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Deleted notes stay in the author's recycle bin until restored or removed for good.
CREATE TABLE notes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  folder_id uuid REFERENCES note_folders(id),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX notes_user ON notes(user_id, updated_at DESC);
CREATE INDEX notes_tags ON notes USING gin(tags);

-- A draft becomes an issue once; the issue is gone only if its project deletes issues permanently.
CREATE TABLE issue_drafts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  note_id uuid REFERENCES notes(id) ON DELETE SET NULL,
  source_text text,
  project_id uuid REFERENCES projects(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority smallint CHECK (priority BETWEEN 1 AND 5),
  state text NOT NULL DEFAULT 'review' CHECK (state IN ('review', 'ready', 'created', 'discarded')),
  position integer NOT NULL DEFAULT 0,
  issue_id uuid REFERENCES issues(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (issue_id IS NULL OR state = 'created')
);
CREATE INDEX issue_drafts_board ON issue_drafts(user_id, state, position);
CREATE INDEX issue_drafts_note ON issue_drafts(note_id) WHERE note_id IS NOT NULL;

-- Files of a note or a draft (max 10 MB each); copied to the issue when a draft is converted.
CREATE TABLE personal_attachments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  note_id uuid REFERENCES notes(id) ON DELETE CASCADE,
  draft_id uuid REFERENCES issue_drafts(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL CHECK (size > 0 AND size <= 10485760),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((note_id IS NULL) <> (draft_id IS NULL))
);
CREATE INDEX personal_attachments_note ON personal_attachments(note_id) WHERE note_id IS NOT NULL;
CREATE INDEX personal_attachments_draft ON personal_attachments(draft_id) WHERE draft_id IS NOT NULL;

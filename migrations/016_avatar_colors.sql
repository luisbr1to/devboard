-- Each person can pick the background of their initials avatar, shown to everyone.
ALTER TABLE users ADD COLUMN avatar_color text CHECK (avatar_color ~ '^#[0-9a-f]{6}$');

-- Optional test priority, on the same 1 (Crítica) to 5 (Mínima) scale as issues.
ALTER TABLE tests ADD COLUMN priority smallint CHECK (priority BETWEEN 1 AND 5);

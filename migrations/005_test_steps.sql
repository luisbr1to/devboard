-- Structured steps with a result shared by the whole team.
CREATE TABLE test_steps (
  id uuid PRIMARY KEY,
  test_id uuid NOT NULL REFERENCES tests(id),
  position integer NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed')),
  updated_by uuid REFERENCES users(id),
  updated_by_name text,
  updated_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX test_steps_test ON test_steps(test_id, position);

-- Original instructions of tests whose list was converted into steps (kept for safety).
ALTER TABLE tests ADD COLUMN legacy_instructions text;

-- Convert the first Markdown list of existing instructions into steps.
-- Mirrors parseSteps in src/shared/steps.ts.
DO $$
DECLARE
  item constant text := '^( *)(?:\d{1,3}[.)]|[-*+])\s+(?:\[[ xX]\]\s+)?(.*)$';
  heading constant text := '^#{1,6}\s+(passos|instruções|instrucoes|steps)\s*:?\s*$';
  t record;
  lines text[];
  line text;
  next_line text;
  m text[];
  steps text[];
  before_lines text[];
  n integer;
  i integer;
  j integer;
  start_at integer;
  end_at integer;
  base_indent integer;
  line_indent integer;
  next_indent integer;
  fenced boolean;
  before_text text;
  after_text text;
  step_body text;
  step_position integer;
BEGIN
  FOR t IN SELECT id, instructions FROM tests ORDER BY id LOOP
    lines := regexp_split_to_array(t.instructions, E'\r?\n');
    n := coalesce(array_length(lines, 1), 0);
    fenced := false;
    start_at := 0;
    end_at := n + 1;
    steps := ARRAY[]::text[];
    i := 1;
    WHILE i <= n LOOP
      line := lines[i];
      IF start_at = 0 THEN
        IF line ~ '^\s*(```|~~~)' THEN
          fenced := NOT fenced;
        ELSIF NOT fenced THEN
          m := regexp_match(line, item);
          IF m IS NOT NULL AND length(m[1]) <= 3 THEN
            start_at := i;
            base_indent := length(m[1]);
            steps := array_append(steps, m[2]);
          END IF;
        END IF;
      ELSE
        line_indent := length(line) - length(ltrim(line));
        IF btrim(line) = '' THEN
          next_line := NULL;
          FOR j IN i + 1 .. n LOOP
            IF btrim(lines[j]) <> '' THEN
              next_line := lines[j];
              EXIT;
            END IF;
          END LOOP;
          next_indent := CASE WHEN next_line IS NULL THEN 0
            ELSE length(next_line) - length(ltrim(next_line)) END;
          IF next_line IS NOT NULL AND (next_indent > base_indent OR next_line ~ item) THEN
            steps[array_length(steps, 1)] := steps[array_length(steps, 1)] || E'\n';
          ELSE
            end_at := i;
            EXIT;
          END IF;
        ELSE
          m := regexp_match(line, item);
          IF m IS NOT NULL AND line_indent <= base_indent THEN
            steps := array_append(steps, m[2]);
          ELSIF line_indent > base_indent THEN
            steps[array_length(steps, 1)] := steps[array_length(steps, 1)] || E'\n'
              || substr(line, least(line_indent, base_indent + 3) + 1);
          ELSE
            end_at := i;
            EXIT;
          END IF;
        END IF;
      END IF;
      i := i + 1;
    END LOOP;

    CONTINUE WHEN start_at = 0;

    before_lines := coalesce(lines[1 : start_at - 1], ARRAY[]::text[]);
    WHILE coalesce(array_length(before_lines, 1), 0) > 0
      AND btrim(before_lines[array_length(before_lines, 1)]) = '' LOOP
      before_lines := before_lines[1 : array_length(before_lines, 1) - 1];
    END LOOP;
    IF coalesce(array_length(before_lines, 1), 0) > 0
      AND lower(btrim(before_lines[array_length(before_lines, 1)])) ~ heading THEN
      before_lines := before_lines[1 : array_length(before_lines, 1) - 1];
    END IF;
    before_text := btrim(array_to_string(before_lines, E'\n'), E' \n\r\t');
    after_text := btrim(array_to_string(coalesce(lines[end_at : n], ARRAY[]::text[]), E'\n'), E' \n\r\t');

    step_position := 0;
    FOREACH step_body IN ARRAY steps LOOP
      step_body := btrim(step_body, E' \n\r\t');
      CONTINUE WHEN step_body = '';
      INSERT INTO test_steps(id, test_id, position, body)
      VALUES (gen_random_uuid(), t.id, step_position, step_body);
      step_position := step_position + 1;
    END LOOP;

    UPDATE tests SET
      legacy_instructions = instructions,
      instructions = concat_ws(E'\n\n', nullif(before_text, ''), nullif(after_text, ''))
    WHERE id = t.id;
  END LOOP;
END $$;

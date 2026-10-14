-- Tests are categorized with the project's modules (the same ones issues use).
CREATE TABLE test_module_links (
  test_id uuid NOT NULL REFERENCES tests(id),
  module_id uuid NOT NULL REFERENCES issue_modules(id),
  PRIMARY KEY (test_id, module_id)
);
CREATE INDEX test_module_links_module ON test_module_links(module_id);

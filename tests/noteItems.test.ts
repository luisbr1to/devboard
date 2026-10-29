import { test } from "node:test";
import assert from "node:assert/strict";
import { noteItems, sourceKey } from "../src/Tab/noteItems";

const daily = `# Daily 26/10

Ontem fechei o **login**.

## Ações

- [ ] Corrigir o *checkout* no Safari
  - acontece só no iOS 18
  - ver [registo](https://example.test/log)
- [x] Falar com [@ id="11111111-1111-4111-8111-111111111111" label="Ana Silva"]
- Rever \`pagamentos\`

Notas soltas.

1. Atualizar a documentação
2. Preparar a demo

   Com dados de teste.
3.
`;

test("note items: top-level list items, with nested lines as description", () => {
  assert.deepEqual(
    noteItems(daily).map(({ title, done }) => [title, done]),
    [
      ["Corrigir o checkout no Safari", false],
      ["Falar com @Ana Silva", true],
      ["Rever pagamentos", false],
      ["Atualizar a documentação", false],
      ["Preparar a demo", false],
    ],
  );
  const [first, , , , demo] = noteItems(daily);
  assert.equal(
    first.description,
    "- acontece só no iOS 18\n- ver [registo](https://example.test/log)",
  );
  assert.equal(demo.description, "Com dados de teste.");
  assert.equal(first.sourceText, "corrigir o checkout no safari");
  assert.equal(sourceKey("Corrigir o *checkout* no Safari"), first.sourceText);
});
test("note items: notes without lists offer nothing", () => {
  assert.deepEqual(noteItems("# Reunião\n\nSem ações."), []);
  assert.deepEqual(noteItems(""), []);
});

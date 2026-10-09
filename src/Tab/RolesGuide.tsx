import { useState } from "react";
import {
  CheckIcon,
  InformationCircleIcon,
  MinusIcon,
} from "@heroicons/react/24/outline";
import { Button, Modal } from "./components";

// Mirrors the server rules (projectScope, owner-only routes, app_admins); keep in sync.
type Access = boolean | string;
const roles = ["Leitor", "Membro", "Proprietário", "Administrador"] as const;
const rows: { action: string; access: [Access, Access, Access, Access] }[] = [
  { action: "Ver suites, testes e issues", access: [true, true, true, true] },
  {
    action: "Criar e editar suites, testes e issues",
    access: [false, true, true, true],
  },
  {
    action: "Registar resultados, comentar e mencionar",
    access: [false, true, true, true],
  },
  {
    action: "Ser responsável e receber notificações",
    access: [false, true, true, false],
  },
  {
    action: "Apagar suites, testes e issues",
    access: [false, "Só os seus", true, true],
  },
  {
    action: "Arquivar, restaurar e ações em lote",
    access: [false, false, true, true],
  },
  {
    action: "Gerir membros, papéis e bloqueios",
    access: [false, false, true, true],
  },
  {
    action: "Configurar estados, módulos e labels; importar issues",
    access: [false, false, true, true],
  },
  {
    action: "Chaves de publicação por IA",
    access: [false, false, true, true],
  },
  {
    action: "Editar e apagar o projeto",
    access: [false, false, true, true],
  },
  {
    action: "Criar projetos e gerir administradores",
    access: [false, false, false, true],
  },
];

function Cell({ access }: { access: Access }) {
  if (typeof access === "string")
    return <span className="roles-partial">{access}</span>;
  return access ? (
    <span className="roles-yes">
      <CheckIcon aria-hidden />
      <span className="visually-hidden">Sim</span>
    </span>
  ) : (
    <span className="roles-no">
      <MinusIcon aria-hidden />
      <span className="visually-hidden">Não</span>
    </span>
  );
}

export function RolesGuide() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="roles-guide-button"
        icon={<InformationCircleIcon />}
        onClick={() => setOpen(true)}
      >
        Papéis e permissões
      </Button>
      {open && (
        <Modal
          title="Papéis e permissões"
          variant="modal"
          onClose={() => setOpen(false)}
        >
          <p className="muted">
            Leitor, Membro e Proprietário são papéis de cada projeto. O
            Administrador é da aplicação: age como proprietário em todos os
            projetos sem ser membro, por isso não recebe notificações nem pode
            ser responsável, a não ser que também seja adicionado ao projeto.
          </p>
          <div className="table-scroll">
            <table className="data-table roles-table">
              <thead>
                <tr>
                  <th scope="col">Permissão</th>
                  {roles.map((role) => (
                    <th scope="col" key={role}>
                      {role}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.action}>
                    <th scope="row">{row.action}</th>
                    {row.access.map((access, index) => (
                      <td key={roles[index]}>
                        <Cell access={access} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="roles-note">
            «Só os seus»: um membro apaga os testes de que é responsável e os
            issues que reportou.
          </p>
        </Modal>
      )}
    </>
  );
}

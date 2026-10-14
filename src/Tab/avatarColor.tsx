import { useEffect, useRef, useState } from "react";
import {
  Popover,
  PopoverSurface,
  PopoverTrigger,
} from "@fluentui/react-components";
import { CheckIcon } from "@heroicons/react/16/solid";
import type { Me } from "../shared/contracts";
import { api } from "./api";
import { Avatar, Button, ErrorMessage } from "./components";
import { avatarText } from "./presentation";

/** Suggested backgrounds; every one keeps the initials readable (WCAG AA). */
export const avatarColors = [
  { value: "#4f46e5", name: "Índigo" },
  { value: "#2563eb", name: "Azul" },
  { value: "#0e7490", name: "Ciano" },
  { value: "#0f766e", name: "Verde-azulado" },
  { value: "#15803d", name: "Verde" },
  { value: "#a3e635", name: "Lima" },
  { value: "#facc15", name: "Amarelo" },
  { value: "#f97316", name: "Laranja" },
  { value: "#dc2626", name: "Vermelho" },
  { value: "#db2777", name: "Rosa" },
  { value: "#9333ea", name: "Roxo" },
  { value: "#475569", name: "Ardósia" },
];

/**
 * The signed-in person's avatar in the sidebar; it opens a colour picker for the avatar
 * background, which everyone sees, to tell people apart while there are no photos.
 */
export function AvatarColorMenu({ me, onSaved }: { me: Me; onSaved(): void }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(me.avatarColor);
  const [error, setError] = useState("");
  const timer = useRef<number>(undefined);
  useEffect(() => setColor(me.avatarColor), [me.avatarColor]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function save(next: string | null) {
    setError("");
    try {
      await api("/me/avatar-color", "PUT", { color: next });
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
      setColor(me.avatarColor);
    }
  }
  /** Shows the colour at once; the custom picker saves once the person stops dragging. */
  function choose(next: string | null, delay = 0) {
    setColor(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(next), delay);
  }
  const custom = !!color && !avatarColors.some((item) => item.value === color);
  return (
    <Popover
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      positioning="above-start"
      trapFocus
    >
      <PopoverTrigger disableButtonEnhancement>
        <button
          type="button"
          className="avatar-button"
          aria-label="Mudar a cor do avatar"
          title="Mudar a cor do avatar"
        >
          <Avatar name={me.name} size="medium" color={color} />
        </button>
      </PopoverTrigger>
      <PopoverSurface className="avatar-color-panel" aria-label="Cor do avatar">
        <header>
          <Avatar name={me.name} size="medium" color={color} />
          <div>
            <h2>Cor do avatar</h2>
            <p>
              Visível para toda a equipa, para distinguir quem é quem nas listas
              e comentários.
            </p>
          </div>
        </header>
        <div
          className="avatar-swatches"
          role="group"
          aria-label="Cores sugeridas"
        >
          {avatarColors.map((item) => (
            <button
              key={item.value}
              type="button"
              className="avatar-swatch"
              style={{ background: item.value, color: avatarText(item.value) }}
              aria-label={item.name}
              aria-pressed={color === item.value}
              title={item.name}
              onClick={() => choose(item.value)}
            >
              {color === item.value && <CheckIcon aria-hidden />}
            </button>
          ))}
        </div>
        <div className="avatar-color-actions">
          <label className={`avatar-custom${custom ? " selected" : ""}`}>
            <input
              type="color"
              value={color ?? "#4f46e5"}
              onChange={(event) => choose(event.target.value, 400)}
            />
            Personalizada
          </label>
          <Button
            size="sm"
            variant="ghost"
            disabled={!color}
            onClick={() => choose(null)}
          >
            Repor predefinida
          </Button>
        </div>
        {error && <ErrorMessage message={error} />}
      </PopoverSurface>
    </Popover>
  );
}

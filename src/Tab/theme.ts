import { useEffect, useState } from "react";
import {
  teamsDarkTheme,
  teamsHighContrastTheme,
  teamsLightTheme,
  type Theme,
} from "@fluentui/react-components";

export type ThemeName = "light" | "dark" | "contrast";
const storageKey = "testhub.theme";

// Fluent components (menus, spinner) read their own CSS variables; point them at our tokens.
function mapped(base: Theme): Theme {
  return {
    ...base,
    fontFamilyBase: "var(--font-sans)",
    fontFamilyMonospace: "var(--font-mono)",
    borderRadiusMedium: "var(--radius-chip)",
    borderRadiusLarge: "var(--radius-button)",
    borderRadiusXLarge: "var(--radius-card)",
    colorNeutralBackground1: "var(--surface)",
    colorNeutralBackground1Hover: "var(--sunken)",
    colorNeutralBackground1Pressed: "var(--sunken)",
    colorNeutralBackground1Selected: "var(--sunken)",
    colorNeutralBackground2: "var(--bg)",
    colorNeutralBackground3: "var(--sunken)",
    colorNeutralBackground4: "var(--sunken)",
    colorNeutralBackground5: "var(--sunken)",
    colorNeutralBackground6: "var(--sunken)",
    colorSubtleBackgroundHover: "var(--sunken)",
    colorSubtleBackgroundPressed: "var(--sunken)",
    colorSubtleBackgroundSelected: "var(--sunken)",
    colorNeutralForeground1: "var(--text)",
    colorNeutralForeground1Hover: "var(--text)",
    colorNeutralForeground1Pressed: "var(--text)",
    colorNeutralForeground1Selected: "var(--text)",
    colorNeutralForeground2: "var(--text-2)",
    colorNeutralForeground2Hover: "var(--text)",
    colorNeutralForeground2Pressed: "var(--text)",
    colorNeutralForeground2Selected: "var(--text)",
    colorNeutralForeground2BrandHover: "var(--accent-text)",
    colorNeutralForeground2BrandPressed: "var(--accent-text)",
    colorNeutralForeground2BrandSelected: "var(--accent-text)",
    colorNeutralForeground3: "var(--text-3)",
    colorNeutralStroke1: "var(--border-strong)",
    colorNeutralStroke2: "var(--border)",
    colorNeutralStroke3: "var(--border)",
    colorNeutralStrokeAccessible: "var(--border-strong)",
    colorBrandBackground: "var(--accent)",
    colorBrandBackgroundHover: "var(--accent-hover)",
    colorBrandBackgroundPressed: "var(--accent-hover)",
    colorBrandBackground2: "var(--accent-soft)",
    colorBrandForeground1: "var(--accent-text)",
    colorBrandForeground2: "var(--accent-text)",
    colorBrandForegroundLink: "var(--accent-text)",
    colorBrandForegroundLinkHover: "var(--accent-text)",
    colorCompoundBrandForeground1: "var(--accent-text)",
    colorCompoundBrandStroke: "var(--accent)",
    colorBrandStroke1: "var(--accent)",
    colorNeutralForegroundOnBrand: "var(--on-accent)",
    colorStrokeFocus2: "var(--accent)",
    shadow16: "var(--shadow-overlay)",
  };
}

export const fluentThemes: Record<ThemeName, Theme> = {
  light: mapped(teamsLightTheme),
  dark: mapped(teamsDarkTheme),
  contrast: {
    ...teamsHighContrastTheme,
    fontFamilyBase: "var(--font-sans)",
    fontFamilyMonospace: "var(--font-mono)",
  },
};

function storedTheme(): "light" | "dark" | null {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** Order: Teams high contrast > saved choice > Teams theme > system preference. */
export function useTheme() {
  const [hostTheme, setHostTheme] = useState("");
  const [choice, setChoice] = useState(storedTheme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const theme: ThemeName =
    hostTheme === "contrast"
      ? "contrast"
      : (choice ??
        (hostTheme === "dark"
          ? "dark"
          : hostTheme
            ? "light"
            : systemDark
              ? "dark"
              : "light"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return {
    theme,
    setHostTheme,
    toggle() {
      const next = theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Private mode: the choice still applies for this session.
      }
      setChoice(next);
    },
  };
}

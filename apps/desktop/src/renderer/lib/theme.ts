import type { ThemeMode } from "../../shared/uiPreferences";

type ThemeCssBase = "light" | "dark" | "tomorrow-night" | "catppuccin-mocha";

type ThemeVariantDefinition = {
  cssBase: ThemeCssBase;
  surfaces: {
    page: string;
    canvas: string;
    toolbar: string;
    toolbarBorder: string;
    card: string;
    cardBorder: string;
    panel: string;
    panelBorder: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    muted: string;
    placeholder: string;
    disabled: string;
  };
  controls: {
    inputBg: string;
    inputBorder: string;
    selectBg: string;
    selectBorder: string;
    selectText: string;
    selectArrow: string;
    toggleOff: string;
    checkOff: string;
    checkBorder: string;
  };
  search: {
    bg: string;
    border: string;
    icon: string;
    placeholder: string;
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
  };
  inspector: {
    metaLabel: string;
    metaValue: string;
    permsBg: string;
    permsCode: string;
    pathBg: string;
    pathCrumb: string;
  };
  separator: string;
};

const THEME_VARIANTS: Partial<Record<ThemeMode, ThemeVariantDefinition>> = {
  "ft-dark": {
    cssBase: "dark",
    surfaces: {
      page: "#1e2028",
      canvas: "#252830",
      toolbar: "#1c1f26",
      toolbarBorder: "#2d3037",
      card: "#2c2f3a",
      cardBorder: "rgba(255,255,255,0.05)",
      panel: "#20232b",
      panelBorder: "#2d3037",
    },
    text: {
      primary: "#dcdee4",
      secondary: "#9da1b3",
      tertiary: "#6e7283",
      muted: "#555868",
      placeholder: "#484b54",
      disabled: "#44464e",
    },
    controls: {
      inputBg: "rgba(255,255,255,0.02)",
      inputBorder: "rgba(255,255,255,0.14)",
      selectBg: "rgba(255,255,255,0.02)",
      selectBorder: "rgba(255,255,255,0.14)",
      selectText: "#9da1b3",
      selectArrow: "#555868",
      toggleOff: "#282b32",
      checkOff: "rgba(255,255,255,0.03)",
      checkBorder: "rgba(255,255,255,0.08)",
    },
    search: {
      bg: "#27272f",
      border: "#5e5e66",
      icon: "#54545c",
      placeholder: "#55555f",
      badgeBg: "#2e3038",
      badgeBorder: "#484850",
      badgeText: "#6a6a74",
    },
    inspector: {
      metaLabel: "#484b54",
      metaValue: "#a0a4b0",
      permsBg: "rgba(255,255,255,0.02)",
      permsCode: "#6e7080",
      pathBg: "rgba(255,255,255,0.025)",
      pathCrumb: "#8a8d9a",
    },
    separator: "rgba(255,255,255,0.04)",
  },
  "obsidian-blue": {
    cssBase: "dark",
    surfaces: {
      page: "#0b1018",
      canvas: "#0b1018",
      toolbar: "#111826",
      toolbarBorder: "#1f2a3d",
      card: "#141c2b",
      cardBorder: "#1f2a3d",
      panel: "#111826",
      panelBorder: "#1f2a3d",
    },
    text: {
      primary: "#e4e8f1",
      secondary: "#8793a8",
      tertiary: "#56627a",
      muted: "#56627a",
      placeholder: "#56627a",
      disabled: "#3a4458",
    },
    controls: {
      inputBg: "#0d1420",
      inputBorder: "#1f2a3d",
      selectBg: "#0d1420",
      selectBorder: "#1f2a3d",
      selectText: "#e4e8f1",
      selectArrow: "#8793a8",
      toggleOff: "#1f2a3d",
      checkOff: "#0d1420",
      checkBorder: "#2a3650",
    },
    search: {
      bg: "#0d1420",
      border: "#1f2a3d",
      icon: "#8793a8",
      placeholder: "#56627a",
      badgeBg: "rgba(212,149,42,0.14)",
      badgeBorder: "rgba(212,149,42,0.45)",
      badgeText: "#d4952a",
    },
    inspector: {
      metaLabel: "#56627a",
      metaValue: "#e4e8f1",
      permsBg: "#0d1420",
      permsCode: "#d4952a",
      pathBg: "#111826",
      pathCrumb: "#8793a8",
    },
    separator: "rgba(255,255,255,0.04)",
  },
  "clean-white": {
    cssBase: "light",
    surfaces: {
      page: "#f3f3f3",
      canvas: "#ffffff",
      toolbar: "#f7f7f7",
      toolbarBorder: "#dfdfdf",
      card: "#ffffff",
      cardBorder: "rgba(0,0,0,0.07)",
      panel: "#f5f5f5",
      panelBorder: "#dfdfdf",
    },
    text: {
      primary: "#111111",
      secondary: "#333333",
      tertiary: "#666666",
      muted: "#999999",
      placeholder: "#b8b8b8",
      disabled: "#cccccc",
    },
    controls: {
      inputBg: "#ffffff",
      inputBorder: "rgba(0,0,0,0.13)",
      selectBg: "#ffffff",
      selectBorder: "rgba(0,0,0,0.13)",
      selectText: "#333333",
      selectArrow: "#999999",
      toggleOff: "#d0d0d0",
      checkOff: "#ffffff",
      checkBorder: "rgba(0,0,0,0.16)",
    },
    search: {
      bg: "#fafafa",
      border: "#d0d0d0",
      icon: "#bbbbbb",
      placeholder: "#b8b8b8",
      badgeBg: "#f0f0f0",
      badgeBorder: "#d8d8d8",
      badgeText: "#999999",
    },
    inspector: {
      metaLabel: "#999999",
      metaValue: "#333333",
      permsBg: "rgba(0,0,0,0.025)",
      permsCode: "#666666",
      pathBg: "rgba(0,0,0,0.03)",
      pathCrumb: "#444444",
    },
    separator: "rgba(0,0,0,0.06)",
  },
  "warm-paper": {
    cssBase: "light",
    surfaces: {
      page: "#f0ede7",
      canvas: "#faf8f4",
      toolbar: "#ece8e0",
      toolbarBorder: "#dbd6cc",
      card: "#fdfcf8",
      cardBorder: "rgba(120,100,60,0.08)",
      panel: "#f0ede7",
      panelBorder: "#dbd6cc",
    },
    text: {
      primary: "#1f1a14",
      secondary: "#3d3528",
      tertiary: "#6b6050",
      muted: "#9c9282",
      placeholder: "#bab0a0",
      disabled: "#c8c0b4",
    },
    controls: {
      inputBg: "#fdfcf9",
      inputBorder: "rgba(100,80,40,0.14)",
      selectBg: "#fdfcf9",
      selectBorder: "rgba(100,80,40,0.14)",
      selectText: "#3d3528",
      selectArrow: "#9c9282",
      toggleOff: "#d0c9bc",
      checkOff: "#fdfcf9",
      checkBorder: "rgba(100,80,40,0.15)",
    },
    search: {
      bg: "#f6f3ee",
      border: "#ccc6ba",
      icon: "#b8b0a0",
      placeholder: "#bab0a0",
      badgeBg: "#edeae4",
      badgeBorder: "#d4d0c6",
      badgeText: "#9c9282",
    },
    inspector: {
      metaLabel: "#9c9282",
      metaValue: "#3d3528",
      permsBg: "rgba(100,80,40,0.025)",
      permsCode: "#6b6050",
      pathBg: "rgba(100,80,40,0.03)",
      pathCrumb: "#4d4538",
    },
    separator: "rgba(100,80,40,0.06)",
  },
  stone: {
    cssBase: "light",
    surfaces: {
      page: "#eeeeee",
      canvas: "#f8f8f8",
      toolbar: "#ebebeb",
      toolbarBorder: "#d8d8d8",
      card: "#fbfbfb",
      cardBorder: "rgba(0,0,0,0.07)",
      panel: "#eeeeee",
      panelBorder: "#d8d8d8",
    },
    text: {
      primary: "#151515",
      secondary: "#383838",
      tertiary: "#5e5e5e",
      muted: "#919191",
      placeholder: "#b0b0b0",
      disabled: "#c0c0c0",
    },
    controls: {
      inputBg: "#fcfcfc",
      inputBorder: "rgba(0,0,0,0.12)",
      selectBg: "#fcfcfc",
      selectBorder: "rgba(0,0,0,0.12)",
      selectText: "#383838",
      selectArrow: "#919191",
      toggleOff: "#c8c8c8",
      checkOff: "#fcfcfc",
      checkBorder: "rgba(0,0,0,0.14)",
    },
    search: {
      bg: "#f4f4f4",
      border: "#c8c8c8",
      icon: "#b0b0b0",
      placeholder: "#b0b0b0",
      badgeBg: "#eeeeee",
      badgeBorder: "#d0d0d0",
      badgeText: "#919191",
    },
    inspector: {
      metaLabel: "#919191",
      metaValue: "#383838",
      permsBg: "rgba(0,0,0,0.025)",
      permsCode: "#5e5e5e",
      pathBg: "rgba(0,0,0,0.03)",
      pathCrumb: "#484848",
    },
    separator: "rgba(0,0,0,0.06)",
  },
  sand: {
    cssBase: "light",
    surfaces: {
      page: "#ece7dc",
      canvas: "#f7f3ec",
      toolbar: "#e8e2d7",
      toolbarBorder: "#d3cbc0",
      card: "#faf8f3",
      cardBorder: "rgba(130,110,70,0.09)",
      panel: "#ece7dc",
      panelBorder: "#d3cbc0",
    },
    text: {
      primary: "#1c1508",
      secondary: "#3a3220",
      tertiary: "#655840",
      muted: "#968a74",
      placeholder: "#b4a892",
      disabled: "#c2b8a8",
    },
    controls: {
      inputBg: "#faf8f4",
      inputBorder: "rgba(110,90,50,0.15)",
      selectBg: "#faf8f4",
      selectBorder: "rgba(110,90,50,0.15)",
      selectText: "#3a3220",
      selectArrow: "#968a74",
      toggleOff: "#ccc4b6",
      checkOff: "#faf8f4",
      checkBorder: "rgba(110,90,50,0.15)",
    },
    search: {
      bg: "#f2ede4",
      border: "#c8c0b4",
      icon: "#b4a892",
      placeholder: "#b4a892",
      badgeBg: "#e8e2d8",
      badgeBorder: "#cfc8bc",
      badgeText: "#968a74",
    },
    inspector: {
      metaLabel: "#968a74",
      metaValue: "#3a3220",
      permsBg: "rgba(110,90,50,0.025)",
      permsCode: "#655840",
      pathBg: "rgba(110,90,50,0.03)",
      pathCrumb: "#4a4030",
    },
    separator: "rgba(110,90,50,0.06)",
  },
  obsidian: {
    cssBase: "dark",
    surfaces: {
      page: "#080809",
      canvas: "#0c0c0e",
      toolbar: "#101012",
      toolbarBorder: "#1e1e22",
      card: "#111113",
      cardBorder: "rgba(255,255,255,0.06)",
      panel: "#0e0e10",
      panelBorder: "#1e1e22",
    },
    text: {
      primary: "#f0f0f2",
      secondary: "#c4c4c8",
      tertiary: "#8a8a90",
      muted: "#5e5e64",
      placeholder: "#404046",
      disabled: "#303036",
    },
    controls: {
      inputBg: "rgba(255,255,255,0.04)",
      inputBorder: "rgba(255,255,255,0.08)",
      selectBg: "rgba(255,255,255,0.04)",
      selectBorder: "rgba(255,255,255,0.08)",
      selectText: "#c4c4c8",
      selectArrow: "#5e5e64",
      toggleOff: "#2a2a2e",
      checkOff: "rgba(255,255,255,0.04)",
      checkBorder: "rgba(255,255,255,0.08)",
    },
    search: {
      bg: "#141416",
      border: "#2e2e32",
      icon: "#404046",
      placeholder: "#404046",
      badgeBg: "#1a1a1e",
      badgeBorder: "#2a2a2e",
      badgeText: "#5e5e64",
    },
    inspector: {
      metaLabel: "#4a4a50",
      metaValue: "#c4c4c8",
      permsBg: "rgba(255,255,255,0.02)",
      permsCode: "#8a8a90",
      pathBg: "rgba(255,255,255,0.025)",
      pathCrumb: "#8a8a90",
    },
    separator: "rgba(255,255,255,0.04)",
  },
  graphite: {
    cssBase: "dark",
    surfaces: {
      page: "#161614",
      canvas: "#1c1c1a",
      toolbar: "#1a1a18",
      toolbarBorder: "#2c2c28",
      card: "#1f1f1d",
      cardBorder: "rgba(255,255,255,0.05)",
      panel: "#1a1a18",
      panelBorder: "#2c2c28",
    },
    text: {
      primary: "#ededec",
      secondary: "#c0bfba",
      tertiary: "#8e8c86",
      muted: "#5e5c58",
      placeholder: "#444240",
      disabled: "#343230",
    },
    controls: {
      inputBg: "rgba(255,255,255,0.035)",
      inputBorder: "rgba(255,255,255,0.07)",
      selectBg: "rgba(255,255,255,0.035)",
      selectBorder: "rgba(255,255,255,0.07)",
      selectText: "#c0bfba",
      selectArrow: "#5e5c58",
      toggleOff: "#333330",
      checkOff: "rgba(255,255,255,0.035)",
      checkBorder: "rgba(255,255,255,0.07)",
    },
    search: {
      bg: "#222220",
      border: "#383834",
      icon: "#444240",
      placeholder: "#444240",
      badgeBg: "#262624",
      badgeBorder: "#343230",
      badgeText: "#5e5c58",
    },
    inspector: {
      metaLabel: "#4e4c48",
      metaValue: "#c0bfba",
      permsBg: "rgba(255,255,255,0.02)",
      permsCode: "#8e8c86",
      pathBg: "rgba(255,255,255,0.025)",
      pathCrumb: "#8e8c86",
    },
    separator: "rgba(255,255,255,0.04)",
  },
  midnight: {
    cssBase: "dark",
    surfaces: {
      page: "#0a0d14",
      canvas: "#0e1118",
      toolbar: "#111420",
      toolbarBorder: "#222840",
      card: "#121520",
      cardBorder: "rgba(140,160,255,0.06)",
      panel: "#10131c",
      panelBorder: "#222840",
    },
    text: {
      primary: "#eef0f6",
      secondary: "#b8bece",
      tertiary: "#7e8698",
      muted: "#505870",
      placeholder: "#3a4058",
      disabled: "#2c3248",
    },
    controls: {
      inputBg: "rgba(180,200,255,0.04)",
      inputBorder: "rgba(140,160,255,0.08)",
      selectBg: "rgba(180,200,255,0.04)",
      selectBorder: "rgba(140,160,255,0.08)",
      selectText: "#b8bece",
      selectArrow: "#505870",
      toggleOff: "#2a3040",
      checkOff: "rgba(180,200,255,0.04)",
      checkBorder: "rgba(140,160,255,0.08)",
    },
    search: {
      bg: "#161a26",
      border: "#303858",
      icon: "#3a4058",
      placeholder: "#3a4058",
      badgeBg: "#1a1e2e",
      badgeBorder: "#2a3048",
      badgeText: "#505870",
    },
    inspector: {
      metaLabel: "#404860",
      metaValue: "#b8bece",
      permsBg: "rgba(140,160,255,0.02)",
      permsCode: "#7e8698",
      pathBg: "rgba(140,160,255,0.025)",
      pathCrumb: "#7e8698",
    },
    separator: "rgba(140,160,255,0.04)",
  },
  onyx: {
    cssBase: "dark",
    surfaces: {
      page: "#101218",
      canvas: "#14161c",
      toolbar: "#16181e",
      toolbarBorder: "#282c36",
      card: "#181a20",
      cardBorder: "rgba(255,255,255,0.06)",
      panel: "#151720",
      panelBorder: "#282c36",
    },
    text: {
      primary: "#e8eaf0",
      secondary: "#b8bcc8",
      tertiary: "#848998",
      muted: "#585e70",
      placeholder: "#404558",
      disabled: "#303446",
    },
    controls: {
      inputBg: "rgba(255,255,255,0.04)",
      inputBorder: "rgba(255,255,255,0.08)",
      selectBg: "rgba(255,255,255,0.04)",
      selectBorder: "rgba(255,255,255,0.08)",
      selectText: "#b8bcc8",
      selectArrow: "#585e70",
      toggleOff: "#2e3240",
      checkOff: "rgba(255,255,255,0.04)",
      checkBorder: "rgba(255,255,255,0.08)",
    },
    search: {
      bg: "#1c1e26",
      border: "#34384a",
      icon: "#404558",
      placeholder: "#404558",
      badgeBg: "#202430",
      badgeBorder: "#30343e",
      badgeText: "#585e70",
    },
    inspector: {
      metaLabel: "#484e60",
      metaValue: "#b8bcc8",
      permsBg: "rgba(255,255,255,0.02)",
      permsCode: "#848998",
      pathBg: "rgba(255,255,255,0.025)",
      pathCrumb: "#848998",
    },
    separator: "rgba(255,255,255,0.04)",
  },
};

export const THEME_VARIANT_OVERRIDE_KEYS = Array.from(
  new Set(
    Object.values(THEME_VARIANTS)
      .filter((variant): variant is ThemeVariantDefinition => variant !== undefined)
      .flatMap((variant) => Object.keys(getThemeVariantCssOverridesFromVariant(variant))),
  ),
);

export function getThemeVariant(theme: ThemeMode): ThemeVariantDefinition | null {
  return THEME_VARIANTS[theme] ?? null;
}

export function resolveThemeCssBase(theme: ThemeMode): ThemeCssBase {
  if (
    theme === "light" ||
    theme === "dark" ||
    theme === "tomorrow-night" ||
    theme === "catppuccin-mocha"
  ) {
    return theme;
  }
  return getThemeVariant(theme)?.cssBase ?? "light";
}

export function getThemeVariantCssOverrides(theme: ThemeMode): Record<string, string> {
  const variant = getThemeVariant(theme);
  if (!variant) {
    return {};
  }
  return getThemeVariantCssOverridesFromVariant(variant);
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const cssBase = resolveThemeCssBase(theme);
  root.dataset.theme = cssBase;
  root.dataset.themeVariant = theme;
  root.style.colorScheme = cssBase === "light" ? "light" : "dark";

  for (const propertyName of THEME_VARIANT_OVERRIDE_KEYS) {
    root.style.removeProperty(propertyName);
  }

  const overrides = getThemeVariantCssOverrides(theme);
  for (const [propertyName, value] of Object.entries(overrides)) {
    root.style.setProperty(propertyName, value);
  }
}

export function applyDocumentAppearance(
  theme: ThemeMode,
  shikiTheme: string | null | undefined,
): void {
  if (typeof document === "undefined") {
    return;
  }

  applyTheme(theme);
  if (typeof shikiTheme === "string" && shikiTheme.length > 0) {
    document.documentElement.dataset.shikiTheme = shikiTheme;
    return;
  }
  delete document.documentElement.dataset.shikiTheme;
}

function getThemeVariantCssOverridesFromVariant(
  variant: ThemeVariantDefinition,
): Record<string, string> {
  return {
    "--bg-base": variant.surfaces.page,
    "--bg-surface": variant.surfaces.panel,
    "--bg-elevated": variant.surfaces.card,
    "--bg-hover": variant.search.bg,
    "--bg-active": variant.search.badgeBg,
    "--border": variant.surfaces.panelBorder,
    "--border-active": variant.controls.inputBorder,
    "--text-primary": variant.text.primary,
    "--text-secondary": variant.text.secondary,
    "--text-tertiary": variant.text.tertiary,
    "--code-bg": variant.surfaces.canvas,
    "--code-border": variant.surfaces.panelBorder,
    "--code-meta-bg": variant.surfaces.card,
    "--code-meta-text": variant.inspector.metaValue,
    "--path-pill-bg": variant.inspector.pathBg,
    "--path-pill-border": variant.surfaces.panelBorder,
    "--path-pill-text": variant.inspector.pathCrumb,
    "--session-pane-preview-text": variant.text.secondary,
    "--session-pane-meta-text": variant.text.tertiary,
    "--message-heading-text": variant.text.primary,
    "--row-hover": variant.separator,
    "--copy-icon-color": variant.text.tertiary,
    "--section-header-bg": variant.surfaces.toolbar,
    "--help-surface": variant.surfaces.panel,
    "--help-elevated": variant.surfaces.card,
    "--help-hover": variant.search.bg,
    "--help-border": variant.surfaces.panelBorder,
    "--help-border-subtle": variant.separator,
    "--help-muted": variant.text.tertiary,
    "--help-key-bg": variant.surfaces.card,
    "--help-key-border": variant.controls.inputBorder,
  };
}

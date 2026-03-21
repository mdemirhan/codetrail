import type { Ref } from "react";

export function AdvancedSearchToggleButton({
  enabled,
  onToggle,
  title,
  buttonRef,
  tabIndex,
}: {
  enabled: boolean;
  onToggle: () => void;
  title?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  tabIndex?: number;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={tabIndex}
      className={`search-mode-icon-btn${enabled ? " active" : ""}`}
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Disable advanced search syntax" : "Enable advanced search syntax"}
      title={title ?? (enabled ? "Advanced syntax enabled" : "Advanced syntax disabled")}
    >
      <span className="search-mode-glyph" aria-hidden>
        {"</>"}
      </span>
    </button>
  );
}

import type { Ref } from "react";

export function AdvancedSearchToggleButton({
  enabled,
  onToggle,
  title,
  buttonRef,
  tabIndex,
  variant = "history",
}: {
  enabled: boolean;
  onToggle: () => void;
  title?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  tabIndex?: number;
  variant?: "history" | "search";
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={tabIndex}
      className={`advanced-search-toggle-btn advanced-search-toggle-btn-${variant}${
        enabled ? " active" : ""
      }`}
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Disable advanced search syntax" : "Enable advanced search syntax"}
      title={title ?? (enabled ? "Advanced syntax enabled" : "Advanced syntax disabled")}
    >
      <svg className="search-mode-glyph" viewBox="0 0 16 16" aria-hidden>
        <title>Advanced search</title>
        <path
          d="M5.5 4 2.75 8l2.75 4M10.5 4 13.25 8l-2.75 4M8.75 3.25 7.25 12.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

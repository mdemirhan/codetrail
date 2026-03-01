export const EDIT_OPERATION_HINTS = [
  "edit",
  "write",
  "rewrite",
  "replace",
  "apply_patch",
  "patch",
  "multi_edit",
  "create_file",
  "update_file",
  "delete_file",
  "insert",
  "str_replace",
] as const;

export function isLikelyEditOperation(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  return EDIT_OPERATION_HINTS.some((hint) => normalized.includes(hint));
}

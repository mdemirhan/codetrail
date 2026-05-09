export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const contentEditable = target.getAttribute("contenteditable");
  if (
    target.isContentEditable ||
    contentEditable === "" ||
    contentEditable === "true" ||
    contentEditable === "plaintext-only"
  ) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

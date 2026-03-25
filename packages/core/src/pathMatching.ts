const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_ROOT_RE = /^[A-Za-z]:\/$/;

function isWindowsAbsolutePath(value: string): boolean {
  return WINDOWS_ABSOLUTE_PATH_RE.test(value);
}

function isWindowsDriveRoot(value: string): boolean {
  return WINDOWS_DRIVE_ROOT_RE.test(value);
}

function trimTrailingPathSeparators(value: string): string {
  if (value === "/" || isWindowsDriveRoot(value)) {
    return value;
  }
  return value.replace(/\/+$/, "");
}

function normalizeRelativePath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    isWindowsAbsolutePath(normalized)
  ) {
    return null;
  }

  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        return null;
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.length > 0 ? parts.join("/") : null;
}

export function normalizeAbsolutePath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, "/");
  const windowsPrefix = /^([A-Za-z]):\//.exec(normalized);

  if (!windowsPrefix && !normalized.startsWith("/")) {
    return null;
  }
  if (normalized.startsWith("//")) {
    return null;
  }

  const rootPrefix = windowsPrefix ? `${windowsPrefix[1] ?? ""}:` : "/";
  const suffix = windowsPrefix ? normalized.slice(2) : normalized;
  const parts: string[] = [];

  for (const part of suffix.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  if (windowsPrefix) {
    return parts.length > 0 ? `${rootPrefix}/${parts.join("/")}` : `${rootPrefix}/`;
  }

  return parts.length > 0 ? `/${parts.join("/")}` : "/";
}

export function normalizePathForComparison(value: string): string | null {
  const normalizedAbsolute = normalizeAbsolutePath(value);
  if (!normalizedAbsolute) {
    return null;
  }

  const trimmedPath = trimTrailingPathSeparators(normalizedAbsolute);
  return isWindowsAbsolutePath(trimmedPath) ? trimmedPath.toLowerCase() : trimmedPath;
}

export function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = normalizePathForComparison(targetPath);
  const normalizedRoot = normalizePathForComparison(rootPath);
  if (!normalizedTarget || !normalizedRoot) {
    return false;
  }

  if (normalizedRoot === "/" || isWindowsDriveRoot(normalizedRoot)) {
    return normalizedTarget.startsWith(normalizedRoot);
  }

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

export function relativePathSegments(filePath: string, rootPath: string): string[] {
  const normalizedFilePath = normalizeAbsolutePath(filePath);
  const normalizedRootPath = normalizeAbsolutePath(rootPath);
  if (!normalizedFilePath || !normalizedRootPath) {
    return [];
  }
  if (!isPathWithinRoot(normalizedFilePath, normalizedRootPath)) {
    return [];
  }

  const normalizedFileForComparison = normalizePathForComparison(normalizedFilePath);
  const normalizedRootForComparison = normalizePathForComparison(normalizedRootPath);
  if (!normalizedFileForComparison || !normalizedRootForComparison) {
    return [];
  }
  if (normalizedFileForComparison === normalizedRootForComparison) {
    return [];
  }

  const trimmedRootPath = trimTrailingPathSeparators(normalizedRootPath);
  const sliceStart =
    trimmedRootPath === "/" || isWindowsDriveRoot(trimmedRootPath)
      ? trimmedRootPath.length
      : trimmedRootPath.length + 1;
  return normalizedFilePath
    .slice(sliceStart)
    .split("/")
    .filter((segment) => segment.length > 0);
}

export function joinPathWithinRoot(rootPath: string, relativePath: string): string | null {
  const normalizedRoot = normalizeAbsolutePath(rootPath);
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  if (!normalizedRoot || !normalizedRelativePath) {
    return null;
  }

  const separator = normalizedRoot === "/" || isWindowsDriveRoot(normalizedRoot) ? "" : "/";
  return normalizeAbsolutePath(`${normalizedRoot}${separator}${normalizedRelativePath}`);
}

export function hasFileExtension(value: string, extension: string): boolean {
  return value.toLowerCase().endsWith(extension.toLowerCase());
}

export function stripFileExtension(value: string, extension: string): string {
  return hasFileExtension(value, extension) ? value.slice(0, -extension.length) : value;
}

export function equalsCaseInsensitive(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function startsWithCaseInsensitive(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

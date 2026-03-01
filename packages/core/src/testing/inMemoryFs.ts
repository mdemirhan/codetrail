import { Buffer } from "node:buffer";
import { dirname } from "node:path";

import type { DiscoveryFileSystem } from "../discovery/discoverSessionFiles";

type NodeType = "file" | "dir";

type FsNode =
  | {
      type: "file";
      content: string;
      mtimeMs: number;
    }
  | {
      type: "dir";
      mtimeMs: number;
    };

type OpenFileState = {
  path: string;
  position: number;
};

function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (normalized.length === 1) {
    return normalized;
  }
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function parentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") {
    return "/";
  }
  const value = dirname(normalized).replace(/\\/g, "/");
  return value.length > 0 ? value : "/";
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") {
    return "/";
  }
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function createDirent(name: string, type: NodeType) {
  return {
    name,
    isDirectory: () => type === "dir",
    isFile: () => type === "file",
  };
}

export class CoreTestFs {
  private readonly nodes = new Map<string, FsNode>();
  private readonly openFiles = new Map<number, OpenFileState>();
  private nextFd = 100;

  constructor() {
    this.nodes.set("/", { type: "dir", mtimeMs: Date.now() });
  }

  mkdir(path: string): void {
    const normalized = normalizePath(path);
    const parts = normalized.split("/").filter((part) => part.length > 0);
    let current = "/";
    for (const part of parts) {
      const next = normalizePath(`${current}/${part}`);
      if (!this.nodes.has(next)) {
        this.nodes.set(next, { type: "dir", mtimeMs: Date.now() });
      }
      current = next;
    }
  }

  writeFile(path: string, content: string, mtimeMs: number = Date.now()): void {
    const normalized = normalizePath(path);
    this.mkdir(parentPath(normalized));
    this.nodes.set(normalized, { type: "file", content, mtimeMs });
  }

  toDiscoveryFileSystem(): DiscoveryFileSystem {
    return {
      closeSync: (fd) => {
        if (!this.openFiles.has(fd)) {
          throw new Error(`EBADF: bad file descriptor ${fd}`);
        }
        this.openFiles.delete(fd);
      },
      existsSync: (path) => this.nodes.has(normalizePath(path)),
      lstatSync: (path) => this.makeStat(path),
      openSync: (path, flag) => {
        if (flag !== "r") {
          throw new Error(`Unsupported flag '${flag}'`);
        }
        const normalized = normalizePath(path);
        const node = this.nodes.get(normalized);
        if (!node || node.type !== "file") {
          throw new Error(`ENOENT: no such file '${normalized}'`);
        }
        const fd = this.nextFd++;
        this.openFiles.set(fd, { path: normalized, position: 0 });
        return fd;
      },
      readFileSync: (path) => {
        const node = this.nodes.get(normalizePath(path));
        if (!node || node.type !== "file") {
          throw new Error(`ENOENT: no such file '${path}'`);
        }
        return node.content;
      },
      readSync: (fd, buffer, offset, length, position) => {
        const file = this.openFiles.get(fd);
        if (!file) {
          throw new Error(`EBADF: bad file descriptor ${fd}`);
        }
        const node = this.nodes.get(file.path);
        if (!node || node.type !== "file") {
          throw new Error(`ENOENT: no such file '${file.path}'`);
        }
        const source = Buffer.from(node.content, "utf8");
        const start = position === null ? file.position : position;
        const end = Math.min(start + length, source.length);
        if (end <= start) {
          return 0;
        }
        source.copy(buffer as Buffer, offset, start, end);
        if (position === null) {
          file.position = end;
          this.openFiles.set(fd, file);
        }
        return end - start;
      },
      readdirSync: (path) => {
        const normalized = normalizePath(path);
        const node = this.nodes.get(normalized);
        if (!node || node.type !== "dir") {
          throw new Error(`ENOENT: no such directory '${normalized}'`);
        }

        const children = new Map<string, NodeType>();
        for (const [entryPath, entryNode] of this.nodes.entries()) {
          if (entryPath === normalized || !entryPath.startsWith(`${normalized}/`)) {
            continue;
          }
          const relative = entryPath.slice(normalized.length + 1);
          if (!relative || relative.includes("/")) {
            continue;
          }
          children.set(relative, entryNode.type);
        }

        return [...children.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, type]) => createDirent(name, type));
      },
      statSync: (path) => this.makeStat(path),
    };
  }

  private makeStat(path: string): {
    size: number;
    mtimeMs: number;
    isDirectory: () => boolean;
  } {
    const node = this.nodes.get(normalizePath(path));
    if (!node) {
      throw new Error(`ENOENT: no such path '${path}'`);
    }

    if (node.type === "file") {
      return {
        size: Buffer.byteLength(node.content, "utf8"),
        mtimeMs: node.mtimeMs,
        isDirectory: () => false,
      };
    }

    return {
      size: 0,
      mtimeMs: node.mtimeMs,
      isDirectory: () => true,
    };
  }
}

export function readFileTextFromCoreTestFs(fs: CoreTestFs): (path: string) => string {
  const adapter = fs.toDiscoveryFileSystem();
  return (path: string) => String(adapter.readFileSync(path, "utf8"));
}

export function listDirectoryEntries(fs: CoreTestFs, path: string): string[] {
  const adapter = fs.toDiscoveryFileSystem();
  return adapter.readdirSync(path, { withFileTypes: true }).map((entry) => basename(entry.name));
}

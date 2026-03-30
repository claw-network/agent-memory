import { fileURLToPath } from "node:url";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

function rootPathFromUri(uri: string): string | null {
  try {
    return fileURLToPath(new URL(uri));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_INVALID_FILE_URL_PATH" &&
      process.platform === "win32"
    ) {
      const url = new URL(uri);
      return decodeURIComponent(url.pathname);
    }
    return null;
  }
}

export class McpSessionBackend {
  private rootDirPromise: Promise<string> | null = null;

  constructor(
    private readonly defaultRootDir: string,
    private readonly server: Server,
  ) {}

  async getRootDir(): Promise<string> {
    this.rootDirPromise ??= this.resolveRootDir();
    return await this.rootDirPromise;
  }

  private async resolveRootDir(): Promise<string> {
    const clientCapabilities = this.server.getClientCapabilities();
    if (!clientCapabilities?.roots) {
      return this.defaultRootDir;
    }

    try {
      const result = await this.server.listRoots();
      const rootDir = result.roots
        .map((root) => rootPathFromUri(root.uri))
        .find((value): value is string => typeof value === "string" && value.length > 0);
      return rootDir ?? this.defaultRootDir;
    } catch {
      return this.defaultRootDir;
    }
  }
}

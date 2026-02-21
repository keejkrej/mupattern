/**
 * Zarrita-compatible AsyncReadable store backed by a browser
 * FileSystemDirectoryHandle.  Zarr v3 keys (e.g. "pos/150/crop/000/zarr.json")
 * map to file paths relative to the root directory handle.
 *
 * Implements the minimal interface zarrita needs:
 *   get(key: string): Promise<Uint8Array | undefined>
 */

export class DirectoryStore {
  constructor(private root: FileSystemDirectoryHandle) {}

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const parts = key
        .replace(/^\//, "")
        .split("/")
        .filter((s) => s.length > 0);

      let dir: FileSystemDirectoryHandle = this.root;

      for (const segment of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(segment);
      }

      const fileName = parts[parts.length - 1];
      const fileHandle = await dir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return undefined;
    }
  }
}

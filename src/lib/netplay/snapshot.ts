export const MAX_SNAPSHOT_BYTES = 2097152;
export type SnapshotEncoding = "raw" | "gzip";

async function collect(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw Error("Estado recebido excedeu o tamanho esperado.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function packSnapshot(
  raw: Uint8Array,
  gzip: boolean,
): Promise<{ bytes: Uint8Array; encoding: SnapshotEncoding }> {
  if (!raw.length || raw.length > MAX_SNAPSHOT_BYTES)
    throw Error("Tamanho de estado inválido.");
  if (gzip && raw.length >= 1024 && typeof CompressionStream !== "undefined") {
    try {
      const stream = new Blob([new Uint8Array(raw)])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));
      const bytes = await collect(stream, MAX_SNAPSHOT_BYTES + 65536);
      if (bytes.length + 64 < raw.length) return { bytes, encoding: "gzip" };
    } catch {
      /* Raw transport remains available if compression is unavailable. */
    }
  }
  return { bytes: raw, encoding: "raw" };
}

export async function unpackSnapshot(
  bytes: Uint8Array,
  encoding: SnapshotEncoding,
  rawSize: number,
) {
  if (
    !Number.isInteger(rawSize) ||
    rawSize < 1 ||
    rawSize > MAX_SNAPSHOT_BYTES ||
    !bytes.length ||
    bytes.length > MAX_SNAPSHOT_BYTES
  )
    throw Error("Tamanho de estado inválido.");
  let raw = bytes;
  if (encoding === "gzip") {
    if (typeof DecompressionStream === "undefined")
      throw Error("Este navegador não suporta o estado comprimido.");
    raw = await collect(
      new Blob([new Uint8Array(bytes)])
        .stream()
        .pipeThrough(new DecompressionStream("gzip")),
      rawSize,
    );
  }
  if (raw.length !== rawSize) throw Error("Estado recebido incompleto.");
  return raw;
}

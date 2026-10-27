import { get, set } from "idb-keyval";

const KEY = "bomber.netplay.local-rom.v1";
export interface LocalRom {
  format: 1;
  sha256: string;
  bytes: Uint8Array;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  // Own the buffer: ArrayBufferLike may otherwise include SharedArrayBuffer.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function size(bytes: Uint8Array) {
  if (bytes.length !== 2097152 && bytes.length !== 2097664)
    throw Error(
      "Importe sua ROM original de Super Bomberman 5 (.sfc ou .smc, 2 MB).",
    );
}
export async function readLocalRom(
  expectedHash?: string,
): Promise<LocalRom | undefined> {
  const record = await get<LocalRom>(KEY);
  if (!record) return;
  if (record.format !== 1 || !(record.bytes instanceof Uint8Array))
    throw Error(
      "A instalação local está inválida. Importe novamente sua ROM; seus saves foram preservados.",
    );
  size(record.bytes);
  const hash = await sha256(record.bytes);
  if (hash !== record.sha256 || (expectedHash && hash !== expectedHash))
    throw Error(
      "A ROM instalada não corresponde à versão da sala. Importe uma cópia idêntica.",
    );
  return record;
}
export async function installLocalRom(
  file: Blob,
  expectedHash?: string,
): Promise<LocalRom> {
  if (file.size !== 2097152 && file.size !== 2097664)
    throw Error("O arquivo precisa ser a ROM SNES de 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  size(bytes);
  const hash = await sha256(bytes);
  if (expectedHash && hash !== expectedHash)
    throw Error("O SHA-256 do arquivo difere da ROM usada na sala.");
  const record: LocalRom = { format: 1, sha256: hash, bytes };
  try {
    await set(KEY, record);
    // Best effort: a denied persistence request must never discard a valid ROM.
    if (typeof navigator !== "undefined")
      void navigator.storage?.persist?.().catch(() => false);
  } catch {
    throw Error(
      "O navegador não conseguiu armazenar a ROM. Libere espaço ou habilite o armazenamento local.",
    );
  }
  return record;
}

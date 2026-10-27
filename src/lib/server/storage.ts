import { get as getBlob, put as putBlob } from "@vercel/blob";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
const key = "super-bomberman-5.sfc";
function r2() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });
}
export function validateRom(data: Uint8Array) {
  if (data.length !== 2097152 && data.length !== 2097664)
    throw Error(
      "Envie a ROM SNES de 2 MB (.sfc), com ou sem cabeçalho de 512 bytes.",
    );
  const hash = createHash("sha256").update(data).digest("hex");
  if (process.env.ROM_SHA256 && hash !== process.env.ROM_SHA256)
    throw Error("O arquivo não corresponde ao SHA-256 autorizado.");
  return hash;
}
export async function putRom(data: Uint8Array) {
  validateRom(data);
  if (process.env.ROM_STORAGE === "vercel-blob") {
    await putBlob(key, Buffer.from(data), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/octet-stream",
    });
    return;
  }
  if (process.env.ROM_STORAGE === "r2") {
    await r2().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: data,
        ContentType: "application/octet-stream",
      }),
    );
  } else {
    if (process.env.NODE_ENV === "production")
      throw Error("Use R2 em produção");
    await mkdir(".private", { recursive: true, mode: 0o700 });
    await writeFile(`.private/${key}.tmp`, data, { mode: 0o600 });
    await rename(`.private/${key}.tmp`, `.private/${key}`);
  }
}
export async function getRom() {
  if (process.env.ROM_STORAGE === "vercel-blob") {
    const result = await getBlob(key, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) throw Error("ROM ausente");
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }
  if (process.env.ROM_STORAGE === "r2") {
    const obj = await r2().send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
    );
    if (!obj.Body) throw Error("ROM ausente");
    return obj.Body.transformToByteArray();
  }
  if (process.env.NODE_ENV === "production") throw Error("Use R2 em produção");
  return readFile(`.private/${key}`);
}

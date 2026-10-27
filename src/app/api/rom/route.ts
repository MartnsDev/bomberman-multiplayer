import { NextRequest } from "next/server";
import { isOwner, sameOrigin } from "@/lib/server/auth";
import { getRom, putRom } from "@/lib/server/storage";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  if (!isOwner(req.headers.get("cookie")))
    return new Response("Acesso exclusivo do proprietário", { status: 401 });
  try {
    return new Response(new Uint8Array(await getRom()), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(
      "ROM indisponível. Importe o arquivo na administração.",
      { status: 404 },
    );
  }
}
export async function PUT(req: NextRequest) {
  if (
    !isOwner(req.headers.get("cookie")) ||
    !sameOrigin(req.headers.get("origin"))
  )
    return new Response("Não autorizado", { status: 403 });
  if (Number(req.headers.get("content-length")) > 2097664)
    return new Response("Arquivo muito grande", { status: 413 });
  try {
    const reader = req.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2097664) {
        await reader.cancel();
        return new Response("Arquivo muito grande", { status: 413 });
      }
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      data.set(c, offset);
      offset += c.length;
    }
    await putRom(data);
    return Response.json({ ok: true });
  } catch {
    return new Response(
      "Importação recusada: confira tamanho, SHA-256 e configuração do armazenamento.",
      { status: 400 },
    );
  }
}

# Ponte nativa para netplay SNES

Base fixada: EmulatorJS 4.2.3, Snes9x 2.0.2, relatório de distribuição de
2025-06-14. Os SHA-256 originais estão em `scripts/emulator-assets.lock.json`;
os arquivos modificados e exportações em `five-inputs.json` nesta pasta.

A extensão de cinco controles em `../emulation/README.md` é preservada. Esta
variante também expõe as funções libretro já existentes `retro_run`,
`retro_serialize`, `retro_unserialize`, `retro_serialize_size` e `retro_reset`.
Não altera a ROM. Preserva as instruções originais e acrescenta um contador nativo à entrada de retro_run. A aplicação suspende o laço
Emscripten e só chama `retro_run` quando existe uma confirmação completa de
entradas para o quadro.

O callback de entrada passa a ler diretamente os cinco estados de controle.
Isso evita o cache de entradas do frontend RetroArch, cujo contador deixa de
avançar quando seu laço é suspenso. O callback de vídeo fornece ponteiro,
largura, altura e pitch do RGB565 ao adaptador JS, que desenha um canvas local.
Nenhum MediaStream participa deste modo. O callback de áudio original é
preservado. A inicialização aguarda o término de Asyncify e cancela seu laço novamente. O áudio não bloqueante impede uma nova suspensão durante retro_run. As duas primeiras chamadas neutras atingem um limite de quadro
antes do primeiro snapshot. Saves nativos são síncronos: não dependem da fila
assíncrona de arquivos do frontend, parada junto com seu laço.

O patch usa duas entradas novas na tabela de funções WASM e pequenos callbacks
adicionais. Os limites, índices e hashes são verificados durante a construção;
o script recusa bases diferentes. Licenças e avisos dos pacotes originais são
mantidos. Fonte da modificação: `scripts/wasm-input-patch.mjs` e
`scripts/build-five-player-core.mjs`, GPL-3.0-or-later. Cópias são publicadas em
`/netplay-emulatorjs/source/`.

Reconstrução com Node 20+, 7z e wabt 1.0.39:

1. Baixe os dois pacotes oficiais do lock de `https://cdn.emulatorjs.org/4.2.3/data/cores/`
   para uma pasta temporária. O script verifica os hashes antes de modificá-los.
2. `npm install --prefix /tmp/bomber-wabt wabt@1.0.39`
3. `NETPLAY_BUILD=1 CORE_INPUT_DIR=/caminho/dos/pacotes WABT_MODULE=/tmp/bomber-wabt/node_modules/wabt/index.js node scripts/build-five-player-core.mjs`
4. `npm run setup:emulator && npm run setup:netplay && npm run prepare:client`

O build de publicação usa os binários verificados desta pasta, sem baixar ROMs,
instalar compiladores ou incluir checkpoints de teste.

Referências de implementação consultadas:

- https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3
- https://github.com/EmulatorJS/RetroArch/blob/97f2cfa65d01d57406e4ce9459242c8ada7c7e3b/input/drivers/emulatorjs_input.c
- https://github.com/EmulatorJS/snes9x/blob/master/libretro/libretro.cpp
- https://docs.libretro.com/development/cores/developing-cores/
- https://docs.libretro.com/library/snes9x/#multitap
- https://github.com/kwilson21/kaillera-next — referência conceitual, nenhum código N64 reutilizado.

Esta versão usa lockstep com atraso configurável. Não implementa rollback.
O protocolo e a documentação de validação estão em `src/lib/netplay` e
`docs/NETPLAY.md`. Testes de sincronização com snapshots não equivalem a
validação de aparelhos físicos e redes externas.

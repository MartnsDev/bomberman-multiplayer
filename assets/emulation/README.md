# Driver de cinco controles

Base: EmulatorJS 4.2.3, core Snes9x 2.0.2 (distribuição do CDN em 2025-06-14).
Os hashes oficiais estão em `scripts/emulator-assets.lock.json`; os hashes dos
artefatos modificados estão em `assets/emulation/five-inputs.json`.

O frontend nativo de entrada do EmulatorJS só guarda quatro controles em
`input/drivers/emulatorjs_input.c`. `simulate_input` ignora `user == 4`.
Acrescentamos um estado de 24 botões para esse índice, consultado pelo mesmo
`ejs_is_pressed` que RetroArch já usa. `ejs_set_keyboard_enabled` também o libera.
Não há alteração da ROM, dos estados do jogo, do código de CPU do Snes9x ou das funções existentes da ABI.
As instruções originais das funções, seções de memória e dados ficam intactas.
Um global WASM adicional pertence exclusivamente ao driver de entrada.
Também expomos a função libretro já existente `retro_set_controller_port_device`,
sem alterar suas instruções. O adaptador a chama ao iniciar, reiniciar e restaurar
para garantir joypad na porta 1 e Multitap (257) na porta 2. Apenas gravar a
opção no arquivo RetroArch não garantiu MAN nas posições adicionais durante o teste.

Fontes oficiais:

- https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3
- https://github.com/EmulatorJS/RetroArch/blob/97f2cfa65d01d57406e4ce9459242c8ada7c7e3b/input/drivers/emulatorjs_input.c
- https://github.com/EmulatorJS/snes9x
- https://docs.libretro.com/library/snes9x/#multitap

As licenças e avisos `license.txt` do pacote original são preservados sem edição.
A modificação está em `scripts/wasm-input-patch.mjs` (GPL-3.0-or-later).
O método usa prefixos de funções e conserva os bytes originais de todas as outras
funções. Os nomes/índices são localizados por desassemblagem, com a base fixada
por SHA-256. Não se deve aplicar este patch em outra versão sem revisão.

Para reconstruir (Node 20+, 7z e wabt 1.0.39):

1. Obtenha os arquivos **oficiais** listados no lock a partir de
   `https://cdn.emulatorjs.org/4.2.3/data/`, em `public/emulatorjs/`.
2. `npm install --prefix /tmp/bomber-wabt wabt@1.0.39`
3. `WABT_MODULE=/tmp/bomber-wabt/node_modules/wabt/index.js node scripts/build-five-player-core.mjs`
4. `npm run setup:emulator && npm run prepare:client`

O script testa, no WASM real de ambas as variantes (moderna e legacy), as cinco
entradas independentes, combinações, liberações, índices inválidos e limpeza.
Uma exportação do getter é adicionada somente à cópia usada pelos testes.
O pacote publicado não contém essa exportação de teste.

O build normal não precisa de wabt ou 7z: verifica e instala os dois artefatos
pré-construídos. Os fontes desta alteração também são servidos publicamente em
`/emulatorjs/source/`. A ROM permanece privada e não faz parte destes arquivos.

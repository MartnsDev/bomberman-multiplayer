# Dependências e referências

- **EmulatorJS 4.2.3**: GPL-3.0 ou posterior; copyright dos autores mantido na distribuição oficial. Licença em `/licenses/EmulatorJS.txt`. Fonte correspondente: https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3 . O frontend JS oficial é baixado sem modificação. O driver nativo de entrada do core recebe a extensão de cinco controles descrita em `assets/emulation/README.md`; fontes e hashes ficam também em `/emulatorjs/source/`. Integração via adaptador próprio em iframe. Fontes examinadas: `data/src/GameManager.js`, `data/src/emulator.js`, `data/loader.js`, servidas pelo CDN oficial com prefixo `4.2.3`.
- **Snes9x**: licença própria, com restrições a usos comerciais; preserve os avisos. Licença de referência em `/licenses/Snes9x.txt`. Fonte: https://github.com/snes9xgit/snes9x e build EmulatorJS: https://github.com/EmulatorJS/snes9x e https://github.com/EmulatorJS/RetroArch . O core inclui RetroArch/libretro e outros componentes com seus próprios avisos no pacote oficial. O core distribuído pelo CDN é fixado no relatório `public/emulatorjs/cores/reports/snes9x.json`. Não se deve remover seus avisos nem supor que uma licença MIT cubra esses binários.
- **Next.js / React / Tailwind / ws / Zod / tsx / dotenv / idb-keyval / Vitest**: licenças nos respectivos pacotes instalados. **AWS SDK e Playwright**: avisos nos pacotes. `package-lock.json` fixa as versões resolvidas.
- **Netcade** foi usado apenas como indicação de arquitetura na solicitação; nenhum código foi copiado.
- O logo do Bomberman e as fotos de perfil foram fornecidos pelo proprietário nesta conversa para uso na aplicação privada. Os arquivos de imagem originais foram copiados sem gerar rostos ou substituir pessoas. Nenhuma ROM foi incluída nos assets visuais.

Referências oficiais consultadas:

- Multitap Snes9x: https://docs.libretro.com/library/snes9x/#multitap
- Configuração EmulatorJS: https://emulatorjs.org/docs/options/
- Releases: https://github.com/EmulatorJS/EmulatorJS/releases
- Captura de canvas: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream
- WebRTC / TURN: https://webrtc.org/getting-started/turn-server
- Credenciais R2: https://developers.cloudflare.com/r2/api/tokens/
- Buckets públicos R2 (para identificar e desabilitar publicação): https://developers.cloudflare.com/r2/buckets/public-buckets/

Ao redistribuir os binários do emulador, preserve suas licenças e disponibilize as fontes correspondentes, incluindo a versão exata dos componentes do core. O projeto foi criado para a turma do proprietário. A cópia da ROM fornecida por ele foi posteriormente incluída em `roms/` no backup do repositório a seu pedido; as licenças do emulador não abrangem o jogo. Não há uma licença comercial concedida para o jogo.

## Redesign visual

- **Inter**: fonte variável latina servida localmente; SIL Open Font License 1.1, em `/licenses/Inter-OFL.txt`. Origem: https://fonts.google.com/specimen/Inter .
- **Lucide React**: ícones SVG importados individualmente; avisos do pacote preservados em `/licenses/Lucide.txt`. Documentação: https://lucide.dev/guide/react .
- A arte de batalha e o ícone da cabeça foram preparados com o tool integrado de imagens a partir da referência fornecida pelo proprietário. As marcas e os personagens mantêm seus respectivos titulares. Prompts e arquivos em `docs/design/ARTES.md`. O layout foi implementado em React/HTML/CSS; a captura completa do site não é um plano de fundo.

## Netplay local

A ponte SNES e a execução nativa estão descritas em `assets/emulation-netplay/README.md`. Fontes de patch e reconstrução são publicadas em `/netplay-emulatorjs/source/`, com os hashes dos pacotes oficiais e modificados. Referência libretro: https://docs.libretro.com/development/cores/developing-cores/ . Referência adicional: https://github.com/kwilson21/kaillera-next (nenhum código N64 copiado; rollback não implementado).

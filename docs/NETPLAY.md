# Netplay local do Bomberman Online

## Uso

Atualize o site em todos os aparelhos e crie uma sala nova. Qualquer visitante pode criar e iniciar sua sala, sem senha ou cadastro. Cada participante usa **Instalar jogo neste aparelho** para baixar a cópia pública do repositório, ou importa sua própria ROM de Super Bomberman 5. A cópia é verificada por SHA-256 e
armazenada no IndexedDB; nas próximas partidas ela é lida localmente. O
proprietário também pode instalar sua cópia da biblioteca privada por download
autenticado. Convidados não recebem acesso ao endpoint privado da ROM.

O anfitrião só pode iniciar quando todos tiverem ROM compatível, core pronto e
o mesmo snapshot confirmado. Os jogadores recebem os controles 1 a 5 de forma
exclusiva. Na tela original **PLAYER SELECT**, configure as posições ocupadas
como **MAN**. Com três pessoas, **1PLAYER, 2PLAYER e 3PLAYER devem ser MAN**;
COM é o computador e OFF desativa uma posição. O Multitap já é ativado pelo
adaptador na porta 2. Cada humano confirma seu personagem com Start.

Teclado padrão: setas, X para bomba e Enter para Start. O controle de toque
aceita direção e ação simultâneas; teclado e gamepad podem ser remapeados nas
configurações. Imagem, áudio, volume e modo expandido são locais.

## Execução

A página principal usa `NetplayRoom`. O protótipo também permanece acessível em
`/netplay-lab`. O modo solo público usa uma sala de uma pessoa e a mesma emulação local. O adaptador anterior permanece como referência da migração; salas da interface principal não criam MediaStreams,
vídeos remotos nem senders RTP.

Base: EmulatorJS 4.2.3 / Snes9x 2.0.2, variante legacy sem threads. Os arquivos
e hashes ficam em `assets/emulation-netplay`. As configurações persistidas do
EmulatorJS são desativadas para impedir diferenças entre aparelhos. O
fingerprint inclui ROM, archive do core e configurações, inclusive Multitap e
áudio não bloqueante. Os arquivos públicos do emulador são pré-carregados em
cache versionado; ROM, autenticação, sinalização e APIs ficam fora desse cache.

O laço automático do Emscripten é cancelado. Antes de chamar APIs nativas, o
adaptador espera a conclusão da inicialização Asyncify: uma retomada pendente
poderia reativar o laço e corromper a pilha se outra exportação fosse chamada.
O áudio usa `audio_sync=false`: a fila de som não pode suspender `retro_run`
quando o contexto está suspenso ou a fila fica cheia. Guardas verificam que
nenhuma operação assíncrona atravessa o avanço de um quadro.

`step` aplica cinco máscaras, chama o verdadeiro `retro_run` e confirma um
incremento do contador nativo, acrescentado à entrada dessa função. Um callback
libretro lê os controles diretamente, sem depender do cache do frontend
RetroArch. O callback de vídeo entrega RGB565 a um canvas 2D local. Snapshots
são serializados/restaurados pelas APIs síncronas libretro, sem a fila de tarefas
de arquivos do frontend. Os saves antigos com envelope RetroArch continuam
aceitos; a nova chave de saves não apaga a anterior.

## Protocolo

`src/lib/netplay` separa armazenamento, fingerprint, DataChannel, lockstep e
sessão. O anfitrião coordena um canal confiável e ordenado com cada convidado.
Redis e os WebSockets existentes só transportam presença, salas e sinalização
RTC; entradas da partida passam pelo DataChannel.

Cada entrada contém época UUID, quadro, posição de controle e máscara de 12
botões. O coordenador valida a posição autenticada e só confirma um quadro
com os comandos das posições ativas. Um controle sem comandos no prazo é desativado e recebe máscara neutra (zero) no commit comum, liberando o avanço dos demais. Entradas futuras válidas reativam a posição no quadro informado. Mensagens antigas,
repetidas, conflitantes, fora de ordem e muito adiantadas são tratadas sem
inventar comandos. A réplica avança somente confirmações contíguas.

O protocolo 3 usa atraso automático por padrão: começa em seis quadros e ajusta o buffer até 24 quadros conforme o RTT e as perdas de prazo dos comandos. O aumento é agendado em um quadro futuro comum; cada jogador preenche apenas suas próprias entradas reais, sem sobrescrever quadros já enviados ou prever comandos remotos. Após dez segundos de latência menor, o buffer é reduzido preservando os comandos já enfileirados. O modo manual oferece de 2 a 24 quadros. Não há rollback. O protocolo procura a taxa
nativa próxima de 60 Hz; uma máquina ou conexão que não acompanhe pode ter seu controle temporariamente inativo. Não existe promessa de latência zero ou de 60 FPS em qualquer
hardware.

O host transfere um snapshot canônico em blocos de 16 KiB, com SHA-256 e ACK da
restauração. Saves, restauração e reinício são sincronizados. A cada 120 quadros,
os participantes comparam SHA-256 dos estados SNES serializados, sem usar a
imagem como prova. A conferência assíncrona não bloqueia uma partida saudável.
Divergências recuperáveis recebem novo snapshot e época; a terceira divergência
pausa todos. A saída de um convidado não pausa os outros. Seu retorno recebe um snapshot individual verificado, seguido dos commits acumulados enquanto o estado era preparado. A réplica recupera o atraso com limite de CPU por ciclo. A perda do coordenador promove um participante preparado, sem alterar slots ou conceder acesso administrativo. WebSocket close, presença expirada ou votação majoritária dos demais participantes preparados podem disparar a troca. Uma breve renegociação reconecta os sobreviventes ao novo coordenador. O encerramento explícito pelo proprietário continua encerrando a sala. Uma posição temporariamente offline não é
atribuída a outra pessoa.

## Validação reproduzível

Arquivos de ROM e checkpoints são privados e não entram no deploy. Os
checkpoints da arena foram obtidos por comandos normais nos menus do jogo;
nenhuma escrita em RAM ou modificação da ROM é usada pelos testes.

- `npm run typecheck` e `npm test` verificam tipos e o protocolo. Os testes de
  sessão cobrem 2/3/4/5 controles, atraso, retransmissão em canal ordenado,
  negociação inicial, divergência/recuperação/pausa e reconexão com novo estado.
- `node scripts/prove-netplay-core.mjs` usa dois contextos Chromium independentes,
  os cinco controles, contador nativo, snapshots idênticos em 1/30/120/300 quadros,
  pausa sem avanço e restauração. `PROBE_FINAL_FRAME=900` amplia a execução.
- `TEST_ROM_PATH=.private/super-bomberman-5.sfc PLAYWRIGHT_BASE_URL=http://localhost:3001 npx playwright test tests/e2e/netplay.spec.ts tests/e2e/netplay-gameplay.spec.ts`
  valida instalação, canal RTC real sem mídia, controles de toque exclusivos e
  simultâneos em salas de 2 a 5 navegadores, estados periódicos e saves.
- `TEST_NETPLAY_RESILIENCE=1` amplia o caso de três participantes com atraso de
  entrega, retransmissão emulada, divergência por carregamento de um save
  legítimo anterior e fechamento/reabertura real dos peers. A entrega retardada
  na aplicação não é uma medição de perda real de UDP na interface de rede.
- `design.spec.ts`, `mobile-site.spec.ts` e `preparation.spec.ts` cobrem navegação,
  layouts móveis, persistência de preferências, pré-cache e exclusão de APIs.

As evidências locais ficam em `.private/netplay/` e anexos Playwright. A execução
em build de produção passou inicialmente oito testes em 2,6 minutos. As amostras
de três contextos ficaram em 57–59 FPS; cinco contextos no mesmo computador em
51–52 FPS, sem correções de divergência na amostra. Esses valores medem vários
emuladores competindo pela mesma máquina, não celulares físicos independentes.
O resultado publicado e a checagem adicional de recuperação devem ser registrados
em `VALIDACAO.md` após executados.

O teste com pessoas em aparelhos e redes externas depende da rodada combinada
com o proprietário. A validação automatizada local não substitui essa etapa.

## Fontes

As APIs e os limites foram conferidos na documentação oficial EmulatorJS e
libretro, no código Snes9x e no driver EmulatorJS/RetroArch. A reprodução dos
binários, fontes correspondentes e licenças está em
`assets/emulation-netplay/README.md`. `kaillera-next` foi consultado apenas como
referência conceitual; nenhum core N64 ou rollback foi tratado como integração
SNES pronta.

## Instalação no aparelho

A tela inicial permite importar e verificar a ROM antes de entrar em uma sala. Ela fica no IndexedDB; o navegador recebe uma solicitação de armazenamento persistente quando suportado. O emulador e imagens públicas são pré-carregados pelo service worker com integridade SHA-256. O manifest permite adicionar o site à tela inicial. Uma recarga restaura o token da sala da sessionStorage e reaproveita a ROM já instalada; o token nunca substitui a autenticação do proprietário. A primeira instalação ainda exige o arquivo em cada aparelho. Limpar dados do navegador apaga a instalação. A partida online requer conexão.

## Foco e continuidade

Perder foco solta somente o próprio controle. Ao ficar em segundo plano, um
coordenador preparado cede para outro participante disponível; um jogador que
retorna só é elegível depois de carregar um estado canônico. Se o coordenador
parar de confirmar quadros sem fechar RTC, as réplicas solicitam eleição após
três segundos sem avanço. A maioria dos outros aparelhos preparados continua
obrigatória. A volta é sincronizada individualmente. A troca de coordenador pode
exigir uma breve renegociação; a interrupção de um convidado não pausa os demais.

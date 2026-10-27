# Arquitetura anterior — histórico

Este documento descreve a versão Remote Play anterior à migração de 27/10/2026. As salas atuais usam emulação local e não transmitem áudio/vídeo. Consulte `NETPLAY.md` e o README principal para uso e instalação atuais.

# Bomberman Online

**Site publicado:** https://bomberman-online.vercel.app

Entre como proprietário com a senha administrativa existente, crie a sala e compartilhe o convite. Os convidados não precisam de conta Vercel.

Aplicação privada Next.js / TypeScript para executar **a ROM original** de Super Bomberman 5 no navegador do proprietário. Os convidados recebem áudio/vídeo WebRTC e enviam estados dos botões por RTCDataChannel. Nenhum convidado precisa receber a ROM.

## Executar nesta máquina

As dependências e os assets oficiais foram instalados durante a implementação. Foi criado um `.env.local` privado e a ROM fornecida foi importada pelo endpoint autenticado. A senha local está em `.private/local-owner-password`, com permissão 0600. Consulte esse arquivo **localmente** para entrar na área do proprietário; não o compartilhe com convidados.

```sh
npm run dev
```

Abra http://localhost:3000. Entre na área do proprietário, crie uma sala, escolha um apelido e compartilhe o código ou link. O convidado entra sem cadastro. Clique em **Iniciar partida** e navegue no próprio jogo até o modo de batalha para configurar dois participantes humanos. A aplicação não modifica os menus japoneses da ROM.

## Instalação nova

Requisitos: Node 22 recomendado (Node 20.19+), npm, navegador moderno com WebAssembly, WebRTC e `captureStream`. Chrome/Chromium é o alvo inicial. Gamepads usam o mapeamento padrão do navegador.

```sh
npm ci
npm run setup:emulator
npm run setup:owner -- '/caminho/da/sua/ROM.sfc'
npm run dev
```

O assistente pede uma senha e gera `.env.local` com scrypt e segredo aleatório de sessão. O argumento da ROM calcula seu SHA-256 autorizado, sem copiar o arquivo para `public/`. O assistente recusa sobrescrever um `.env.local` existente. Importe o arquivo pela área administrativa após entrar. A importação aceita 2 MiB, opcionalmente com cabeçalho de 512 bytes, e confere o hash quando configurado. Mantenha `ROM_SHA256` definido em produção.

`ROM_STORAGE=local` grava em `.private/`, apenas para desenvolvimento. Essa pasta, ROMs, saves, credenciais e artefatos de testes são ignorados pelo Git. Não copie `.private/` para hospedagem pública. O Docker também exclui esses arquivos.

## Armazenamento R2 privado

1. Na sua conta Cloudflare, crie um bucket R2, por exemplo `bomberman-private`.
2. Mantenha **Public Development URL (r2.dev) desabilitado**, sem domínio público e sem regras que publiquem objetos. Não configure CORS público: apenas o servidor acessa R2.
3. Crie credenciais S3 com leitura/escrita de objetos **restritas a esse bucket**.
4. Configure no servidor `ROM_STORAGE=r2`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` e `ROM_SHA256`. Veja `.env.example`.
5. Entre como proprietário e importe a ROM. O objeto tem uma chave fixa, sem listagem exposta. O servidor transmite `/api/rom` após validar o cookie HttpOnly; respostas usam `private, no-store`. Não existem links públicos permanentes nem chaves R2 no frontend.

A criação do bucket e o teste real em R2 exigem as credenciais da sua conta, não fornecidas nesta sessão. A integração S3 está preparada, mas não foi validada contra um bucket real. O acesso a partir de outros computadores funciona após configurar esse armazenamento e a hospedagem; entre como proprietário em cada computador.

## Autenticação e salas

Um único proprietário, senha scrypt, sessão HMAC de 12 horas, cookie HttpOnly / SameSite Strict / Secure em produção. Login tem limite de tentativas. Requisições mutáveis e upgrade WebSocket verificam origem exata. Não configure segredos em variáveis `NEXT_PUBLIC_*`.

Código de sala criptograficamente aleatório de seis caracteres; colisões são verificadas. O servidor atribui P1 ao anfitrião e P2 ao convidado. Somente o proprietário pode criar e iniciar. Participantes só sinalizam com o anfitrião da própria sala. Sinalização é validada com Zod, tamanho e frequência limitados. O código da sala autoriza apenas a entrada na sala. Não concede acesso a `/api/rom` nem à administração.

O convidado recebe um token aleatório de reconexão mantido em memória. A vaga fica reservada por 15 segundos após queda de sinalização. Uma saída explícita libera a vaga imediatamente. A queda do anfitrião encerra a sala. Saves locais são preservados no descarte do emulador quando possível. Atualizar a página do convidado perde o token: espere a vaga liberar e entre novamente.

Localmente, a sinalização usa um servidor **WebSocket Node persistente**. Na Vercel, `/signal` usa WebSockets nativos com Upstash Redis para salas e eventos entre instâncias. Isso possibilita execução local sem credenciais externas e mantém atribuição/permissões em um único serviço autoritativo. Não foi adotado PostgreSQL/Supabase: não há tabelas nem políticas RLS a configurar. Com `ROOM_BACKEND=memory`, as salas são efêmeras e exigem uma réplica Node. Com `ROOM_BACKEND=redis`, usam estado compartilhado, atualizações atômicas por versão, Redis Streams com destinatário validado e TTL de seis horas. As conexões WebSocket podem ser renovadas preservando os peers WebRTC; a retomada do anfitrião exige também seu cookie administrativo. Uma ausência de 45 segundos expira a presença.

Os limites usam o IP do socket, sem confiar em `X-Forwarded-For` enviado pelo cliente. Atrás de proxy todos podem compartilhar o mesmo limite: para este uso privado isso é deliberado. Para escala maior, configure uma cadeia de proxy confiável e limites na borda.

## STUN, TURN e internet

`STUN_URL` define o STUN inicial. STUN não garante conexão por CGNAT ou NAT restritivo. Configure um coturn acessível ou serviço TURN compatível com TURN REST:

```dotenv
TURN_URLS=turn:turn.seudominio.com:3478?transport=udp,turns:turn.seudominio.com:5349?transport=tcp
TURN_SHARED_SECRET=um_segredo_aleatorio_compartilhado_com_o_coturn
```

O segredo fica no servidor. `/api/ice` exige proprietário ou token de participante conectado e emite username/credential HMAC-SHA1 temporários, válidos por uma hora. Credenciais TURN de curta duração precisam chegar ao navegador para negociar a mídia; as chaves permanentes R2 e o segredo compartilhado nunca chegam.

`docs/turnserver.conf.example` oferece a base de coturn. Configure certificado válido para `turns`, IP externo e firewall UDP/TCP conforme sua rede. O WebRTC tenta conexão direta e usa relay quando necessário. O diagnóstico na lista de participantes mostra RTT e tipos ICE, incluindo `relay`. Não expõe IPs na interface. Uma rede corporativa pode exigir TURN/TLS na porta 443; isso requer infraestrutura própria.

Sem TURN disponível, haverá redes em que a sessão não conecta. RTT, upload do anfitrião, perda de pacotes e desempenho do computador afetam a resposta. Cada convidado adiciona uma transmissão ao upload do anfitrião. O modo econômico reduz fps, bitrate e resolução. R2, hospedagem e principalmente tráfego TURN podem ter custo; verifique os limites da sua conta antes do deploy.

## Hospedar

A Vercel oferece WebSockets nativos e esta versão usa `@vercel/functions` em `/signal`, com estado compartilhado no Redis. Configure `ROOM_BACKEND=redis` e conecte Upstash no plano gratuito, com upgrade automático desativado. Use `ROM_STORAGE=vercel-blob` e um Blob **privado** conectado ao projeto; R2 continua disponível como alternativa. Referência atual: https://vercel.com/docs/functions/websockets .

O projeto está vinculado a `bomberman-online`, na conta Vercel do proprietário. O Redis `bomberman-rooms` e o Blob privado `bomberman-private` foram provisionados. As variáveis administrativas de produção foram enviadas como segredos após aprovação explícita do proprietário. O deploy de produção está pronto e os testes de navegador foram executados no domínio publicado. O script `scripts/configure-vercel.mjs` mantém os valores em stdin e não os imprime. `.vercelignore` exclui ROM, `.private`, arquivos de ambiente e artefatos de testes. O build remoto baixa somente os assets oficiais do emulador.

O deploy Vercel usa `vercel.json`; execute o CLI autenticado com `vercel --prod`. Defina `OWNER_PASSWORD_HASH`, `SESSION_SECRET`, `ROM_SHA256`, `APP_ORIGIN`, `MAX_PLAYERS=5` e `STUN_URL`. As integrações adicionam as credenciais do Redis/Blob. As variáveis automáticas `VERCEL_URL` e `VERCEL_PROJECT_PRODUCTION_URL` são aceitas na verificação de origem. A ROM é obtida do Blob pelo endpoint autenticado `/api/rom`, nunca por um URL público.

Uma opção alternativa é um servidor Node contínuo com WebSocket: VPS, container ou equivalente:

```sh
npm ci
npm run setup:emulator
npm run build
# Configure as variáveis reais no ambiente da hospedagem:
npm start
```

Em produção configure `APP_ORIGIN=https://seu.dominio` e R2. O servidor recusa HTTP em produção e armazenamento local. Um reverse proxy termina TLS e encaminha HTTP/WebSocket para a porta 3000. Há um exemplo em `docs/Caddyfile`. Libere apenas as portas necessárias; nunca sirva a pasta inteira do projeto por um servidor estático.

O `Dockerfile` monta a aplicação sem credenciais nem ROM. Configure variáveis em runtime, fora da imagem. No deploy Vercel, o frontend e a sinalização usam Functions, e a ROM usa o Blob privado. TURN continua opcional e requer credenciais próprias para redes que não permitem conexão direta.

## Emulador, captura e controles

EmulatorJS **4.2.3** fixado, core `snes9x`, arquivos oficiais hospedados em `public/emulatorjs/` após `setup:emulator`. O instalador inclui o fallback legacy, descompactador 7z, idioma português e hashes SHA-256 fixados em `scripts/emulator-assets.lock.json`. Divergências interrompem a instalação. Não baixa jogos.

O adaptador isolado é `public/emulator.html`, em um iframe same-origin. O iframe facilita descarte real de WASM, Web Audio e listeners ao sair. Métodos conferidos no código da versão: `gameManager.simulateInput(player,index,value)`, `getState()`, `loadState()`, `restart()`, `setVolume()` e `collectScreenRecordingMediaTracks(canvas,fps)`.

A captura combina `canvas.captureStream` com um barramento Web Audio persistente ligado a `MediaStreamDestination`. A inspeção de `Module.AL.currentCtx` fornece o contexto real do core. A captura padrão 4.2.3 mantém referências antigas quando OpenAL recria fontes; o adaptador intercepta conexões à saída do contexto antes do loader, encaminhando-as a um barramento que preserva tanto o som local quanto a transmissão. A interceptação fica confinada ao iframe. O teste mede energia no áudio decodificado pelo convidado. Nenhum acesso a câmera, microfone ou compartilhamento de desktop. O navegador pode exigir um clique para ativar áudio; o convidado tem esse botão. A transmissão aguarda uma faixa de áudio válida em vez de anunciar sessão apenas com canvas.

Os índices libretro são B=0, Y=1, Select=2, Start=3, cima=4, baixo=5, esquerda=6, direita=7, A=8, X=9, L=10, R=11. Teclado, toque e Gamepad API compartilham uma única rotina de entrada, sem os handlers nativos duplicados do EmulatorJS. O teclado dentro do iframe é encaminhado para essa rotina, que chama diretamente o core.

O pacote remoto contém somente conjunto de botões e sequência crescente. O anfitrião define o índice do jogador a partir do participante autenticado, nunca de um campo fornecido pelo convidado. Hotkeys administrativas do core (24+) são recusadas. O DataChannel é sem ordenação e sem retransmissão; o estado completo é reenviado a cada 100 ms, para recuperar solturas perdidas. Ao perder foco, desconectar ou ficar 700 ms sem atualização, as teclas são liberadas.

`MAX_PLAYERS` é 5 por padrão: um anfitrião e quatro convidados. O adaptador configura Joypad na porta 1 e Multitap na porta 2 (`input_libretro_device_p2 = "257"`) antes de inicializar o core. Cada convidado mantém seu próprio slot. No modo Battle Game, configure os cinco participantes como humanos no menu do jogo. O quinto controle usa o índice 4 do core. A validação de uma rodada completa com cinco pessoas continua sendo humana. Após atualizar a aplicação, crie uma sala nova para usar as cinco vagas; salas anteriores preservam a capacidade com que foram criadas.

## Perfis da turma

Ao criar ou entrar em uma sala, escolha **Matheus, Gabi, Helo ou Gu**. As fotos de Matheus, Gabi e Gu são as imagens originais fornecidas pelo proprietário; Helo usa sua inicial até a foto ser enviada. O nome continua editável. A sala mostra a foto e o número de controle de cada participante, e preserva a foto na reconexão. Nomes repetidos na mesma sala são recusados.

**Adicionar pessoa** permite cadastrar nome e foto opcional (JPG, PNG ou WebP de até 8 MB). O navegador prepara uma versão pequena para transmitir à sala. Esses perfis adicionais ficam salvos neste navegador e sua foto é compartilhada com os participantes quando você entra; eles não formam um cadastro global sincronizado. Os avatares recebidos são validados e não podem carregar imagens externas nem SVG.

Selecionar Matheus ou qualquer outro perfil é apenas escolher um apelido e uma foto: não concede acesso de proprietário. As permissões administrativas continuam dependendo do login.

O logo do cabeçalho, da tela inicial e do ícone do site usa a imagem do Bomberman enviada pelo proprietário. Os arquivos de perfil ficam em `public/avatars/`, e a lista inicial está em `src/lib/profiles.ts`.

## Jogar no celular

Abra o link da sala no navegador do celular, escolha um apelido e entre normalmente. Durante a partida, os controles de toque aparecem automaticamente: direcional com diagonais, A/B/X/Y, L/R, Start e Select. Também funcionam no modo solo e para o anfitrião.

Você pode segurar uma direção com um dedo e apertar ações com outro, arrastar o dedo entre as direções e combinar botões. Soltar um dedo não libera os comandos de outro. Ao interromper um toque, trocar de aba ou girar a tela, os botões são liberados para evitar comandos presos. Teclado, controle físico e toque são combinados na mesma entrada; o jogador continua usando apenas seu próprio slot no multiplayer.

Use **Tela cheia** e gire o aparelho para jogar na horizontal: a imagem fica ao centro, com controles nas laterais e um botão para sair. No modo vertical, os controles aparecem abaixo da imagem. Se o navegador não oferecer tela cheia, a página continua utilizável. Se necessário, toque em **Ativar áudio**.

Em **Configurações → Controle na tela**, escolha Automático no celular, Sempre mostrar ou Ocultar. A preferência fica salva neste navegador. O layout respeita áreas seguras da tela e mantém os controles com alvos de toque de pelo menos 44 px.

Os testes automatizados usam Chromium com viewport móvel e eventos multitoque reais do protocolo de automação. Eles verificam o controle remoto P2 no core original, diagonais + ação, arraste, soltura independente, dois dedos no mesmo botão, cancelamento e tela cheia horizontal. A validação em aparelhos físicos continua dependendo de teste no dispositivo.

## Saves

Save state manual em IndexedDB (`bomber.snes9x.4.2.3`), exclusivo da instância do proprietário. O descarte tenta salvar o estado antes de destruir o iframe. Saves de bateria do EmulatorJS usam seu próprio IndexedDB. Os dados ficam no navegador de cada computador; não são sincronizados no R2. Limpar dados do site apaga saves. Falha abrupta/crash pode impedir o salvamento final; use o botão Salvar progresso regularmente. Não há comandos administrativos no canal do convidado.

## Testes

```sh
npm run typecheck
npm test
# Instale Chromium caso necessário:
npx playwright install chromium
# Com npm run dev aberto e a senha local em .private/local-owner-password:
TEST_ROM_PATH='/caminho/da/sua/ROM.sfc' npm run test:e2e
```

O teste com ROM é ignorado se `TEST_ROM_PATH` não estiver definido. Em outra instalação, defina a senha de teste em `.private/local-owner-password` (não versionado) ou ajuste o helper para sua sessão. Nunca coloque a senha no teste versionado.

Unitários cobrem permissões, atribuição/liberação de vagas, reconexão, sinais fora da sala, validação de pacotes, combinações simultâneas e soltura por timeout. Playwright usa dois contextos independentes e o core real: importação, ROM negada ao convidado, sala inválida/válida, slots, faixas de áudio/vídeo, injeção no core P2, saves e encerramento; outro fluxo cobre remapeamento e viewport móvel. Não são testes com jogadores simulados na interface.

O utilitário `scripts/probe-emulator.mjs` executa uma inspeção local do core e salva imagem/estado em `.private/`. Aceita comandos `botao:duracaoMs:indiceJogador`, `--restore` e `PROBE_WAIT_MS`. É ferramenta de desenvolvimento, não funcionalidade pública.

Para o backend distribuído, `TEST_REDIS=1 npm test` usa o serviço real com chaves temporárias isoladas, carregando `.private/vercel-development.env`. Para testar um deploy, defina `PLAYWRIGHT_BASE_URL` e `TEST_DISTRIBUTED=1`. Resultados e limites efetivamente observados estão em `docs/VALIDACAO.md`. A aceitação final exige também uma partida humana com dois computadores em redes diferentes; contextos locais não comprovam NAT/CGNAT, áudio audível nos alto-falantes ou uma partida humana completa.

## Organização

- `server.ts`: HTTP Next e upgrade da sinalização WebSocket.
- `src/lib/server/`: sessão do proprietário, limites, armazenamento e salas autoritativas.
- `src/lib/protocol.ts`: contratos e validação Zod.
- `src/lib/emulation/`: adaptador de emulação; `public/emulator.html` inicializa a versão fixa.
- `src/lib/remote/`: captura/negociação WebRTC, RTCDataChannel e entradas.
- `src/components/useSession.ts`: ciclo de sala, mídia, reconexão e descarte.
- `src/components/Console.tsx`: interface e operações do proprietário.
- `src/app/api/`: endpoints autenticados de sessão, ROM e ICE.

## Fontes e licenças

Consulte `docs/THIRD_PARTY.md` para licenças e referências oficiais. Não foi copiado código do Netcade. Super Bomberman 5 e suas marcas pertencem aos respectivos titulares. A ROM fornecida não acompanha o código nem a imagem Docker.

## Fluidez e preparação dos celulares

A captura nativa do canvas WebGL é compartilhada entre os quatro convidados; cada sender reduz a imagem para caber em **384 × 288**, preservando a proporção e acompanhando mudanças de tamanho da tela do anfitrião. A captura evita uma cópia 2D por quadro, que podia enviar imagens pretas de forma intermitente. Cada conexão começa em até **320 kbps / 30 fps**, pode chegar a **550 kbps / 60 fps** após estabilidade sustentada e reduz para **180 kbps / 24 fps** sob perda, atraso, upload insuficiente ou sobrecarga de codificação. São limites máximos; a taxa real é controlada pelo navegador. O áudio tem teto de 48 kbps por convidado. Os codecs H.264 Baseline e VP8 têm preferência, mantendo os fallbacks do navegador. O anfitrião pode ativar a economia durante a partida. Estatísticas da conexão mostram a taxa de quadros; uma reconexão ICE automática limitada tenta recuperar quedas do transporte. Os comandos continuam independentes do vídeo e reenviam o estado completo a cada 50 ms.

Ao abrir o site, um service worker baixa os arquivos públicos com no máximo duas transferências simultâneas. O proprietário prepara também o emulador e a ROM antes de iniciar. A ROM fica somente na memória da página e nunca entra no cache público. A superfície de jogo recebe essa cópia privada diretamente. O indicador **Arquivos prontos para jogar** confirma a preparação; downloads de preparação são pausados durante a partida. O cache valida SHA-256, identifica a versão e reaproveita arquivos nas próximas visitas. HTML, APIs, autenticação, sinalização e ROMs não são interceptados pelo service worker. Atualizações são detectadas ao voltar à página e periodicamente fora da partida; uma sala ativa recebe aviso e a atualização ocorre depois de sair, sem recarregar o jogo em andamento. A preparação melhora a abertura, mas vídeo e comandos continuam dependendo de conexão ao vivo e do anfitrião ativo.

`npm run build` gera `public/sw.js` e `public/client-assets.json` antes da compilação, com os recursos públicos estáveis. Chunks e fontes do Next usam o cache HTTP pelos seus nomes de conteúdo, sem entrar na lista do service worker. Não edite os gerados; altere `scripts/service-worker.js` e `scripts/prepare-client.mjs`. `npm run dev` usa a mesma lista de recursos estáveis. `TEST_PERFORMANCE=1` habilita um teste adicional com cinco contextos, estatísticas reais, continuidade dos quadros, limite de transmissão e economia durante o jogo. Os relatórios brutos ficam nos anexos do Playwright. O teste `preparation.spec.ts` valida cache offline dos arquivos e exclusão das APIs.

Referências das opções de mídia: [WebRTC — W3C](https://w3c.github.io/webrtc-pc/) e [Content Hints — W3C](https://w3c.github.io/mst-content-hint/).

Os controles de celular enviam toque e teclado imediatamente, sem esperar um quadro de animação. A leitura contínua por quadro fica restrita a controles físicos conectados e só existe dentro da sessão. O direcional aceita arraste contínuo, oito direções e um centro neutro; cada dedo mantém seus próprios botões. Há tamanhos Padrão e Grande nas configurações. As áreas de toque têm pelo menos 44 px, com ajustes para telas pequenas e paisagem. O modo expandido funciona também sem a API nativa de fullscreen e mantém áudio e saída acessíveis. Formulários usam feedback dentro da janela, sem avisos cobrindo os campos.

`npm run prepare:images` gera miniaturas das fotos e versões leves do logo em `public/optimized/`, sem alterar os originais. São aproximadamente 54 KB, contra 2,57 MB dos PNGs originais. O pré-cache usa essas versões. A geração ocorre automaticamente antes de desenvolvimento e build, usando [sharp](https://sharp.pixelplumbing.com/api-resize/). O servidor Node local separa upgrades de WebSocket do jogo e do Next para a rota `/signal` não encerrar a conexão local.

## Interface neon de referência

O início foi redesenhado a partir da referência fornecida: cabeçalho com Jogar, Salas e Configurações; estados reais da sinalização e da preparação; composição em duas colunas; moldura de console feita em CSS; convite de exemplo identificado; quatro cartões e passos de Como funciona. O painel Salas abre os fluxos privados existentes e, com sala ativa, mostra seu código real, participantes conectados e cópia do convite. A capacidade continua sendo de **cinco pessoas**, conforme a configuração funcional anterior.

`src/app/redesign.css` centraliza os tokens e a apresentação visual. A fonte Inter é local e os ícones usam imports individuais de Lucide React. A arte do painel fica em `assets/design/` e é comprimida no build para `public/optimized/`. Originais, prompts e detalhes estão em `docs/design/ARTES.md`; capturas em 1672, 1440, 1024, 768 e 390 px ficam em `docs/design/screenshots/`. Efeitos de cenário e composição decorativa são desativados durante a partida, que conserva a área de renderização testada anteriormente. Autenticação, salas, Redis, Blob, WebRTC, ROM e saves usam as mesmas implementações e variáveis.

O worker pré-carrega somente imagens públicas otimizadas e arquivos fixados do emulador. Não enumera `.next/static`, pois caches de build podem conter chunks antigos não publicados; os próprios nomes imutáveis de conteúdo do Next já cuidam do cache de código e fonte. A lista é gerada antes do build, quando esses arquivos públicos já existem.

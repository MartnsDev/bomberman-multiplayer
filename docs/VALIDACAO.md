# Validação técnica — 25/10/2026 (America/Sao_Paulo)

A implementação foi executada com a ROM de 2.097.152 bytes fornecida pelo proprietário. Nenhum jogo foi obtido de terceiros. Os testes usam o core Snes9x WebAssembly real do EmulatorJS 4.2.3, sem emulador falso ou jogo refeito.

## Evidências observadas

- O core exibiu o logotipo Hudson, o título Super Bomberman 5 e uma fase original. Capturas e estados de diagnóstico permanecem apenas em `.private/`, ignorados pelo Git.
- `npm run build`: passou (Next.js 16.4.3, build de produção).
- `npm run setup:emulator`: passou, incluindo verificação dos hashes fixados.
- `npm run typecheck`: passou.
- `npm test`: **7 testes passaram**, cobrindo salas, papéis, slots, reconexão, liberação de vagas, sinalização indevida, combinações de botões, timeout de soltura, senha/cookie, limites e validação da ROM.
- Playwright com a ROM fornecida: **2 testes passaram**. Dois contextos independentes, um proprietário e um convidado; importação autenticada, ROM negada ao convidado (401), código inválido recusado, entrada válida, atribuição P1/P2, transmissão e controles.
- O convidado recebeu vídeo com dimensões válidas e **pixels decodificados não pretos**, além de áudio com **energia superior a 0,001** analisada por Web Audio. A simples presença de faixas não foi aceita como prova de mídia funcional.
- Entradas simultâneas direita + A originadas no teclado do convidado chegaram a `gameManager.simulateInput(1,...)`, preservando a chamada real ao WASM. Não apareceram pressionamentos no índice 0. Keyup e perda de foco liberaram os botões.
- A reconexão refez oferta/resposta e recebeu um novo objeto de faixa de vídeo, preservando o slot 2. O ID de uma faixa pode permanecer igual por vir da mesma fonte do anfitrião; o teste compara identidade de objetos.
- Save state foi salvo em IndexedDB e aceito para restauração. Encerrar a sala notificou o convidado; uma nova sala pôde ser criada em seguida.
- O convidado não requisitou `/api/rom`, `/emulator.html` ou assets do core. Apenas o anfitrião baixou a ROM do endpoint autenticado.
- Remapeamento de teclas persistiu e o viewport de 390 px não apresentou overflow horizontal.

## Problemas encontrados e corrigidos

- Assets adicionais do core: fallback legacy e descompactador 7z não estavam no primeiro conjunto de arquivos. O instalador agora inclui ambos, com checksums fixos.
- Login concorrente com a consulta inicial de sessão e socket aberto antes da autenticação. A consulta não sobrescreve o login bem-sucedido; o socket é renovado após entrar.
- Eventos de teclado dentro do iframe e foco retido em botões. A aplicação mantém uma única rotina e encaminha o teclado do iframe para injeção direta no core.
- Tratamento duplicado do WebSocket de HMR do Next causava recarregamentos em desenvolvimento. O servidor deixa esse caminho ao handler do Next.
- A captura padrão do EmulatorJS gerava uma faixa silenciosa após recriação das fontes OpenAL. O adaptador usa um barramento persistente na saída real do contexto, preservando o áudio local e o remoto. A correção foi validada medindo o sinal no convidado.

## Limites da comprovação

A validação automatizada inicial **não comprovava sozinha o critério de uma partida humana pela internet**. Posteriormente, o proprietário informou nesta conversa que o multiplayer está funcionando. Essa confirmação é do proprietário; os testes automatizados descritos aqui continuam locais. Os dois contextos rodaram no mesmo computador. A entrega de comandos ao índice 1 do core está comprovada por automação; a confirmação de multiplayer jogável foi relatada pelo proprietário, e não inferida apenas da presença na sala ou da injeção de botões.

Não foram validados independentemente pela automação desta sessão: duas máquinas em redes externas diferentes, CGNAT real, fallback TURN, bucket R2 real, deploy público, controles USB/Bluetooth físicos, dispositivos móveis reais e Multitap/P3/P4/P5. Autoplay audível nos alto-falantes pode exigir o botão Ativar áudio; medição do sinal decodificado não substitui escuta humana.

Saves são locais por navegador e não sincronizados entre computadores. Reinício do servidor apaga salas em memória, preservando o armazenamento privado da ROM e os saves locais. Esta versão usa uma réplica Node; não suporta múltiplas réplicas sem backend compartilhado.

## Roteiro de validação externa

1. Configurar hospedagem HTTPS/WSS, R2 privado e TURN com credenciais temporárias.
2. Em dois computadores em redes diferentes, entrar como proprietário/convidado e iniciar Battle Game.
3. Configurar dois humanos nos menus da ROM. Verificar visualmente que cada teclado/controle movimenta seu próprio personagem, solta botões ao perder foco e coloca bombas simultaneamente.
4. Ouvir o áudio em ambos os computadores, conferir imagem contínua e diagnóstico ICE/RTT. Forçar TURN em uma sessão de diagnóstico quando necessário.
5. Jogar uma rodada inteira; testar reconexão, saída, encerramento e uma nova sessão.

## Atualização: controles para celular

O proprietário confirmou que o multiplayer está funcionando. O transporte WebRTC e a atribuição de slots foram mantidos; os controles móveis entram na mesma rotina usada por teclado e gamepad.

O Playwright passou com um anfitrião e um convidado em contexto móvel (390 × 844, toque habilitado), usando a ROM real. Verificou diagonais + ação simultâneas no slot P2, arraste entre direções, soltura de um dedo mantendo o outro pressionado, dois dedos no mesmo botão e cancelamento. Na horizontal (844 × 390), confirmou tela cheia com controles dentro do viewport, saída da tela cheia e ausência de overflow ao voltar à vertical. Os fluxos de vídeo, áudio, teclado, perda de foco, reconexão, saves e nova sala também passaram.

Captura de inspeção: `test-results/mobile-landscape.png` (ignorada pelo Git). Não houve teste em aparelho físico nesta sessão.

## Atualização: turma, fotos e quatro participantes

Foram cadastrados Matheus, Gabi, Helo e Gu. As fotos originais fornecidas foram associadas a Gu (primeira), Gabi (segunda) e Matheus (terceira). As repetições da foto de Matheus não foram atribuídas à Helo, que usa a inicial H enquanto sua foto não é enviada. O logo usa o arquivo do Bomberman fornecido.

A sala passa a usar capacidade padrão de quatro. O adaptador configura Joypad na porta 1, Multitap na porta 2 (dispositivo 257) e quatro usuários antes de iniciar o core. A escolha de perfil compartilha nome/foto com a sala, preserva a identidade na reconexão e recusa nomes duplicados. Perfis adicionais são cadastrados no navegador, com foto opcional; não concedem privilégios administrativos.

`npm test`: **9 testes passaram**. `npm run typecheck`: passou. Playwright: **3 testes passaram**, incluindo quatro contextos independentes (um móvel), seleção dos quatro perfis, três fotos originais e o avatar provisório da Helo. O teste verificou a configuração Multitap gravada no core real, vídeo nos convidados e comandos isolados para os slots P2, P3 e P4. Também verificou criação de perfil adicional com foto e persistência após recarregar, além de manter os testes de toque, áudio, reconexão e saves. A rodada completa com quatro personagens dentro do jogo não foi validada manualmente nesta sessão.

## Deploy Vercel — produção

URL pública: https://bomberman-online.vercel.app

Deploy validado: `dpl_75JXyksHsaLzPQUrP3WRYEbBvgTA`, estado READY. Build remoto da Vercel passou. Foi provisionado Upstash Redis no plano gratuito, com upgrade automático desativado, e Vercel Blob **privado** para a ROM. A transferência do hash administrativo e do segredo de sessão foi aprovada explicitamente pelo proprietário; esses valores não estão no frontend ou no pacote público. `.private`, ROMs e arquivos de ambiente foram excluídos do upload de fonte.

A sinalização usa WebSockets nativos da Vercel em `/signal`, Redis com atualização atômica por versão e Streams para entrega por destinatário. As reconexões preservam os peers WebRTC; a retomada do anfitrião exige seu cookie administrativo, além do token de sala. A configuração anterior, somente em memória, permanece para execução local.

`TEST_REDIS=1 npm test`: **10 testes passaram**, incluindo Redis real com chaves temporárias isoladas, três entradas simultâneas, slots distintos, eventos entre duas instâncias, isolamento da sinalização, retomada do anfitrião e encerramento. A auditoria npm após atualizar as dependências não reportou vulnerabilidades.

Playwright apontado para **o endereço público**, com `TEST_DISTRIBUTED=1`: **3 testes passaram**. Incluem login real, upload privado da ROM fornecida, quatro contextos de navegador, perfis/fotos, convidado móvel com multitoque, pixels de vídeo e energia de áudio decodificados, comandos P2/P3/P4 isolados, reconexão do convidado e do anfitrião preservando o emulador, saves, encerramento e nova sala. Os testes usam o jogo e o core reais, mas continuam sendo contextos no mesmo computador, sem uma rodada humana em quatro redes distintas.

Verificações anônimas no domínio: `/` = 200, `/api/auth` = 200, `/api/rom` = 401, `/.env.local` = 404. O acesso público de produção não exige login Vercel. A ROM continua acessível somente ao proprietário autenticado. TURN não foi configurado; redes que bloqueiam conexões diretas ainda podem exigir esse serviço.

## Correção: cinco jogadores no total — 26/10/2026

O limite foi alterado para **5 participantes: anfitrião + 4 convidados**. O mesmo limite é usado nos backends local e Redis, na configuração de produção `MAX_PLAYERS=5`, na liberação de entradas e no `input_max_users = "5"` do core, mantendo Multitap na porta 2. O quinto controle recebe o índice 4 e uma sexta pessoa é recusada. Salas anteriores preservam sua capacidade original: encerre a sala antiga, atualize o site e crie uma nova.

`npm run typecheck`: passou. `TEST_REDIS=1 npm test`: **12 testes passaram**, incluindo quatro entradas simultâneas no Redis, cinco slots distintos, recusa da sexta pessoa e reutilização da quinta vaga após saída. Build remoto Vercel passou; deploy `dpl_8v8SqTxpBMsL4NeijZ2kwvLfnt5G` em READY, publicado em https://bomberman-online.vercel.app .

Playwright executado no domínio de produção: **3 testes passaram**, incluindo cinco contextos de navegador, indicador `5/5`, configuração do core para cinco usuários, transmissão para o quinto convidado e comandos exclusivos no índice 4, além dos fluxos de toque, áudio, reconexão, saves e encerramento. A validação de uma rodada humana com cinco personagens permanece manual.

## Otimização dos celulares e pré-carregamento — 26/10/2026

Publicado em https://bomberman-online.vercel.app, deploy `dpl_9jk4iCoFb27atTeaeH8zaNc3mK99` (READY). Build remoto Turbopack e geração dos arquivos de preparação passaram. Build local com webpack também passou; o Turbopack local encontrou restrição do sandbox ao abrir uma porta auxiliar. `npm run typecheck` passou; `npm test`: **18 testes passaram**, um Redis opt-in ignorado. Os novos testes cobrem adaptação sob perda/atraso/upload/CPU, recuperação sem oscilação, economia em andamento, integridade SHA-256, concorrência de downloads, cache offline e exclusão das APIs privadas.

A medição anterior, com quatro convidados, encontrou canvas do anfitrião de **871 × 538** e limite de vídeo de **2 Mbps por convidado**. Na amostra, os convidados decodificavam aproximadamente 21–22 fps. A atualização usa uma superfície compartilhada de **384 × 288**, recortada segundo a proporção de vídeo do core, e começa com teto de **320 kbps / 30 fps** por convidado. Pode subir a 550 kbps / 60 fps em conexão estável, ou reduzir a 180 kbps / 24 fps. Os tetos são aplicados aos encodings negociados; o áudio tem teto de 48 kbps. Há preferência H.264 Baseline/VP8 e target curto de jitter buffer quando suportado. O controle reenvia seu estado a cada 50 ms; a recuperação ICE limitada aceita nova negociação sem reiniciar o core.

Playwright no domínio de produção: **5 testes passaram em 51,2 s**. O teste de desempenho abriu cinco contextos, confirmou quatro vídeos de 384 × 288, limites de 320 kbps / 30 fps aplicados e aproximadamente **27 fps** decodificados na amostra, sem novas ocorrências de freeze reportadas naquele intervalo. Depois, ativou economia durante o jogo e confirmou os quatro senders em 180 kbps com continuidade dos quadros. Os dados completos estão nos anexos `media-statistics` do Playwright. Esses números são amostras de navegadores no mesmo computador; não garantem desempenho idêntico em celulares físicos ou outras redes.

O proprietário recebeu a ROM em memória antes da partida; o cache continha o core e nenhum endpoint privado. Um convidado preparou arquivos públicos, reutilizou uma foto com a rede offline e não recebeu ROM/emulador nem cache de APIs. O teste confirmou que a primeira instalação não mostra aviso de nova versão. A interface exige preparação antes de entrar/criar e iniciar, pausa downloads de preparação durante a partida e mantém a atualização de uma sala ativa pendente até sair. Os testes existentes confirmaram pixels reais e áudio decodificado, cinco controles independentes, multitoque, tela cheia, reconexão da sinalização, saves e encerramento.

A tentativa de E2E na instância local isolada não conseguiu manter a sinalização: a rota `/signal` do Next também é reconhecida por seu listener de upgrade no servidor de desenvolvimento. A verificação completa acima foi feita no backend Redis e WebSockets nativos da Vercel, onde os cinco testes passaram. A instância isolada de teste na porta 3001 foi encerrada. O servidor original do usuário não foi interrompido.

Para receber a otimização em todos os dispositivos, encerre a sala anterior, atualize o site em cada navegador, aguarde **Arquivos prontos para jogar** e crie uma nova sala. O pré-carregamento elimina transferências de preparação durante a partida, mas a mídia continua ao vivo e depende do upload do anfitrião, da rede dos convidados e da capacidade dos dispositivos.

## Revisão dos controles móveis e do site — 26/10/2026

Publicado em https://bomberman-online.vercel.app, deploy `dpl_BAkwm9HnWUajbhUHc4fneLwX4n6X` (READY). Build remoto passou, incluindo geração de imagens e do cache com 16 arquivos públicos e oito arquivos do emulador. `npm run typecheck` passou; `npm test`: **23 testes passaram**, um teste Redis opt-in ignorado.

Toque e teclado agora enviam alterações imediatamente, sem depender de `requestAnimationFrame`. O polling por quadro só inicia com um controle físico conectado e dentro da sessão. O direcional usa oito setores, centro neutro e captura do dedo para continuar respondendo entre botões e fora da borda; combinações e solturas de dedos continuam independentes. As configurações incluem tamanhos Padrão e Grande persistidos no navegador. Os testes confirmaram alvos de pelo menos 44 px (com tolerância à precisão fracionária das coordenadas), liberação em cancelamento/perda de foco e ausência de polling ocioso. As estatísticas dos peers são atualizadas em lote, evitando quatro renderizações de interface por rodada de coleta.

O modo expandido funciona sem suporte à API nativa de tela cheia, com saída e áudio acessíveis no topo. Foram corrigidos extravasamento horizontal em celular pequeno e a altura de Start/Select em paisagem. Avisos aparecem dentro dos formulários quando há uma janela aberta; botões de navegação e perfil ganharam área de toque maior. A preparação pendente aparece no formulário, e a seleção de perfil não abre o teclado automaticamente. A detecção de atualização também passa a acompanhar a troca do primeiro controlador durante a mesma visita.

Fotos e logos da interface passaram de **2.572.048 bytes para 55.196 bytes** (redução de **97,85%**), com originais preservados. As versões de exibição são geradas por sharp antes do build e são usadas tanto na interface quanto no pré-cache; a identidade de perfil no protocolo mantém os caminhos anteriores. O cache continua excluindo ROM, autenticação e demais APIs privadas.

A revisão encontrou uma falha intermitente na cópia 2D da imagem WebGL. Ela foi removida: a captura nativa é compartilhada, e cada sender aplica `scaleResolutionDownBy` para caber em 384 × 288, preservando a proporção. A escala é recalculada nas coletas quando o tamanho da origem muda. Na amostra de produção, origem 871 × 538 e quatro vídeos de **384 × 236**, com **26–29 fps** decodificados e sem novas ocorrências de freeze no intervalo observado. Foram confirmados os tetos de 320 kbps/30 fps, e o modo econômico alterou os quatro senders em andamento para 180 kbps. Os números são amostras de cinco contextos no mesmo computador, sem comprovação de desempenho idêntico em aparelhos físicos e redes distintas.

Playwright no domínio de produção: **seis testes passaram em 52,2 s**. Cobriram nove viewports (320×568, 360×740, 390×844, 412×915, 568×320, 667×375, 844×390, 768×1024 e 1440×900), início/perfis/formulários/configurações, persistência de preferências, cache offline, cinco participantes, mídia e áudio reais, comandos exclusivos nos cinco controles, diagonais/arraste fora da borda/centro neutro, dois dedos no mesmo botão, cancelamento, tela cheia nativa e alternativa, botões grandes, áudio no modo expandido, reconexão, saves e encerramento. Há capturas `mobile-home-reviewed.png`, `mobile-game-large-controls.png`, `mobile-landscape.png`, `guest-real-video.png` e `profile-picker-mobile.png` em `test-results/`.

A conexão do servidor Node local também foi corrigida: o listener do Next recebe apenas upgrades do framework; `/signal` fica exclusivamente com o servidor do jogo. A revisão local com cinco participantes e o core real passou (cinco testes). A instância isolada na porta 3001 foi encerrada; o servidor original do usuário não foi interrompido. O plugin de navegador não tinha nenhuma instância conectada nesta sessão; a revisão visual e funcional foi feita por Playwright isolado e inspeção das capturas locais.

## Redesign neon de referência — 26/10/2026

Publicado no deploy `dpl_576tPsQGRNVBK9Mhkm8rvoyecVkz`. Compilação local de produção e build remoto passaram; 23 testes unitários e sete testes Playwright no domínio de produção passaram. Capturas comparadas com a referência em 1672 × 941, 1440, 1024, 768 e 390 px. O relatório completo, incluindo comparação visual, preservação dos fluxos, correção da lista de pré-cache e limites da medição de desempenho, está em `docs/design/VALIDACAO.md`. Artes e prompts em `docs/design/ARTES.md`.

## Netplay local e terceiro jogador — 27/10/2026

A interface principal passou a executar Snes9x localmente em todos os aparelhos,
com DataChannels confiáveis e ordenados para entradas/snapshots. Não há vídeo
ou áudio remoto nas novas salas. A implementação está detalhada em `NETPLAY.md`.
O core fixado é `ejs-4.2.3-snes9x-netplay-v6`; os artefatos e fontes reproduzíveis
ficam em `assets/emulation-netplay` e `/netplay-emulatorjs/source/`.

A investigação encontrou bloqueio da fila de áudio e retomadas Asyncify que
podiam atravessar chamadas nativas e causar acesso fora da memória. A
inicialização agora aguarda Asyncify terminar, cancela novamente o laço e usa
áudio não bloqueante. Há guardas de estado e contador nativo de `retro_run`.
A restauração usa a API síncrona do core. Os cinco controles, inclusive o
terceiro, são independentes e o Multitap é configurado pela API libretro.

Validação local em build de produção: oito testes Playwright passaram em
2,6 minutos, cobrindo salas de 2/3/4/5 participantes, controles reais de toque,
independência, simultaneidade, snapshots/checksums, saves, ausência de RTP/vídeos,
instalação local, cache offline, navegação e layouts móveis. Tipagem e 36 testes
unitários passaram; um teste Redis opt-in ficou fora dessa execução.

A checagem adicional com três participantes passou em 37,6 segundos. Confirmou
bombas pelos pixels novos em cada posição (78/54/90 na amostra), PCM local não
silencioso com AudioContext ativo nos três aparelhos, entrega atrasada em 40 ms,
uma entrada com retransmissão emulada após 220 ms, detecção de divergência por
carregamento de snapshot legítimo anterior e recuperação com um snapshot
canônico, seguida de fechamento e reabertura reais do peer do terceiro jogador.
A nova oferta agora substitui o canal antigo; candidatos antecipados são
armazenados por conexão e a reconexão cancela tentativas pendentes já resolvidas.

A prova nativa em dois navegadores atingiu 900 quadros, com estados binariamente
idênticos, cinco personagens movendo-se, pausa sem avanço e restauração idêntica.
As métricas da amostra de três participantes ficaram em torno de 60 FPS locais,
com zero correções no trecho saudável. Cinco instâncias simultâneas no mesmo
computador ficaram em 51–52 FPS na primeira amostra, sem divergências. Isso não
mede desempenho de celulares físicos independentes, redes externas ou perda
real de UDP. Essa rodada física será feita pelo proprietário, conforme combinado.

ROM, saves e evidências de arena continuam privados e excluídos do deploy.
Convidados importam sua própria ROM; o download da biblioteca privada continua
exclusivo do proprietário autenticado. Saves anteriores foram preservados.
Após publicar, todos devem atualizar e criar uma sala nova. No menu original,
três humanos usam 1PLAYER/2PLAYER/3PLAYER em MAN, não COM.

### Publicação e verificação no domínio real

Publicado em **https://bomberman-online.vercel.app**, deploy
`dpl_Gha3ZUKPeXnA1xqTvzqFLbXMwB9t`, READY. O endpoint público de configuração
respondeu HTTP 200 com `ejs-4.2.3-snes9x-netplay-v6`. O build remoto passou com
`setup:emulator`, `setup:netplay` e build Next.js. Segredos e integrações existentes
foram mantidos.

Playwright no domínio publicado: **dois testes passaram em 1,1 minuto**, cobrindo
três e cinco navegadores, controles exclusivos e simultâneos, bombas verificadas
por pixels, PCM local com AudioContext ativo, nenhum sender RTP e snapshots
verificados. A amostra de produção mostrou 60 FPS locais e RTT direto de cerca
de 1 ms entre os navegadores na mesma máquina; não mede RTT entre redes externas.
O caso de três incluiu também atraso/retransmissão emulada, recuperação de uma
divergência provocada e reconexão real do terceiro peer. Após recuperar, os três
atingiram novos quadros verificados a 60 FPS, com uma correção registrada e
RTT em torno de 43–49 ms no canal artificialmente atrasado. Evidências privadas:
`.private/netplay/network-3.json`, `network-5.json` e `resilience-3.json`.

## Controles móveis e atraso de entrada adaptativo — 27/10/2026

O teste de sessão reproduziu 41 FPS no modelo com RTT de 160 ms e atraso fixo
seis quadros. O protocolo 2 ajusta automaticamente o buffer de entradas em um
quadro futuro comum, mantendo comandos já enviados e usando somente o estado
real do controle de cada participante. O teste de regressão exige pelo menos
55 FPS nesse modelo, com hashes verificados e nenhuma correção. O modo manual
continua disponível; versões anteriores não passam pela compatibilidade.

Toque: botão A identificado como Bomba, tamanho grande como padrão em aparelhos
com toque, captura de ponteiro cancelada tratada sem exceção e solturas globais
para evitar botões presos. Mudanças de altura da barra do navegador não soltam
o controle; mudança de largura/orientação limpa os dedos. A ligação dos controles
não é recriada quando muda a lista de participantes ou a conexão da sessão.

O jogo abre no modo expandido após estar pronto em aparelhos com toque. Canvas
mantém 4:3 na vertical e horizontal, sem esticar a imagem; Start/Select reservam
espaço fora da arena na horizontal. Zoom, arraste e menu de imagem são bloqueados
somente na superfície do jogo, preservando o zoom do restante do site. Uma pausa
exibe os comandos de recuperação novamente. Oscilações ICE inferiores a três
segundos podem recuperar o mesmo canal confiável, evitando transferir outro save.

Tipagem passou; 41 testes unitários passaram e um Redis opt-in foi ignorado.
A primeira prova ampliada em três navegadores reais passou em 42,8 s: telas
320×568, 390×844 e 844×390, multitoque, cancelamento, gesto de pinça sem zoom,
captura cancelada sem erro, comandos exclusivos, bombas e áudio local. Após
160 ms de atraso artificial e 220 ms adicionais em uma entrada retransmitida,
os três emuladores mantiveram 60 FPS na amostra, atraso automático de 13 quadros,
e uma única correção provocada pelo próprio teste de divergência. Reconexão
foi concluída. São emulações de tela e rede no mesmo computador; não substituem
a validação em celulares físicos.

A checagem final local passou **oito testes Playwright em 2,1 minutos**, incluindo
áudio deliberadamente suspenso em um convidado, sem divergência; imagem 4:3 e
Start/Select fora da arena na horizontal. Os testes unitários finais somaram
**42 aprovações**, incluindo redução do buffer após dez segundos de melhora da
rede, sem sobrescrever entradas ou perder sincronização. Um teste Redis opt-in
continuou ignorado. A compilação de produção e a tipagem passaram.

### Publicação dos ajustes móveis

Deploy `dpl_79n2M3SHaPfZARaYZdaEc3gyg2Do`, READY, em
https://bomberman-online.vercel.app . A configuração pública confirmou HTTP 200
com protocolo 2 e core SNES v6; ROM, saves e credenciais permanecem preservados.

No domínio publicado, dois testes Playwright passaram em **1,6 minuto**, com três
e cinco navegadores. O caso de três cobriu novamente telas móveis, gestos,
bombas, áudio suspenso/retomado, rede artificialmente lenta, divergência e
reconexão. Depois que a entrega voltou ao normal, o atraso adaptativo retornou
a seis quadros sem reiniciar a partida, com novos estados verificados e 60 FPS
na amostra. Evidência: `.private/netplay/resilience-3.json`, campo
`adaptiveRecovery: true`. A correção registrada nesse teste foi provocada pelo
carregamento deliberado de um save anterior; não ocorreu divergência espontânea.
Os controles de cinco jogadores também passaram. Esses testes não substituem
os aparelhos físicos do proprietário.

Para aplicar a correção em todos, sair da sala anterior, recarregar o site em
cada aparelho e criar uma sala nova. A instalação local da ROM é reutilizada.

## Continuidade após desconexão e instalação prévia — 27/10/2026

O protocolo 3 deixa neutro o controle sem comandos no prazo e continua os commits
para os demais. A reconexão recebe um snapshot individual e recupera os commits
acumulados, sem preparar novamente a partida dos sobreviventes. A réplica mantém
no máximo uma pequena fila de reprodução para que seus comandos novos não fiquem
permanentemente atrasados. As posições reservadas continuam válidas enquanto os
eventos de presença e fechamento RTC chegam em ordens diferentes.

A coordenação passa a outro participante preparado quando o coordenador sai;
se apenas o canal RTC cair, a maioria dos demais participantes preparados pode
solicitar a eleição. A mudança é aplicada atomicamente no backend. Slots e
permissões administrativas são preservados. O encerramento explícito pelo
proprietário ainda encerra a sala. A mudança de coordenador pode causar uma breve
renegociação; a ausência de um convidado não bloqueia o resto da partida.

A tela inicial agora oferece instalação antes de entrar numa sala. A ROM continua
no IndexedDB, com solicitação de armazenamento persistente quando disponível;
manifest e ícones 192/512 permitem adicionar o site à tela inicial. Recargas
reutilizam a instalação e retomam a sala pelo token da sessionStorage. APIs
privadas continuam fora do cache e o convidado continua sem acesso a `/api/rom`.

Validação local com build de produção:

- Compilação e tipagem passaram. **47 testes unitários passaram**, incluindo aba
  suspensa, entrada silenciosa, saída/retorno individual e eleição por maioria.
- **Dois testes no Redis real passaram**, com namespace isolado e limpeza: troca
  de coordenador, reserva de slots, retomada e fechamento atrasado de socket antigo.
- Três casos de jogo real passaram: retorno/transferência e controles exclusivos
  com três e cinco participantes, incluindo movimentos e bombas por toque.
- A validação final ampliada de desconexão passou em **26 s**: instalação na home,
  recarga sem nova importação, retorno do terceiro sem pausa dos outros, fechamento
  do navegador coordenador, eleição após queda apenas de RTC e saída normal de
  um convidado. Estado final verificado no quadro 1080, sem correções de divergência.
- Design, formulários móveis e preparação/cache também passaram. Os testes usam
  Chromium independente por jogador na mesma máquina; a rodada em celulares
  físicos e redes diferentes continua sendo a validação externa combinada.

A validação de saída foi ampliada para um convidado tocar em **Sair da sala**
enquanto anfitrião e outro convidado continuam. Ambos permaneceram na mesma
execução, sem entrar em preparação; o convidado entrou novamente usando a ROM
já instalada. A sequência completa, incluindo duas trocas de coordenador,
passou em 46 s, chegando ao quadro verificado 1680, sem divergência. A presença
atrasada agora é aceita como informação de interface do coordenador, mantendo a
validação do slot nas entradas. Remover outro convidado não pausa uma réplica
que continua conectada ao coordenador. O buffer automático também considera
perdas de prazo causadas por variação de processamento, além do RTT; o teste de
cinco controles com o ajuste passou em 27,7 s.

## Revisão de foco, segundo plano e retorno — 27/10/2026

Foi separado o desfoque interno do iframe da perda real de foco do documento.
Tocar no controle após focar o iframe não deve gerar uma soltura falsa. Perder
foco real continua soltando apenas os próprios botões. Os testes de vários
aparelhos usam foco independente por contexto via CDP; vários jogadores em
aparelhos diferentes não disputam o foco de uma única janela do computador.

O coordenador que vai para segundo plano informa sua indisponibilidade e cede
para outro participante preparado. Se o loop do coordenador parar sem avisar,
as réplicas solicitam eleição após três segundos sem avanço. A maioria exigida
continua sendo verificada pelo backend. Aparelhos em segundo plano e novos
participantes que ainda não carregaram um estado canônico não são candidatos
preparados. A recuperação de disponibilidade permite substituir um coordenador
indisponível quando outro aparelho preparado retorna.

49 testes unitários passaram. Dois testes no Redis real passaram, incluindo
indisponibilidade e transferência voluntária de coordenação. A sequência local
ampliada passou em 47,8 s: suspensão do loop de um convidado (contador nativo
parado enquanto os demais avançavam), retorno, saída/reentrada, perda do
anfitrião, segundo plano anunciado, parada abrupta do loop do novo coordenador
com RTC aberto e eleição, queda de RTC e saída normal. O estado final ficou
verificado no quadro 2040, sem divergências. O teste usa suspensão controlada
via requestAnimationFrame; não representa um congelamento físico do sistema
operacional. Os cinco controles passaram em 22,5 s. Dispositivos físicos ainda
precisam da rodada externa já combinada.

### Revisão publicada e validação no domínio público

Deploy `dpl_DfhTFGiHWkpLE6kHDqxfuETHjNUL`, READY, em
https://bomberman-online.vercel.app . Configuração HTTP 200 com protocolo 3;
manifest standalone e proteção de foco do iframe também confirmados no domínio.

A sequência pública ampliada de suspensão/retorno passou em 59,2 s, com quadro
final 2393 e estado verificado no quadro 2280, sem divergência. O caso de três
jogadores passou com controles móveis, áudio, atraso artificial de 160 ms,
retransmissão artificial de 220 ms, divergência deliberada e recuperação do
buffer. As simulações de suspensão param o loop de emulação mantendo o RTC
aberto; não substituem testes em celulares físicos.

Na revisão do teste de cinco aparelhos, a duração do toque passou a ser medida
**depois de iniciar o gesto**, excluindo o tempo gasto em rolagem e preparação
pelo Playwright. Permaneceram os critérios de movimento exclusivo, outros
personagens parados, bombas e áudio local. Duas execuções consecutivas no domínio
público passaram: **40,5 s e 35,3 s**. Os contextos emulam foco independente para
representar aparelhos diferentes. Essa correção da medição evita soltar o botão
logo após o início do toque quando sua preparação já consumiu vários quadros.

Aplicação: sair da sala antiga, atualizar em todos os aparelhos e criar uma sala
nova. A ROM instalada e os saves são preservados no armazenamento do navegador.

## Acesso público sem senha — 27/10/2026

Criar e iniciar uma sala passou a depender da posição de anfitrião, sem exigir
login administrativo. Convidados continuam sem poder iniciar a sala de outro
anfitrião. Salas criadas por visitantes podem ser retomadas pelo token próprio;
a administração e o endpoint privado de biblioteca continuam autenticados.

O modo solo da página principal agora usa a emulação local numa sala de uma
pessoa, com início automático quando estiver preparada. O botão **Instalar jogo
neste aparelho** baixa a cópia que o proprietário já publicou no GitHub, fixada
por commit e SHA-256. A cópia é armazenada no navegador; o endpoint privado não
foi aberto ao público. Importação manual continua disponível.

50 testes unitários passaram. Três testes no Redis real passaram, incluindo
criação, início e retomada por visitante anônimo e rejeição de início por outro
participante. O teste inicial com três navegadores anônimos passou: instalação
pública real, zero POSTs de login, início, retorno após recarregar e rotas privadas
recusando GET (401) e PUT (403). A checagem de cinco controles também passou com
anfitrião anônimo. A senha administrativa atual permanece privada e inalterada.

### Publicação do acesso sem senha

Deploy `dpl_AabnP6ApEVyPvLANx3E2xCpXYQUz`, READY, em
https://bomberman-online.vercel.app . Dois testes no domínio público passaram em
30,9 s: três visitantes anônimos criaram, instalaram, iniciaram e retomaram uma
partida (20,2 s), e outro visitante jogou sozinho e recarregou reutilizando a
instalação (9,6 s). Nenhum POST de login foi usado. Todos continuaram com
`owner: false`; a biblioteca privada recusou GET com 401 e PUT com 403.

A validação local final passou cinco casos, incluindo os cinco controles com
anfitrião anônimo, navegação móvel e distinção entre criar sala e abrir a
administração. A senha atual permanece privada. Jogar não depende dessa senha.


## Saída de participantes e controles intermitentes — protocolo 4

A revisão reproduziu falhas antes de alterá-las: ação pressionada e solta entre dois quadros era perdida; o envio de entradas seguia o renderizador local atrasado; desconectar um gamepad apagava o toque/teclado mantido; um keydown após blur podia continuar bloqueado; uma entrada ausente aumentava o atraso de todos; ausência de hash de um convidado podia pausar a sala; negociações RTC concluídas após close podiam propagar erro à sessão inteira. Também foram reproduzidos o retorno durante mudança de atraso agendada e a incompatibilidade de um convidado afetando a sala em andamento.

O protocolo 4 preserva pulsos de ação, envia entradas ao receber commits e isola falhas/recuperação por participante. O atraso automático considera a latência dos participantes ativos; a saída isolada não gera aumento. O retorno recebe qualquer mudança de atraso pendente antes dos commits acumulados. A réplica aceita até 1.024 commits de recuperação, mantendo a execução contígua e o limite separado de 256 quadros para entradas futuras. Divergências reais de estado continuam sujeitas às correções e à pausa de segurança existente.

O toque ignora a perda de captura de um filho quando a raiz ainda possui a captura daquele dedo. A desconexão de um gamepad recompõe as fontes de entrada sem apagar as outras; limpar um toque depois de blur não reativa o gamepad em segundo plano. As regras de captura foram conferidas na [especificação Pointer Events](https://www.w3.org/TR/pointerevents3/#process-pending-pointer-capture) e no [evento lostpointercapture da MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/lostpointercapture_event). As operações RTC verificam fechamento depois de cada await; as falhas de uma negociação ativa recuperam apenas aquele peer, considerando a [API assíncrona setRemoteDescription](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/setRemoteDescription).

Snapshots negociam gzip por capacidade do navegador, com alternativa sem compressão. O tamanho descomprimido é limitado ao declarado (máximo de 2 MiB), seguido de conferência SHA-256 do estado original. A amostra da arena de 823.432 bytes ficou com 86.975 bytes em gzip, aproximadamente 89% menos tráfego. Testes cobrem corrupção, truncamento, limite de saída e alternativa sem compressão. Core SNES v6, ROM e saves não foram alterados.

Tipagem e build de produção local passaram. **67 testes unitários passaram**, com três casos Redis opt-in fora desta execução. O backend Redis não foi alterado nesta revisão. Todos os aparelhos precisam recarregar e criar uma sala nova para usar o protocolo 4; a instalação e os saves locais permanecem disponíveis. A senha administrativa continua privada e jogar continua sem senha.


A rodada de arena identificou uma regressão adicional antes da publicação: o heartbeat podia medir o carregamento de um convidado como RTT e elevar o atraso de 6 para 16 quadros. A reprodução unitária com ACK de restauração retardado em 500 ms elevava o atraso a 24 quadros. A correção cancela a medição anterior ao retorno, suspende sondas enquanto o estado é carregado e mede novamente depois do ACK. Esse teste passou mantendo seis quadros e zero correções. O atraso de uma rede realmente mais lenta continua sendo medido depois da restauração.


Na arena original, o caso de isolamento passou após a correção: três bombas com down/up na mesma tarefa foram efetivamente desenhadas, o dedo mantido continuou controlando P2 durante desconexão de gamepad e perda de captura de um filho, e a liberação voltou a zero. Um erro real de createOffer foi injetado, outro offer foi retardado em dois segundos e o convidado saiu durante esse await; houve retorno e fechamento abrupto da aba depois. Os dois participantes restantes não saíram da fase running, não regrediram quadros, mantiveram o atraso e registraram zero correções. O maior intervalo entre avanços amostrados foi 116,7 ms no coordenador e 133,3 ms no outro navegador. Snapshots reais de retorno passaram de aproximadamente 823 KB para 86 KB; a arena restaurada teve exatamente 86.975 bytes transmitidos para 823.432 originais.

O caso móvel de três jogadores com 160 ms de atraso e 220 ms adicionais de retransmissão simulados passou novamente após a última correção, incluindo retorno do atraso automático a seis quadros. Esses dois casos passaram em 1,9 minuto na compilação final. Na rodada anterior, os cinco controles com movimento/bombas simultâneos, continuidade/troca de coordenador, instalação sem senha e modo solo também passaram; o caso de isolamento dessa rodada foi o que revelou a medição incorreta descrita acima. Os testes executam emuladores reais em contextos Chromium no mesmo computador; os intervalos medidos incluem a disputa local de CPU e não comprovam desempenho em celulares físicos externos.

# Redesign visual — validação de 26/10/2026

O redesign está publicado em **https://bomberman-online.vercel.app**, deploy `dpl_576tPsQGRNVBK9Mhkm8rvoyecVkz` (READY).

## Resultado implementado

A composição da referência foi reconstruída em React/HTML/CSS: cabeçalho com três opções reais, acesso administrativo, dois indicadores ligados aos estados reais, título com gradiente, três ações existentes, moldura de console com perspectiva e iluminação, convite identificado, quatro cartões e seção de três passos. A arte de batalha foi preparada separadamente; a captura do site não é o fundo da interface. Cores, superfícies e efeitos ficam centralizados em `src/app/redesign.css`. A fonte Inter é local e os ícones Lucide são importados individualmente.

O painel Salas oferece criação/entrada pelos fluxos existentes. Quando há sala, mostra o código verdadeiro, sua cópia e os participantes conectados. A demonstração da página inicial diz **SALA DE EXEMPLO**, não cria uma sala nem oferece uma cópia funcional do código ilustrativo. O texto **2–5 JOGADORES** preserva a capacidade real solicitada anteriormente, embora a imagem de referência mostre quatro. Autenticação, protocolos, Redis, Blob, WebRTC, ROM, emulador, controles e saves mantêm as implementações e variáveis existentes.

## Comparação visual

Foram realizadas duas passagens de captura e comparação com a referência em 1672 × 941. Foram ajustados largura e centralização da navegação, alinhamento do logo e do título, enquadramento da arte em 16:9, perspectiva da moldura, altura dos cartões e espaçamento da seção inferior. As versões em 1440, 1024, 768 e 390 px também foram capturadas e inspecionadas.

Capturas finais geradas no domínio de produção:

- `screenshots/home-1672.png` — viewport 1672 × 941.
- `screenshots/home-1440.png` — viewport 1440 × 900.
- `screenshots/home-1024.png` — viewport 1024 × 900, documento completo.
- `screenshots/home-768.png` — viewport 768 × 1024, documento completo.
- `screenshots/home-390.png` — viewport 390 × 844, documento completo.

## Testes e compilação

- `npm run typecheck`: passou.
- `npm test`: **23 testes passaram**; um teste Redis opt-in foi ignorado.
- `npm run build -- --webpack`: build local de produção passou.
- Build remoto Vercel com Turbopack: passou.
- Playwright local: **seis testes passaram**, um teste de desempenho opt-in ignorado.
- Playwright no deploy final, com `TEST_DISTRIBUTED=1`, `TEST_PERFORMANCE=1` e a ROM real: **sete testes passaram em 1,7 minuto**.

Os testes de produção cobrem a composição visual e os cinco tamanhos solicitados, outras nove viewports na revisão geral, navegação Salas, criação/entrada reais, código verdadeiro no painel, perfis/fotos, autenticação, ROM negada ao convidado, cinco participantes, mídia e áudio decodificados, cinco controles independentes, multitoque, diagonais, arraste/centro neutro, tela cheia nativa/alternativa, botões grandes, economia durante a partida, reconexão, saves, encerramento e nova sala.

## Carregamento e limites práticos

A validação identificou um chunk antigo e indisponível na lista de pré-carregamento formada a partir de `.next/static`. Isso foi corrigido: a lista agora inclui somente **seis recursos públicos estáveis** e **oito arquivos fixados do emulador**, gerados antes do build. Os arquivos de código e fonte do Next usam seus próprios nomes imutáveis e cache HTTP. O teste confirma que o cache do worker não inclui `/_next/`, ROM nem APIs privadas. O pré-carregamento e a reutilização offline passaram no domínio publicado.

Os efeitos de cenário, a sombra do vídeo e o desfoque decorativo são retirados durante a partida; a área de renderização conserva as dimensões anteriores. O painel inicial mantém todos os efeitos da referência. A fonte variável tem cerca de 48 KB, e a arte do painel é servida em WebP de aproximadamente 162 KB. Fontes e imagens são locais; não há chamadas de runtime ao Google Fonts ou ao gerador de imagens.

A amostra final com cinco contextos no mesmo computador recebeu quatro vídeos de 384 × 236. Os comandos e a troca dos tetos de transmissão funcionaram, mas a amostra registrou cerca de 9 fps e 3–4 freezes por convidado durante o intervalo. A máquina compartilhada estava com carga de 11,38/10,52/7,59 e outros aplicativos ativos. Esses resultados não são um benchmark isolado, não comprovam melhoria de FPS e não representam validação em cinco celulares físicos. Não foram encerrados aplicativos do usuário para alterar as condições do teste.

Os PNGs de origem e os prompts estão em `ARTES.md`. O servidor isolado da revisão na porta 3001 foi encerrado; o servidor original não foi interrompido. Para receber a nova interface, atualize o site; uma sala em andamento mantém o aviso de atualização até a saída.

# Artes do redesign

Foram usados o **tool integrado `image_gen`**, no modo padrão da skill `imagegen`, e a imagem de referência fornecida pelo proprietário. A interface não usa a captura do site como fundo: navegação, moldura do console, cartão de convite, botões, estados, cartões e passos são componentes reais.

Arquivos finais no projeto:

- `assets/design/bomberman-battle-wide.png`: arte final em 16:9.
- `assets/design/bomberman-head.png`: ícone da cabeça, com transparência.
- `public/optimized/bomberman-battle.webp`: versão leve para a página, gerada no build.
- `public/optimized/icon.png`: ícone leve do cabeçalho e favicon, gerado no build.
- `assets/design/drafts/bomberman-battle-4x3.png`: primeira versão, preservada como rascunho; não é carregada pela interface.

Os PNGs de origem ficam fora de `public`; somente as versões otimizadas são consumidas pelo site. As fotos das pessoas não foram regeneradas ou substituídas. A tipografia Inter é local, com licença em `public/licenses/Inter-OFL.txt`; não há chamadas ao Google Fonts durante o uso. Os ícones Lucide são importados individualmente, com licença em `public/licenses/Lucide.txt`.

## Prompt final da arte do painel

Use case: compositing. Asset type: widescreen full-bleed illustration inserted in a real HTML game monitor. Image 1 is the artwork to edit, image 2 is the intended website composition reference. Make one targeted change: recompose Image 1 to a true wide 16:9 landscape rectangle so the entire illustration fits the widescreen monitor in image 2 without cropping off the title. Keep the exact existing character designs, crisp illustration style, brick arena, blue night sky, pink gloves, white Bomberman, coloured small characters, bomb and explosions. Preserve exact lettering 'SUPER BOMBERMAN 5'. Reduce and arrange the whole title in the upper left approximately 55 percent of the image width, fully inside the canvas with a safe margin. Keep the large white Bomberman occupying the right third with cream face, vertical black eyes, blue suit and pink gloves and feet; the dark bomb at lower centre and smaller coloured characters in the centre and left. Extend the brick maze naturally to fill the wide framing. IMPORTANT output canvas aspect ratio 16:9, landscape, wide illustration. Do NOT include the monitor frame, any website UI, buttons, navigation, text other than the game title, room card, or watermark. This is only the cover illustration, not a website mockup.

## Prompt final do ícone

Use case: background-extraction. Asset type: transparent small website brand icon. Input image is a website design reference. Extract/recreate ONLY the small Bomberman head icon at the very top LEFT of the reference. White rounded helmet, pale cream face, two long vertical black eyes, slender black outlines, pink antenna ball above the upper right. A slightly tilted, polished dimensional game mascot head matching the reference. Single isolated head, centred, with a little breathing room. No body, no text, no logo lettering, no badge, no square tile, no blue circle, no website elements. Background must be genuinely transparent with clean alpha edges. Preserve the reference mascot's face and pink antenna; suitable for display at about 80px tall on very dark navy.

# Checkpoint de integração

`battle5.state` foi obtido navegando pelos menus normais do jogo fornecido, com as cinco posições em MAN. É um estado SNES, não uma ROM adicional.

Use `npm run setup:fixtures` para copiá-lo à pasta local usada pelos testes. O script recusa sobrescrever um checkpoint existente.

A fixture foi validada com o core SNES v6 do projeto. Os testes de netplay com dois a cinco participantes reutilizam esse estado; posições sem participante ficam neutras. Diagnósticos e saves pessoais continuam em `.private/`, fora do Git.

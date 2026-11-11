# MyBots no Windows (beta, sem assinatura)

Escrito em 03/11/2026 e revisado em 11/11/2026 (0.94.1). O instalador do Windows é um **beta**: o código foi portado e testado só com funções de sistema simuladas em Linux; a primeira execução num Windows de verdade é este roteiro. Plano geral em [PLANO-DISTRIBUICAO.md](PLANO-DISTRIBUICAO.md).

## Instalar
1. Baixe o `MyBots-<versão>-windows-x64.exe` da Release **pc-latest** (https://github.com/AugustodoBRT/Mybots/releases/tag/pc-latest), sem precisar de login. Depois da primeira instalação, o app se atualiza sozinho pelo botão "Atualizar e reiniciar".
2. O Windows mostra "O Windows protegeu o computador" (SmartScreen), porque o instalador não é assinado: **Mais informações → Executar assim mesmo**.
3. O instalador deixa escolher a pasta (por usuário, sem pedir administrador). O MyBots abre, vai para a bandeja e se registra para iniciar com o Windows.

## Antes de usar: as IAs
O MyBots usa as IAs que já estão instaladas e logadas no computador. Para instalar, o assistente de primeira execução mostra os comandos (inclusive os do Antigravity e do opencode); no Windows precisam do **Node.js** (nodejs.org). Depois de instalar o Node.js, num PowerShell:
- Codex: `npm install -g @openai/codex` e `codex login`
- Claude Code: `npm install -g @anthropic-ai/claude-code`, depois `claude` e `/login`

O MyBots acha os programas pelo `PATH` do usuário e entende os atalhos `.cmd` que o npm cria. Abra o assistente de novo pela bandeja (Assistente de primeira execução) depois de instalar.

## O que funciona e o que não
| | Windows |
|---|---|
| Janela, bots, conversas, rotinas, sincronização, relé, celular pareado (pelo QR, com o app sozinho ou com Termux) | Sim |
| Codex | Só leitura e sem terminal (não há isolamento no Windows) |
| Claude Code | Comandos e escrita fora da pasta do bot pedem **cartão de aprovação** |
| Navegador dos bots | Usa o Chrome (ou o Edge) instalado; o navegador da janela é próprio |
| Controle de tela e teclado (o bot usar o mouse) | Desligado (só Linux/Hyprland) |
| Ditado por voz | Desligado |
| Avisos do sistema | Toast do Windows (feito por PowerShell; pode precisar de ajuste) |
| Atualização | Botão "Atualizar e reiniciar" na janela (baixa, instala e reinicia sozinho), pela Release `pc-latest` |

Dados: `%APPDATA%\MyBots`. Os arquivos secretos não têm o modo 600 do Linux; ficam na pasta do seu usuário.

## Roteiro de teste (marque o que falhar e anote a mensagem)
1. **Instala e abre**: o instalador roda, a janela abre, o ícone aparece na bandeja.
2. **Assistente**: lista Codex, Claude Code, Antigravity e opencode com "instalado/conectado" certo; mostra o Chrome ou o Edge; gera o QR.
3. **Sobe o nó**: `%APPDATA%\MyBots\node.log` sem erros; a janela mostra "Só neste computador".
4. **IA responde**: crie um bot, mande "oi" e veja a resposta (Codex e Claude, se os dois estiverem instalados). Se não responder, copie o `node.log`.
5. **Aprovação**: peça ao bot (Claude) para criar um arquivo ou rodar um comando; deve aparecer o cartão de aprovação.
6. **Navegador**: peça para abrir um site; confira o painel do navegador na janela.
7. **Celular**: pareie pelo QR (**Ler o QR do computador** no app) e veja os bots no celular.
8. **Reinício**: reinicie o Windows e veja se o MyBots volta sozinho para a bandeja.
9. **Fechar**: fechar a janela só esconde (a bandeja continua); "Fechar" na bandeja encerra tudo (confira no Gerenciador de Tarefas que não sobra processo).
10. **Janelas piscando**: durante o uso não deve aparecer nenhuma janela preta de console.

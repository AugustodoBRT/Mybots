# MyBots no computador: plano

Escrito em 21/10/2026, depois da v35 (0.17.0). Serve para abrir uma conversa nova e pedir: **"leia docs/PLANO-PC.md e faça a próxima versão pendente"**. As regras de trabalho, teste e entrega são as de [PLANO-DESENVOLVIMENTO.md](PLANO-DESENVOLVIMENTO.md) (seção 2).

## 1. O que o usuário quer

- Com **só o celular ligado**, os bots feitos para o celular (ou que funcionam só com ele) ficam **online**, como pessoas; os que precisam do PC ficam **offline**.
- Ao **ligar o PC**, o MyBots abre sozinho na inicialização e **todos** os bots ficam online, sem tocar em nada.
- Os bots do PC fazem tudo o que os do celular fazem **e mais**: criar projetos de programação, "controlar" o PC (como o Claude Code faz), navegador de verdade.
- Pedir ao PC para **criar bots** (ex.: um bot que busca vagas de emprego e separa vaga, empresa, e-mail e link) que depois **rodam só no celular**.
- Funcionar com o **PC em casa e o celular na faculdade**.
- Transição automática e limpa entre os estados.

## 2. Arquitetura: o celular é o cérebro, o PC é um corpo extra

- O **supervisor do celular** continua sendo a fonte de verdade: bots, conversas, memória, rotinas, permissões, aprovações e senhas, no SQLite do Termux.
- O **nó do PC** é o mesmo supervisor Node rodando no Arch como **executor**: recebe tarefas, roda o Claude Code/Codex do PC e as ferramentas do PC. Guarda só cache e as áreas de trabalho (projetos) dos bots.
- Cada tarefa tem **um único dono** (celular ou PC) com prazo de validade (concessão). Sem sincronização bidirecional de banco; sem tarefa duplicada.
- Descartado: o PC virar o centro quando está ligado (o banco teria de migrar a cada liga/desliga).

## 3. Onde cada bot vive e presença

Campo do bot **"Onde ele vive"** (`bot.home`):

| Valor | Online quando | Exemplos |
|---|---|---|
| `phone` 📱 Celular | o celular está ligado | lembretes, SIGAA, SMS, rotinas |
| `pc` 💻 Computador | o PC está conectado | programador, "controla meu PC" |
| `any` 🔀 Onde estiver | sempre; no PC ganha os poderes extras | pesquisador, criador de bots |

- Cada ferramenta ganha `where: 'phone' | 'pc' | 'any'`. O bot só recebe as ferramentas dos nós conectados.
- Presença como gente: bolinha verde/cinza, "online · no computador", "online · modo celular", "visto por último às 18:40". Avatares dos bots do PC "dormem" (olhos fechados) no app e no widget.
- Mensagem para bot do PC com o PC desligado: fica **esperando o computador** (como o ✓ do WhatsApp) e roda sozinha quando o PC conecta. Pode ser cancelada.
- Rotina de bot do PC com o PC desligado: fica esperando também (com aviso de atraso), nunca roda pela metade no celular.

## 4. Conexão celular ↔ PC

- **O celular liga para o PC**; o supervisor do celular continua escutando só em `127.0.0.1`.
- O PC escuta (rede local e interface da Tailscale) com WebSocket + TLS de certificado fixado.
- **Pareamento único por QR**: o app do PC mostra um QR; o MyBots no celular lê com a câmera; troca de chaves Ed25519 fixadas; cada conexão faz desafio assinado nos dois sentidos. Nada de senha ou token em URL.
- **Fora de casa**: Tailscale (grátis para uso pessoal). Necessária porque a maioria das operadoras usa CGNAT e porque Wi-Fi de faculdade costuma isolar os aparelhos entre si. Ocupa a vaga de VPN do Android.
- Descoberta: último endereço conhecido → mDNS pela `NsdManager` do Android → nome da Tailscale.
- Latência: só passam mensagens pequenas (texto, cartões, chamadas de ferramenta), não a tela. Tailscale direta soma ~20 a 80 ms; pelo relay dela, ~100 a 300 ms. Desprezível perto dos segundos do modelo.
- Bateria: procura o PC com mais frequência só no Wi-Fi de casa/Tailscale, com espera progressiva; tenta na hora quando a rede muda.

## 5. O que o nó do PC acrescenta

- **Programação**: área própria por bot (`~/MyBots/<bot>/`, com git). Claude Code com ferramentas nativas (Bash, Edit, Read); aprovações pelo `--permission-prompt-tool` que já existe. Dentro da área, o nível Total libera; fora dela, `sudo`, `rm -rf`, push etc. viram **cartão de aprovação no celular e no PC**.
- **Controlar o PC** (Wayland + Hyprland, então `xdotool` não serve): `grim` (tela), `hyprctl` (janelas, foco, abrir apps), `ydotool` + `ydotoold` (clique e teclado). Indicador visível na tela e **tecla de pânico** no Hyprland. Nível de acesso próprio, nunca herdado.
- **Navegador de verdade**: Playwright com o Chrome do sistema, perfil por bot. Senhas continuam no celular: no login, só aquela senha vai cifrada ao processo do navegador; nunca ao modelo.
- **Tudo do celular**: o MCP do PC expõe a união das ferramentas; as do celular (SMS, notificações, localização, pendências, rotinas) são repassadas ao supervisor do celular pelo link. Política e aprovações seguem decididas no celular.

## 6. Habilidades: bots criados com ajuda do PC

1. O bot programador no PC escreve um **módulo Node pequeno** com manifesto (ferramentas que oferece, domínios que acessa, arquivos).
2. Testa no PC e mostra um resultado de exemplo.
3. Propõe com `bot.propose` (sempre pede aprovação): "Criar bot Vagas · vive no celular · usa a habilidade buscar_vagas · rotina diária às 8h".
4. Aprovado: a habilidade é assinada pelo PC, copiada para o celular e roda no Termux num processo isolado (modelo de permissões do Node para arquivos; sem acesso a senhas nem ao banco).
5. O bot vive no celular e roda com o PC desligado; entrega a planilha com o `file.create`.

Honestidade: o `--permission` do Node não limita a rede de forma confiável (o manifesto de domínios é para conferência e aprovação). Sites como LinkedIn bloqueiam robôs; preferir APIs, RSS e o conector Indeed da conta do Claude.

## 7. App no PC e início automático

- **Nó**: serviço `systemd --user` (`mybots-node.service`), sobe com a sessão, reinicia se cair, roda com a janela fechada.
- **Janela**: **Tauri 2** (Rust + WebKitGTK do sistema; ~5 a 15 MB e ~40 a 80 MB de RAM, contra ~150 MB e 200 a 400 MB do Electron). Bandeja na waybar, autostart, instância única. A interface é a mesma do celular via react-native-web; as partes nativas (WebView, notificações) ganham versões do desktop.
- Atenção: notebook com NVIDIA + AMD no Wayland; a WebKitGTK pode abrir em branco com NVIDIA (`WEBKIT_DISABLE_DMABUF_RENDERER=1`). Testar logo no início dessa fase.
- **Notebook**:
  - Wake-on-LAN descartado (notebook quase nunca acorda pela rede).
  - **Modo "servidor em casa"**: na tomada, fechar a tampa só apaga a tela (`HandleLidSwitchExternalPower=ignore`, oferecido por um botão no app).
  - **Acordar por rotina** (`rtcwake`): um bot do PC com rotina às 8h acorda o notebook suspenso, roda e volta a dormir.

## 8. Regras de transição

| Situação | Comportamento |
|---|---|
| PC conecta | Bots do PC online; mensagens e rotinas esperando começam a rodar |
| PC desconecta ocioso | Bots do PC com "visto por último"; os `any` voltam ao modo celular |
| PC cai no meio de uma tarefa | Tarefa vira **interrompida** (não repete sozinha, como hoje); cartão "Continuar no celular?" se o bot for `any` |
| Bot `any` troca de aparelho | Sessão de IA nova com o histórico recente e a memória (sessões do Claude/Codex não são portáteis) |
| Celular sem bateria, PC ligado | Futuro: o PC atende só os bots `pc` e guarda numa fila de saída; ao reconectar, junta por ID |
| Aprovações | Aparecem nos dois; a primeira resposta vale e o cartão some do outro |

## 9. Versões

| Versão | Entrega | Aceite |
|---|---|---|
| **v36** ✅ | `bot.home`, presença e "visto por último", tarefas esperando o computador, registro de nós e fila com uma vez por aparelho | Testes com nó simulado; no emulador, bot do PC aparece offline e a mensagem espera |
| **v37** ✅ | Nó do PC (Node) + pareamento por QR + link seguro (rede local e Tailscale) que entrega o `execute` ao `Nodes.connect`; o PC informa as próprias contas de IA (hoje o celular ainda exige o login dele para mandar mensagem a um bot do PC) | Emulador ↔ nó local: PC liga e a tarefa roda lá; derrubar o nó no meio = interrompida; celular no 4G via Tailscale |
| **v38** ✅ | Correções do teste no celular: teclado não esconde mais a folha do bot; o bot sabe que está no computador e não finge salvar em pastas dele | Teste no celular real (pareamento por QR, resposta pelo PC) e no emulador |
| **v39** ✅ | App Tauri na bandeja + interface do app via react-native-web servida pelo nó + início com a sessão; **e** os poderes do PC (`computer`: pasta `~/MyBots/<Nome>`, Claude com terminal e arquivos decididos no celular, Codex em `workspace-write`) | Janela abre no Hyprland e conversa; bots criam e rodam scripts; comando no Médio vira cartão |
| **v40** | Habilidades + `bot.propose` + execução isolada no Termux | Bot de vagas criado no PC roda a rotina no celular com o PC desligado |
| **v41** | Controle do desktop (grim/hyprctl/ydotool) + Playwright com perfis | Bot abre app, clica, screenshot; tecla de pânico interrompe |
| **v42** | Modo tampa fechada, `rtcwake` para rotinas, modo celular-ausente | Rotina das 8h acorda o notebook e roda |

## 10. Riscos

1. Controlar o PC é a parte mais perigosa: por último, com indicador, tecla de pânico e nível próprio.
2. Limites da assinatura: bots do PC usam a mesma conta do Claude; tarefas de código gastam muito. Limite por bot.
3. react-native-web com módulos nativos é a fase mais trabalhosa.
4. Habilidades rodam código gerado no celular: a aprovação mostra claramente o que acessam.

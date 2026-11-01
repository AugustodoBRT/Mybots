# Plano: novas IAs — Antigravity (`agy`) e opencode

Objetivo: o bot poder usar **agy** e **opencode** além de Codex e Claude, com a mesma experiência (modelo e raciocínio no perfil, streaming, ferramentas do MyBots, aprovações, custo). Rodam no **PC e no Termux** (decisão da pessoa em 31/10/2026).

## O que já foi verificado (neste PC, 31/10/2026)
- **agy** (`/usr/bin/agy`): `agy -p "<texto>" --output-format stream-json --model <id> [--effort low..max] [--conversation <id>]`.
  - Eventos NDJSON: `init` (tem `conversation_id`, lista de ferramentas e `permission_mode`), `step_update` (`text_delta`, `usage`), `result` (`response`, `usage`, `status`).
  - Catálogo: `agy models` (texto: `id<TAB>nome`). Cada nível de raciocínio é um modelo à parte (`gemini-4-argon-low|medium|high`, `claude-opus-5-5-*`, `gpt-oss-120b-medium`…) → tratar como modelo + esforço agrupando pelo sufixo.
  - **Risco**: em modo `-p` o `permission_mode` vem `always-proceed` e as ferramentas incluem `run_command`, escrita de arquivos, navegador próprio e `schedule`. Precisa ser restringido antes de ligar (ver Fase 0).
  - MCP: `agy mcp add|list|remove|enable|disable`; entrada de texto também via `--input-format stream-json`.
- **opencode** (`/usr/bin/opencode` 1.18.30): `opencode run "<texto>" --format json -m <provedor/modelo> [--variant <esforço>] [-s <sessão>] [--dir <pasta>]`.
  - Eventos NDJSON: `step_start`, `text` (`part.text`), `step_finish` (`tokens`, `cost`), todos com `sessionID` (`ses_…`).
  - Catálogo: `opencode models` (`provedor/modelo`); hoje: modelos `opencode/*-free` e `omniroute/meu`.
  - Permissões: por padrão pede aprovação (`--auto` libera tudo, **nunca usar**); regras em `opencode.json` (`permission`); MCP em `opencode.json` (`mcp`).
- Código atual: provedores `codex`/`claude` estão fixos em ~50 pontos (`supervisor/queue.mjs`, `index.mjs`, `database.mjs`, `tool-policy.mjs`, `lib/models.mjs`, app: `NewBot`, `BotProfile`, `Usage`, `Activity`…).

## Fases
**Fase 0 — segurança e prova (antes de ligar no app)**
1. agy: achar como limitar ferramentas em `-p` (`--mode plan`/`accept-edits`, `--sandbox`, config/`mcp disable`, `--agent` próprio) para que só o MCP `mybots-tools` e, quando liberado, arquivos da pasta do bot funcionem; `run_command`, navegador e `schedule` próprios desligados. Sem isso, agy fica só como "conversa".
2. opencode: `opencode.json` por execução (via `OPENCODE_CONFIG`/`--dir`) com `permission` negando shell/edição fora da pasta e `mcp.mybots-tools` apontando para `/mcp` do supervisor.
3. Provar com chamada real: uma ferramenta do MyBots por cada CLI.

**Fase 1 — núcleo (PC)**
- `lib/agy.mjs`/`lib/agy-runner.cjs` e `lib/opencode.mjs`/`lib/opencode-runner.cjs` no molde de `claude*.{mjs,cjs}`: `models()`, `status()`, `runReply()` com sessão, streaming (`onDelta`), progresso, uso, interrupção, tempo limite e erros em português.
- Generalizar provedores: lista única `PROVIDERS` (`codex`, `claude`, `agy`, `opencode`) em `lib/models.mjs`, usada por fila, banco, política de ferramentas e catálogo (`PROVIDER_NAMES`).
- Testes com CLIs falsos (como os de Claude/Codex) e uma rodada real.

**Fase 2 — app**
- Perfil do bot e Novo bot: IA com 4 opções; modelo/raciocínio vindos do catálogo; Atividade/Uso mostram os novos; reserva ("fallback") entre IAs.

**Fase 3 — ferramentas e aprovações**
- MCP `mybots-tools` nos dois; pedido de permissão do MyBots para ações de risco; mesmas regras de `tool-policy` (pastas liberadas, caminhos sensíveis).

**Fase 4 — Termux (feita na v0.48.1; ver `docs/agy-opencode-termux.md`)**
- Ver se `agy`/`opencode` rodam no Termux (Android arm64): binário nativo, `npm i -g opencode-ai`, ou pelo `wrap` (proot) como o Claude. Documentar em `docs/` e no `scripts/`. Conferir no emulador.

**Entrega a cada fase**: versão, `npm test`, APK, Release, push e PC (regra da pessoa).

## Perguntas em aberto
- Custo/limites: agy e opencode reportam tokens; limites de plano só se os CLIs informarem (não há janela de 5 h/7 dias como no Claude).
- Conta: agy exige login Google já feito neste PC; o celular precisaria entrar de novo.

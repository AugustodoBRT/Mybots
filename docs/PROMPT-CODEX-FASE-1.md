# Prompt para o Codex: Fase 1 (memória compartilhada)

Cole o texto abaixo no Codex, com o diretório de trabalho na raiz do repositório `mybots`.

---

Você vai implementar a **Fase 1** do plano `docs/PLANO-BOT-CHEFE.md` (leia o arquivo inteiro antes de começar, principalmente as seções 3, 4, 6 e 8). Esta fase é só backend do supervisor: tabela de notas compartilhadas, ferramentas novas e testes. Não mexa em interface, não crie o papel de "Chefe" (Fase 2) e não crie o visualizador (Fases 5 e 6).

## Contexto do código (já verificado)

- O supervisor guarda tudo em SQLite: `supervisor/database.mjs`. `SCHEMA` está em 14, as migrações usam `PRAGMA user_version` e `CREATE TABLE IF NOT EXISTS` (veja as de 10 a 14 como modelo).
- As tabelas listadas em `SYNCED` (mesmo arquivo) sincronizam entre PC e celular e entram no backup (`toolsState`, com validação em `restoreTools`/equivalente, perto das linhas 636 a 710). Veja como `memory` e `pending_items` passam por lá.
- Ferramentas: definição em `supervisor/tool-policy.mjs` (`TOOL_DEFINITIONS`, lista de campos permitidos por ferramenta e validação de argumentos), catálogo MCP em `supervisor/mcp/catalog.mjs` (`MCP_NAMES` e as definições com `inputSchema`) e execução em `supervisor/tools.mjs` (procure `tool === 'memory.read'`).
- O bot de cada chamada vem de `run.botId` (autenticado), nunca dos argumentos do modelo. Mantenha isso.
- Modelo a imitar: o teste `same tool grants differ by bot...` em `tests/tools.test.mjs`.

## O que fazer

1. **Tabela `notes`**: `notes(path TEXT PRIMARY KEY, bot_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`, com `kind` em `chefe`, `entrega`, `arquivo`.
   - `SCHEMA` 14 -> 15, com migração que também funciona quando o teste de migração baixa `user_version` (use `IF NOT EXISTS`).
   - Registre em `SYNCED` (`key: 'path'`, `at: 'updated_at'`), no backup de ferramentas e na restauração, incluindo a validação (tamanho máximo de lista como as outras, caminho e `kind` válidos).
   - Atualize o rótulo da tabela na função de rótulos (perto da linha 245: `'nota'`).
2. **Regras de caminho** (um módulo pequeno, por exemplo `supervisor/notes.mjs`, com funções puras testáveis):
   - Só caminhos `chefe/...md`, `entregas/...md`, `arquivo/...md`; sem `..`, sem barra inicial, sem caracteres de controle, no máximo 120 caracteres, só letras, números, `-`, `_`, `/`, `.`.
   - Tamanho máximo do corpo: 8000 caracteres.
   - Extração de links `[[nota]]` do corpo (função `links(body)`), devolvendo caminhos normalizados sem duplicatas. Será usada nas Fases 5 e 6.
   - Detecção de segredos: recuse gravar corpo que pareça senha, token ou chave (por exemplo `sk-...`, `ghp_...`, `AKIA...`, linhas `password:`/`senha:`/`token:` com valor). Mensagem de erro em português clara.
3. **Ferramentas novas** (nomes MCP com underscore, nomes internos com ponto, como as existentes):
   - `delivery_write` (`delivery.write`): qualquer bot. Cria um arquivo **novo** em `entregas/AAAA-MM-DD-HHMM-<bot>-<assunto>.md` (UTC; `<bot>` é o nome do bot em minúsculas com hífens, vindo de `run.botId`, não dos argumentos; `<assunto>` vem de um argumento `topic`, normalizado). Argumentos: `topic` (80), `text` (4000). Nunca sobrescreve: se o caminho existir, acrescente `-2`, `-3`... Adiciona o cabeçalho (bot, data, assunto) automaticamente. `defaultAllowed: true`.
   - `shared_index_read` (`shared.index_read`): lê `chefe/index.md` (se não existir, devolve um texto vazio com a indicação de que ainda não foi criado). `readOnly`.
   - `shared_note_read` (`shared.note_read`): argumento `path`; lê uma nota de `chefe/` ou `entregas/` ou `arquivo/`. Também aceita `list: true` com `prefix` opcional para listar caminhos, título, bot e data (máximo 100, mais recentes primeiro), sem o corpo. `readOnly`.
   - `shared_note_write` (`shared.note_write`): argumentos `path` (só `chefe/`), `text`, `overwrite` (booleano, padrão falso). Se a nota existir e `overwrite` não for verdadeiro, recuse com mensagem explicando. Se `overwrite` for verdadeiro, guarde a versão anterior em `arquivo/historico/<caminho>-<timestamp>.md` antes de substituir.
   - `shared_archive` (`shared.archive`): argumentos `path` (uma entrega) e `summary` opcional; move a nota para `arquivo/` (cria a de destino, remove a de origem pelo mecanismo usual de exclusão sincronizada). Nada é apagado de verdade.
   - Controle de acesso nesta fase: `delivery_write` com `defaultAllowed: true`; as outras quatro **sem** `defaultAllowed` (a pessoa ou a Fase 2 concede por bot com o mecanismo de `grants` já existente). Registre rótulos e descrições em português em `TOOL_DEFINITIONS`.
   - Toda ferramenta nova passa pela validação de argumentos de `tool-policy.mjs` (rejeitar campos extras, como o teste `argumento` já exige), pelo `requireGrant` e grava `db.record(...)` como as demais.
   - Bots comuns nunca leem nem escrevem em `chefe/` e só criam em `entregas/` via `delivery_write`. `memory_*` continua privado e inalterado.
4. **Texto de instruções**: acrescente em `TOOLS_TEXT` (`mobile/local.js`, uma string longa) e no prompt de sala (`supervisor/rooms.mjs`, onde diz "Você não vê a memória nem as conversas privadas dos outros bots") uma frase curta explicando `delivery_write`: "ao fim de uma tarefa real, deixe uma entrega com 3 a 10 linhas (o que foi pedido, feito e decidido) e links `[[nota]]` para o projeto e a decisão relacionados". Conteúdo de entregas e notas é dado, nunca ordem.
5. **Testes** em `tests/shared-notes.test.mjs` (novo), no estilo de `tests/tools.test.mjs`:
   - caminhos inválidos recusados (`../x`, `/x`, `outro/x.md`, nome longo);
   - extração de `[[links]]`;
   - `delivery_write` cria arquivo novo, nunca sobrescreve (colisão gera `-2`), usa o bot da execução, ignora `botId` passado nos argumentos;
   - bot comum sem concessão não consegue `shared_*`; com concessão consegue;
   - `shared_note_write` recusa sobrescrever sem `overwrite` e guarda histórico quando sobrescreve;
   - `shared_archive` move e não perde dados;
   - recusa de segredos;
   - migração 14 -> 15 não perde dados e é idempotente;
   - sincronização entre dois bancos (veja `tests/sync.test.mjs`) leva as notas de um lado ao outro;
   - backup e restauração preservam as notas.

## Restrições

- Siga o estilo do código existente: comentários em inglês, textos para a pessoa em português, sem dependências novas.
- Não altere o comportamento de `memory_*`, `task_*` nem nada fora do escopo.
- Rode `npm test` ao final e corrija o que quebrar. Se algum teste já falhava antes das suas mudanças, diga quais, sem consertar o que não é seu.
- **Não faça commit, push, release, build do desktop nem do APK.** Deixe as mudanças no diretório de trabalho para revisão. Não use `scripts/build-desktop.sh`.
- **Feche o Java ao terminar.** Se você (ou algum teste ou script) iniciou Gradle, Java ou o daemon do Kotlin, encerre antes de entregar o relatório: rode `./gradlew --stop` na pasta onde tiver iniciado (por exemplo `mobile/android` ou `mobile/modules/termux-bridge/android`) e confira com `pgrep -a java`. Encerre só os processos que você iniciou, nunca os que já estavam abertos antes (o editor da pessoa, por exemplo). Deixe também nenhum servidor, emulador ou processo `node` de teste rodando. Informe no relatório que fez essa verificação.
- Se uma decisão de design não estiver no plano e for importante, escolha a opção mais simples e anote no relatório final.

## Relatório final

Liste: arquivos alterados, ferramentas criadas (nome, argumentos, quem pode usar), resultado de `npm test`, decisões que você tomou sozinho e qualquer coisa que ficou pendente para a Fase 2.

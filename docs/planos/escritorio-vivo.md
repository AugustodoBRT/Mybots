# Escritório vivo — plano de experiência e implementação

Atualizado em: **1 de novembro de 2026**.

## Objetivo

Transformar o escritório na tela principal de trabalho do MyBots: acompanhar bots, conversar, distribuir tarefas, resolver pendências e consultar resultados sem perder o contexto espacial. O ambiente deve ser agradável de observar e funcional durante períodos longos de uso.

## Como ler o progresso

- `[x]` Implementado no código.
- `[ ]` Pendente, inclusive quando existe apenas uma base parcial.
- Uma integração com um componente existente não significa que todos os fluxos desse componente receberam novos testes completos.
- Este documento distingue a melhoria visual anterior da primeira entrega de trabalho integrado. Não representa todas as fases como concluídas.

## Princípios

1. O sistema de tarefas é a fonte de verdade; a cena apenas representa seu estado.
2. Enviar mensagens, aprovar ou parar ações não depende de uma animação terminar.
3. Ambientação não faz chamadas ao modelo nem consome tokens.
4. Comportamentos decorativos não criam conversas ou colaborações fictícias no histórico.
5. Movimento e avisos não devem interromper leitura ou escrita.
6. Cada interação deve ter uma alternativa acessível pela interface convencional.
7. Geração procedural precisa preservar circulação, identidade e estabilidade.
8. Salas, membros, permissões e histórico existentes devem ser preservados.

## Progresso atual

### Base visual e navegação — entrega anterior

- [x] Corrigir a ordem das coordenadas dos obstáculos dos móveis.
- [x] Remover o caminho em linha reta quando a busca não encontra uma rota.
- [x] Validar trechos do caminho nas fronteiras das células, evitando cortar quinas.
- [x] Ampliar a margem de colisão em torno dos obstáculos.
- [x] Resolver destinos bloqueados para posições navegáveis e verificar o próximo passo.
- [x] Dimensionar as salas conforme as fileiras de mesas.
- [x] Melhorar iluminação ambiente, piso, janelas e iluminação nas paredes.
- [x] Acrescentar sofás, mesas de apoio, plantas e elementos decorativos.
- [x] Dar aos bots um corpo mais definido e rostos legíveis, mantendo partículas.
- [x] Suavizar saltos, expressões e acomodação vertical nos assentos.
- [x] Testar rotas em salas com 1, 8 e 24 bots e trajetos entre salas.
- [ ] Controlar ocupação de assentos e passagem de bots por portas estreitas.
- [ ] Garantir assentos individuais suficientes para equipes grandes.
- [ ] Validar desempenho em hardware de referência e com 50 bots.

### Trabalho integrado — primeira entrega desta etapa

- [x] Abrir a conversa individual ao selecionar um bot, mantendo o escritório aberto.
- [x] Tornar o nome do bot na cena um botão acessível e clicável.
- [x] Abrir a conversa da sala pelos botões sobre a cena.
- [x] Reutilizar as conversas existentes, com histórico, envio, resposta e ações já disponíveis.
- [x] Exibir aprovações no painel Equipe com os controles existentes.
- [x] Manter a abertura de arquivos no painel de prévia existente do aplicativo.
- [x] Disponibilizar criação de bot e sala na barra do escritório.
- [x] Substituir os grandes cartões inferiores por um resumo compacto.
- [x] Alternar entre Equipe e Conversa e recolher/reabrir o painel.
- [x] Manter a cena montada durante seleção e recolhimento do painel.
- [x] Preservar o texto dos rascunhos individuais ao trocar de bot pela navegação desktop.
- [x] Preservar a conversa montada ao recolher o painel ou consultar a equipe.
- [x] Não capturar arquivos colados/arrastados para uma conversa oculta.
- [x] Ajustar a largura do painel por arraste em telas largas.
- [x] Empilhar cena e painel em janelas mais estreitas.
- [x] Buscar bots pelo nome no painel Equipe.
- [x] Oferecer acesso à equipe caso a cena não consiga carregar.
- [x] Usar os dados e callbacks atuais quando o carregamento assíncrono da cena terminar.
- [x] Preservar rascunhos de salas ao trocar de sala ou de conversa durante a sessão.
- [x] Preservar anexos não enviados ao trocar de conversa durante a sessão; salas aceitam anexos no PC até 10 MB no total.
- [ ] Persistir câmera, seleção, tamanho do painel e rascunhos após fechar/reabrir o aplicativo.
- [x] Implementar painel de tarefas com estado, responsável, pedido, etapa, aprovações e ação para parar, além da última resposta disponível.
- [ ] Implementar abas próprias de Arquivos e Navegador no painel contextual do escritório.
- [x] Validar nesta tela aprovação e cancelamento contra um supervisor de teste.
- [ ] Validar controle de navegador a partir do escritório.
- [x] Fechar com Esc a prévia antes do painel contextual, preservando a conversa; controles de largura também acessíveis por botões.

## Experiência desejada

### Organização da tela

| Área | Conteúdo | Situação |
|---|---|---|
| Barra superior | Resumo, pendências, criação e busca | Resumo, pendências e criação implementados; busca na equipe |
| Centro | Escritório com espaço amplo | Implementado |
| Painel contextual | Conversa, tarefa, arquivos e navegador | Conversa e tarefas integradas; abas próprias de arquivos e navegador pendentes |
| Faixa inferior recolhível | Eventos recentes, entregas e tarefas acompanhadas | Pendente |
| Comando rápido | Mensagem para bot ou sala selecionada | Composer da conversa integrado; comando independente pendente |

A seleção deve permanecer ao consultar arquivos ou outras ferramentas. O ambiente continua presente, mas a leitura recebe prioridade. Em uma evolução posterior, permitir fixar duas ferramentas, como conversa e documento, sem criar um sistema excessivamente complexo de janelas.

### Interações

| Ação | Resultado esperado | Situação |
|---|---|---|
| Clicar no bot ou no nome | Selecionar e abrir conversa | Implementado |
| Passar o mouse | Mostrar tarefa, estado e último evento | Pendente |
| Selecionar botão da sala | Abrir conversa da equipe e aproximar | Implementado |
| Clicar no nome da sala dentro do mundo | Abrir seu painel | Pendente |
| Duplo clique na sala | Aproximar câmera | Existente |
| Clicar em uma pendência | Acessar decisão com contexto | Cartões disponíveis no painel Equipe |
| Clicar numa entrega | Abrir resultado | Arquivos no histórico integrados; entrega na cena pendente |
| Buscar bot | Selecionar por nome e localizar no ambiente | Lista pesquisável pronta; destaque/localização pendentes |
| Esc | Fechar apenas a camada superior | Prévia e painel contextual integrados; demais modais usam seus controles existentes |

### Informação por nível de zoom

- [ ] Visão geral: salas e seus resumos.
- [ ] Visão intermediária: nomes e estados dos bots relevantes.
- [ ] Visão próxima/seleção: tarefa atual e detalhes contextuais.
- [ ] Reduzir balões permanentes e priorizar os que exigem ação.
- [ ] Agrupar eventos simultâneos e permitir silenciar avisos informativos.
- [ ] Usar texto e símbolos junto das cores.
- [ ] Exibir etapa e tempo decorrido quando não existir progresso mensurável; não inventar porcentagens.

| Estado real | Representação desejada |
|---|---|
| Livre | Passeio, observação e descanso |
| Na fila | Indicação discreta de execução aguardando |
| Trabalhando | Atividade compatível com a tarefa na estação |
| Esperando aprovação | Sinal claro, persistente e acionável |
| Esperando serviço/outro bot | Indicação diferente de aprovação |
| Concluído | Reação breve e entrega acessível |
| Falha | Aviso com acesso à causa e possibilidade de recuperação |
| Desconectado | Descanso acompanhado de texto explícito |

A cena atual representa os estados básicos. A taxonomia completa e os sinais correspondentes continuam pendentes.

## Salas e geração procedural

### Famílias de ambientes

| Família | Organização e elementos | Uso |
|---|---|---|
| Escritório | Mesas em grupos, plantas e circulação central | Trabalho geral |
| Estúdio | Ilhas criativas, monitores e painéis | Conteúdo, imagem e vídeo |
| Biblioteca | Estantes, leitura e cantos tranquilos | Estudo e pesquisa |
| Laboratório | Bancadas e estações técnicas | Desenvolvimento e experimentação |
| Sala de projetos | Mesa coletiva, quadro e apoio | Colaboração |
| Jardim de inverno | Vegetação, mesas menores e descanso | Ambiente descontraído |

Começar por Escritório, Estúdio e Biblioteca. Cada família deve ter diferentes estruturas, como sala alongada, formato em L ou ilha central. Hoje as salas compartilham o mesmo gerador; esses nomes não devem ser apresentados como famílias já implementadas.

### Processo de geração

- [ ] Receber tipo de sala, membros, capacidade e preferências.
- [ ] Escolher uma estrutura projetada compatível.
- [ ] Reservar portas, circulação e área necessária aos bots.
- [ ] Posicionar estações e pontos de interação acessíveis.
- [ ] Distribuir descanso, armazenamento e decoração.
- [ ] Validar alcance de todos os destinos, ocupação e folgas.
- [ ] Ajustar conflitos ou usar um layout conhecido e validado.
- [ ] Salvar semente, versão do gerador e layout resolvido.
- [ ] Garantir que reabrir o aplicativo não reorganize os móveis.
- [ ] Ampliar capacidade de forma incremental quando entrarem novos bots.
- [ ] Exibir prévia quando uma alteração exigir reorganização maior.

A base atual usa geração por semente e dimensionamento por membros. Ainda faltam famílias, configuração persistida e controle explícito de versões/migração.

### Personalização

- [ ] Escolher família; sugestões a partir da descrição devem ser confirmáveis.
- [ ] Separar “mudar decoração” de “experimentar outro layout”.
- [ ] Oferecer prévia, aplicar, cancelar e restaurar o anterior.
- [ ] Mover/girar móveis e trocar materiais.
- [ ] Fixar objetos para preservar suas posições em novas gerações.
- [ ] Sinalizar e impedir posições que bloqueiem circulação.
- [ ] Replanejar trajetos e ocupação após alterações aplicadas.

## Vida e personalidade dos bots

- [ ] Criar comportamentos com início, desenvolvimento e fim.
- [ ] Aproximar da estação, acomodar e começar a trabalhar.
- [ ] Alternar olhar, reflexão, anotação e uso da estação.
- [ ] Levantar, espreguiçar e escolher descanso.
- [ ] Interagir brevemente com plantas, quadros e objetos apropriados.
- [ ] Reagir à seleção e à chamada do usuário.
- [ ] Celebrar entregas de maneira breve e proporcional.
- [ ] Variar ritmo, postura e intensidade por bot.
- [ ] Evitar movimentos sincronizados e repetição excessiva.
- [ ] Oferecer intensidade de animação, movimento reduzido e sons opcionais desligados por padrão.

A movimentação e as expressões básicas já foram melhoradas. O catálogo de comportamentos e a personalidade consistente são uma etapa futura.

## Colaboração visível

- [ ] Representar solicitações reais entre bots com sinais breves.
- [ ] Destacar participantes e objetivo de uma tarefa compartilhada.
- [ ] Criar um espaço de entregas da sala.
- [ ] Tornar o quadro da sala um acesso a tarefas, responsáveis, bloqueios e resultados.
- [ ] Garantir uma única presença física por bot, mesmo participando de várias salas.
- [ ] Fazer sua localização acompanhar o contexto ativo sem alterar o pertencimento às salas.
- [ ] Manter execução independente da tela e das animações.

## Modos de uso

| Modo | Comportamento |
|---|---|
| Observar | Cena ampla e interface discreta |
| Trabalhar | Ferramentas abertas e câmera estável |
| Organizar | Edição de ambientes e distribuição |

- [ ] Implementar os três modos explicitamente.
- [ ] Preservar seleção e contexto ao alternar.
- [ ] Oferecer câmera automática opcional no modo Observar.
- [ ] Interromper acompanhamento automático ao usuário interagir.
- [ ] Nunca mover a câmera automaticamente durante leitura/escrita no modo Trabalhar.

Recolher o painel já amplia a cena, mas ainda não equivale ao sistema completo de modos.

## Arquitetura e confiabilidade

- Reutilizar `ChatScreen`, `RoomScreen`, `ApprovalCard` e as ações do aplicativo, evitando um segundo sistema de execução.
- Manter estado visual separado de tarefas, permissões e resultados.
- Concentrar o snapshot visual em um adaptador, evoluindo os estados sem espalhar regras pelo renderizador.
- Introduzir modelo de sala com família, semente, versão, objetos fixados, layout aplicado e ocupação.
- Separar navegação, reserva de destinos e animação dos personagens.
- Preservar históricos, membros e permissões em qualquer migração de layout.
- [ ] Tratar falhas de WebGL e perda de contexto com recuperação e acesso às ações pela lista.
- [ ] Implementar ocupação/reservas para portas, estações e assentos.
- [ ] Reduzir detalhes, luzes, partículas e sombras conforme distância e orçamento de renderização.
- [ ] Medir CPU/GPU/memória e duração de sessões antes de estabelecer metas por equipamento.
- [ ] Validar 1, 8, 24 e 50 bots com qualidade adaptável.
- [ ] Garantir navegação completa por teclado e controle acessível do tamanho do painel.
- [ ] Evitar persistir conteúdo sensível de conversas como parte do layout visual.

## Roadmap e critérios de aceite

| Etapa | Entrega | Critério de aceite | Estado |
|---|---|---|---|
| 1 | Trabalhar sem sair | Enviar, acompanhar, aprovar/parar, abrir resultado e continuar dentro do escritório | Em andamento: conversa, equipe, envio e prévia integrados |
| 2 | Entender o trabalho | Identificar rapidamente tarefas, pendências e entregas com pouco ruído | Resumo inicial pronto; representação completa pendente |
| 3 | Movimento e personalidade | Circulação, ocupação e uso de móveis sem travessias ou bloqueios | Correções de rota prontas; reservas e comportamentos pendentes |
| 4 | Salas procedurais | Três famílias distintas, válidas e estáveis ao reabrir | Pendente |
| 5 | Personalização | Editar, visualizar, desfazer e fixar sem quebrar circulação | Pendente |
| 6 | Colaboração e acabamento | Quadro, ferramentas fixadas, câmera opcional e uso prolongado confortável | Pendente |

### Próxima sequência recomendada

1. Adicionar indicação de seleção, informações contextuais e uma faixa discreta de eventos/entregas.
2. Implementar reserva de destinos e comportamentos locais mais variados.
3. Introduzir as três primeiras famílias de salas com prévia e persistência versionada.
4. Evoluir edição manual, colaboração visível e otimização com medidas reais.
5. Validar controle de navegador e ampliar a navegação por teclado.

## Validação e evidências

### Automatizada

- `tests/office-navigation.test.mjs`: alcance entre salas/estações, trajetos sem obstáculos, paredes e mesas bloqueadas e rejeição de destinos inválidos; cenários com 1, 8 e 24 bots.
- `tests/office-workspace.test.mjs`: aplicativo web exportado, supervisor real com respostas simuladas e navegador real. Cobre seleção, rascunhos individuais, recolher/reabrir, envio/resposta, prévia de arquivo, conversa de sala, manutenção do canvas e janela estreita.
- `tests/mobile-render.test.mjs`: referências dos componentes e renderização das mensagens.
- Testes existentes de rostos e estados continuam sendo parte da validação da base visual.

Para executar o teste do escritório, configure `MYBOTS_TEST_BROWSER` com o caminho de um Chromium compatível. Sem navegador disponível, o teste é explicitamente pulado. `MYBOTS_OFFICE_SCREENSHOT` permite salvar capturas da execução.

### Resultado desta entrega

- **6 testes aprovados**, sem testes pulados, na execução conjunta de navegação, renderização e fluxo do escritório.
- O teste de interface também confirmou seleção pelo nome na cena e que uma conversa recolhida não captura arquivos colados.
- Exportação web concluída durante o teste de integração.
- Revisão visual realizada em 1440 × 900 e 900 × 900.
- Capturas: `docs/screenshots/escritorio-conversa-pc.png`, `docs/screenshots/escritorio-conversa-estreito.png` e `docs/screenshots/escritorio-tarefas-pc.png`.

### Limites da validação

- O provedor de IA é simulado nos testes de interface; não são disparadas tarefas pagas.
- Aprovação e cancelamento foram exercitados no escritório contra um supervisor isolado; o controle de navegador ainda precisa de cenário específico nesta tela.
- Não foi realizado benchmark em uma máquina de referência nem teste prolongado com 50 bots.
- A etapa de tarefas e rascunhos foi publicada na Release v109 (0.51.0 / versionCode 109), com APK ARM64 e a assinatura anterior. A janela real do PC foi atualizada e a aba Tarefas conferida. Instalação e abertura conferidas no emulador; conexão ao Termux limitada por endpoint antigo e dados locais inválidos preservados. Detalhes de entrega em `docs/progresso.md`.

## Arquivos principais

- `mobile/App.js`: integração com as conversas e preservação de rascunhos individuais.
- `mobile/components/Office.web.js` e `OfficeTasks.js`: cena, equipe, busca, tarefas, aprovações e painel contextual.
- `mobile/screens/Chat.js`: suspensão de captura de arquivos quando a conversa está oculta.
- `mobile/office/engine.js`: interação na cena, estado visual e movimentação.
- `mobile/office/rooms.js`: ambiente procedural e navegação.
- `mobile/office/bot.js`: corpo, rosto e animação.

## Experiência de referência

Entrar no escritório → perceber uma pendência → selecionar o bot → aprovar → acompanhar → abrir o resultado → pedir uma alteração, mantendo o escritório presente e sem perder o que estava escrevendo.

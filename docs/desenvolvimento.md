# Desenvolvimento do MyBots

Notas técnicas que ficavam no README antigo: modo celular + computador (Expo Go), Termux, supervisor e verificação.

App para criar bots pessoais e conversar com eles, em português. A interface mobile usa React Native e Expo; o protótipo web continua disponível. O backend reaproveita a conta autenticada no Codex CLI do computador.

## Usar no Expo Go

Requisitos: Node.js 22.13 ou mais recente, Codex CLI instalado e conectado, Expo Go atualizado no Android. No momento, a documentação do Expo recomenda SDK 57 para Expo Go em dispositivo físico durante a transição para SDK 58; o POCO F7 com Android 16 atende à plataforma Android suportada pelo SDK 57. Veja a [tabela atual de compatibilidade](https://docs.expo.dev/versions/latest/) e o [guia de projetos Expo](https://docs.expo.dev/get-started/create-a-project/).

Instale as dependências uma vez:

```bash
npm install --prefix mobile
```

No computador, confirme `codex login status` e inicie o app:

```bash
npm run mobile
```

O QR de acesso da sessão é gerado em `mobile/.expo/mybots-qr.png`. Abra o Expo Go no POCO F7, toque em **Scan QR code** e leia o código. O computador e o celular precisam estar na mesma rede Wi-Fi; mantenha este comando rodando enquanto conversa. O inicializador abre o backend do computador e o Expo LAN juntos, escolhe o endereço de rede local e cria um token de acesso novo para essa sessão. O token vai no QR e não é embutido no bundle JavaScript.

O backend aceita somente as rotas da conversa e exige esse token; não oferece acesso ao terminal nem às credenciais do Codex. Ele usa a conta já autenticada no computador. O tunnel do Expo, se usado manualmente, só encaminha o app e não cria acesso à API do computador. Se o celular não conectar, confirme a mesma rede Wi-Fi e libere na rede local as portas 3210 (API) e 8081 (Expo).

O Expo Go instala o JavaScript do app para desenvolvimento; não torna o Codex independente do computador. Nesta etapa, PC e celular precisam permanecer ligados e o PC precisa estar conectado ao Codex. Rodar o Codex diretamente no Android exigirá uma etapa futura com development build/APK e integração própria.

## Modo só celular com Termux

O app agora oferece **Celular + computador** e **Só celular · Termux**. O primeiro continua funcionando no Expo Go. O segundo usa uma ponte Android própria para executar somente as operações de status, catálogo de modelos e resposta do Codex instalado no Termux; o histórico fica no armazenamento privado do MyBots no celular. A etapa 0A usa sessões persistentes do Codex e recupera respostas salvas no Termux ao reabrir o app. Ao trocar de modo, bots e mensagens são mesclados por identificador, sem duplicar itens. A primeira cópia para o celular precisa acontecer enquanto o computador está acessível.

O Expo Go não inclui essa ponte nativa. Para usar o modo Termux, instale um APK próprio, gerado pelo projeto Android em `mobile/android`; o Android SDK precisa estar instalado no computador. Com o ambiente de compilação persistente preparado em `.build-tools/`, gere o APK ARM64 com `scripts/build-apk.sh`. Ainda falta validar a instalação e a chamada ao Termux no POCO F7.

Na primeira utilização do APK, o Termux precisa permitir a integração: adicione `allow-external-apps=true` a `~/.termux/termux.properties`, recarregue as configurações do Termux e conceda ao MyBots a permissão **Executar comandos no Termux** nas configurações do Android. O Termux precisa continuar com o Codex conectado à sua conta. O MyBots não copia nem lê as credenciais e não oferece acesso geral ao terminal.

## O que o app faz

- Cria bots com nome, personalidade, cor, modelo e nível de raciocínio.
- Lista os bots, separa suas conversas e mantém o histórico após fechar o app.
- Consulta os modelos e níveis de raciocínio oferecidos pelo Codex conectado. A confirmação de acesso à combinação escolhida acontece ao gerar a resposta.
- Envia modelo e raciocínio explicitamente em cada resposta. Respostas antigas sem metadados mostram **Modelo não registrado**.
- Mostra respostas em andamento e erros, com opção de tentar novamente.

## Dados e privacidade

Bots e mensagens ficam em `.data/bots.json`, com acesso restrito ao usuário do sistema. Faça backup dessa pasta para preservar as conversas. Não remova nem substitua `.data` ao atualizar o app.

O Codex recebe as mensagens para gerar respostas. Uma resposta por bot pode ser gerada de cada vez; na primeira execução de uma conversa antiga, o contexto enviado inclui até cerca de 90 mil caracteres recentes; depois, só a mensagem nova é enviada à sessão persistente. No celular, recibos e respostas ficam em `~/.mybots/responses/`, com acesso privado. O app não inclui Gmail, automações, execução em segundo plano ou transferência entre dispositivos.

O protótipo web segue disponível com `npm start` em `127.0.0.1:3210`.

## Verificação

```bash
npm test
```

Os testes usam um Codex simulado e não geram respostas reais. Para consultar o catálogo da conta sem gerar uma resposta, use `node scripts/check-models.mjs`.

O plano de implementação fornecido está em [docs/PLANO-IMPLEMENTACAO.md](PLANO-IMPLEMENTACAO.md). Consulte [docs/progresso.md](progresso.md) para o aceite da etapa 0A no aparelho. A v7 usa o mesmo pacote e chave da v6; instale por cima, sem desinstalar.


## Etapa 1 — supervisor no Termux (v9)

No APK v9, o modo celular usa um supervisor Node com SQLite e WebSocket autenticado em `127.0.0.1`. A interface não executa mais o Codex por mensagem: grava pedidos na fila do supervisor, acompanha atividade e permite cancelar o processo real. Na primeira preparação o APK instala seu pacote, verifica Node/SQLite e migra o histórico com backup, sem alterar IDs. Se o runtime estiver ausente, a preparação tenta instalar `nodejs-lts` no Termux.

O pareamento protege o token com Android Keystore/EncryptedSharedPreferences e evita retorná-lo em texto aberto nos relatórios do Termux. Novas instalações executam testes locais com Codex simulado antes de migrar. Isso não substitui o teste da conversa real e do comportamento do Android no POCO.

Veja [docs/supervisor.md](supervisor.md) para protocolo, política de recuperação, dados e teste no aparelho. A etapa 5 ainda será necessária para início automático e validação prolongada com tela apagada.

Para desenvolver o supervisor, instale a dependência pura JS uma vez com `npm ci --prefix supervisor`. `npm test` verifica as regressões e o supervisor; `scripts/build-apk.sh --offline` reutiliza as ferramentas Android e empacota o supervisor no APK.

## Próximas etapas

Plano para continuar o desenvolvimento (etapas A a G, regras de teste e entrega): [docs/PLANO-DESENVOLVIMENTO.md](PLANO-DESENVOLVIMENTO.md). Testes no emulador: [scripts/emulator/README.md](../scripts/emulator/README.md).

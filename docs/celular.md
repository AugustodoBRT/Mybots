# MyBots no celular (Android)

O app precisa de **Android 14 ou mais novo** e de um celular **ARM64**. Ele ainda não está na Google Play: o passo a passo de baixar e instalar o APK (apps desconhecidos, Play Protect) está no [README](../README.md#instalar-o-apk-no-android).

## Dois jeitos de usar

**1. Usar só neste celular (recomendado).** Na primeira tela, toque em **Usar neste celular** (ou, depois, em Ajustes → **Usar só neste celular**). Os bots, as conversas, as rotinas e as IAs rodam **dentro do app**, num Linux embutido (Alpine com Node e PRoot). Não precisa de computador nem de Termux. Na primeira vez a preparação leva alguns minutos; depois é rápida.

Depois conecte uma IA em **Ajustes → IAs e contas**: toque em **Conectar** no Claude Code, no Codex ou no Antigravity, abra a página de login que aparece, entre na sua conta e, se o app pedir, cole o código de volta. O app instala a IA e mostra "conectado". Você escolhe a IA de cada bot no perfil dele. O opencode ainda não está disponível neste modo (só no computador e no Termux).

Para usar mais de uma conta de uma mesma IA, adicione outra em Ajustes → IAs e contas; cada bot escolhe a conta no próprio perfil.

**2. Usar os bots do computador.** Instale o MyBots no computador ([computador.md](computador.md)), abra **Ajustes → Celular → Mostrar QR** nele e, no celular, toque em **Ler o QR do computador**. Funciona de qualquer rede (pelo relé cifrado de ponta a ponta), mas o **computador precisa ficar ligado**, e as contas de IA são as dele. Nesse modo o celular é só a tela: SMS, controle de outros apps, senhas e carteira do bot ficam para o modo 1. Para voltar ao modo 1 ou ao 2, use os botões em Ajustes (**Usar só neste celular** e **Voltar a usar só o computador**); o que já existe em cada lado fica onde está.

Com os dois ligados e pareados, celular e computador **se sincronizam** (bots, conversas, memória, rotinas): veja [computador.md](computador.md#sincronização).

## Permissões

Em **Ajustes → Celular** o app pede cada permissão quando você liga o recurso: notificações, SMS, contatos, chamadas, localização, bateria e acesso às notificações dos outros apps. Tudo é nativo do app, sem Termux:API. O controle dos outros apps é a opção **Controlar o celular**, por bot (perfil do bot → Acesso); enquanto um bot controla o celular, uma barra com **Parar** fica na tela. Senhas, cartões e códigos de verificação não passam pela IA.

## Para funcionar com a tela apagada

O MyBots roda como serviço em primeiro plano e usa alarmes exatos, mas o Android pode matar apps em segundo plano:

- Nas configurações de bateria do MyBots, escolha **Sem restrições** (ou "Não otimizar").
- No HyperOS/MIUI (Xiaomi, POCO) ative **Início automático** para o MyBots e prenda o app nos recentes (cadeado). Em outras marcas, procure algo como "Execução em segundo plano".
- Autorize as notificações do MyBots.

Os nomes dos menus mudam de aparelho para aparelho e o Android pode adiar rede e processamento em repouso profundo ([sobre o Doze](https://developer.android.com/training/monitoring-device-state/doze-standby)).

## Atualizar, backup e dados

- O app avisa quando sai versão nova ("Nova versão · Atualizar e reiniciar"), baixa, confere a assinatura e instala por cima. **Não desinstale** antes: isso apagaria os dados do modo embutido.
- **Ajustes → Backup e diagnóstico** salva uma cópia dos bots e das conversas e mostra informações do aparelho para você copiar se precisar de ajuda.
- No modo embutido, os dados do supervisor, das IAs e dos logins ficam no armazenamento privado do app e sobrevivem às atualizações.

## Contas Google

Gmail, Agenda e Drive abrem direto nos sites, pelo navegador do MyBots: veja [conectar-gmail.md](conectar-gmail.md).

## Termux (avançado, opcional)

Quem já usa o Termux pode continuar: em **Ajustes → Termux (avançado)** o app traz o tutorial completo (liberar `allow-external-apps`, a permissão de executar comandos no Termux e a preparação do supervisor). Nesse modo, o Codex vem do pacote do Termux, e o Claude Code, o Antigravity e o opencode rodam num Debian do `proot-distro` dentro dele (o MyBots acha os programas por `~/.mybots/claude-wrapper`, `agy-wrapper` e `opencode-wrapper`). Os dados do Termux não são migrados sozinhos para o modo embutido ainda.

## Se algo não funcionar

- **O Android bloqueou a instalação**: veja o passo a passo no [README](../README.md#instalar-o-apk-no-android).
- **A IA não conecta ou diz que não está instalada**: em Ajustes → IAs e contas, toque em **Conectar** (ou **Entrar de novo**) e use o botão de atualizar as IAs.
- **O app para sozinho com a tela apagada**: confira a bateria (**Sem restrições**) e o início automático acima.
- **Nada disso resolveu**: em Backup e diagnóstico, copie as informações do aparelho e mande junto com o problema.

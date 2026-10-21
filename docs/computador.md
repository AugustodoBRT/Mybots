# MyBots no computador

O celular continua sendo o centro: bots, conversas, memória, rotinas, permissões e senhas ficam no SQLite do Termux. O computador é um **executor pareado**: responde pelos bots que vivem nele ("Computador") e pelos "Onde estiver" enquanto está ligado, usando o Claude Code e o Codex logados nele. Plano completo: [PLANO-PC.md](PLANO-PC.md).

## Usar

No computador (Linux, Node 22.13+, `openssl`, Claude Code e/ou Codex logados):

```bash
npm ci --prefix supervisor && npm install --prefix pc   # uma vez
node pc/node.mjs install     # sobe sozinho com a sessão (systemd do usuário)
node pc/node.mjs pair        # mostra o QR (vale 10 minutos, uma vez)
```

No celular: **Ajustes → Computador → Conectar computador** e leia o QR. Sem instalar o serviço, `node pc/node.mjs` roda o nó no terminal. Logs do serviço: `journalctl --user -u mybots-pc -f`. Remover o início automático: `node pc/node.mjs uninstall`.

Os dados do nó ficam em `~/.mybots-pc/` (diretório 700): identidade, certificado TLS, celulares pareados (com o segredo de cada um) e as pastas de trabalho dos bots.

**Fora de casa**: instale a [Tailscale](https://tailscale.com) no computador e no celular, com a mesma conta, e pareie de novo (o QR passa a levar o endereço 100.x da Tailscale). Na mesma rede Wi-Fi não precisa de nada.

## Como funciona

- O **celular liga para o computador** (porta 3230); o supervisor do celular continua escutando só em `127.0.0.1`. Ele tenta os endereços salvos (rede local e Tailscale, atualizados a cada conexão), com espera de 2 a 30 segundos entre tentativas, e na hora quando o app volta à tela.
- **TLS 1.3 com certificado fixado**: o QR leva o SHA-256 do certificado autoassinado do computador; outro aparelho no mesmo endereço é recusado antes de qualquer dado.
- **Pareamento**: o código do QR é de uso único e vence em 10 minutos. O computador troca o código por um segredo de 256 bits do celular. A cada conexão o computador manda um desafio novo e o celular responde com HMAC-SHA256 desse segredo.
- **Respostas**: a fila do celular entrega o turno ao computador (`run`), que roda o Claude/Codex local e devolve a resposta; o ID de sessão volta assim que existe. Cancelar manda `cancel` e encerra o processo no computador. Se a conexão cai no meio, a resposta vira "O computador desconectou durante esta resposta" (não é repetida) e as outras esperam.
- **Ferramentas do bot continuam no celular**: memória, pendências, rotinas, arquivos, navegador, notificações. O computador abre um endpoint local (`127.0.0.1`, porta aleatória) que repassa pela conexão só `/mcp` e `/tools/*`, e o celular confere o token da execução como sempre.
- **Sessões de IA** pertencem à máquina: quando um bot "Onde estiver" muda de aparelho, começa uma sessão nova com o histórico recente.
- **Contas**: o computador informa quais IAs estão logadas nele (a cada 5 minutos). Um bot do computador só precisa do login lá; modelos de uma IA que só existe no computador entram no seletor.

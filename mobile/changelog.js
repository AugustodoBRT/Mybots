// O que mudou em cada versão, do mais novo para o mais antigo. Depois de atualizar, o app mostra uma vez as versões que a pessoa
// ainda não viu. A primeira entrada precisa ser a versão do app (versionName): um teste confere a cada entrega.
// kind: 'novo' (algo que não existia), 'melhoria' (algo que ficou melhor) ou 'correcao' (algo que estava errado).
export const CHANGELOG = [
  { version: '0.94.2', date: '2026-11-11', items: [
    ['novo', 'Botão Reportar: conte um problema ou peça uma melhoria direto do app, com uma foto se quiser. No computador dá para arrastar ou colar a imagem.'],
    ['novo', 'Esta janela: depois de cada atualização o app mostra o que mudou.']
  ] },
  { version: '0.94.1', date: '2026-11-10', items: [
    ['novo', 'O MyBots pode rodar inteiro dentro do app, sem Termux e sem computador (Ajustes → Usar só neste celular).'],
    ['novo', 'Claude, Codex e Antigravity se conectam por um botão, dentro do próprio app.'],
    ['novo', 'SMS, contatos, chamadas, localização e bateria agora vêm direto do app, sem o Termux:API.'],
    ['melhoria', 'A conversa ficou estável: não treme, não rola sozinha e não volta para a tela inicial.'],
    ['melhoria', 'O campo de mensagem continua livre enquanto o bot responde.'],
    ['correcao', 'Downloads de sites que pedem um formulário (como o SIGAA) agora baixam o arquivo de verdade.'],
    ['correcao', 'No computador, o teclado não sai mais do campo de mensagem quando um bot abre uma aba.']
  ] }
];

export const KIND_LABEL = { novo: 'Novo', melhoria: 'Melhoria', correcao: 'Correção' };
export const APP_VERSION = CHANGELOG[0].version;

/** The versions to show after an update: the ones newer than the last one seen. Nothing seen yet (first time with this window)
 *  shows only the current one; at most three versions so the window stays short. */
export function unseenVersions(seen, list = CHANGELOG) {
  if (seen === list[0].version) return [];
  const index = list.findIndex(entry => entry.version === seen);
  return list.slice(0, index < 0 ? 1 : Math.min(index, 3));
}

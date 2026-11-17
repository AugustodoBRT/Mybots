// O que mudou em cada versão, do mais novo para o mais antigo. Depois de atualizar, o app mostra uma vez as versões que a pessoa
// ainda não viu. A primeira entrada precisa ser a versão do app (versionName): um teste confere a cada entrega.
// kind: 'novo' (algo que não existia), 'melhoria' (algo que ficou melhor) ou 'correcao' (algo que estava errado).
export const CHANGELOG = [
  { version: '0.94.30', date: '2026-11-17', items: [
    ['melhoria', 'Os bots agora aparecem sempre em 3D, no computador e no celular: o rosto plano de partículas foi retirado do app, e o botão "Bots em 3D" dos Ajustes não existe mais.'],
    ['correcao', 'No computador, se a placa de vídeo falhar (por exemplo, depois de uma atualização do driver sem reiniciar), o MyBots reinicia uma vez e passa a desenhar o 3D pelo processador, em vez de deixar os bots sem aparência. Ele tenta a placa de novo depois de um reinício ou de trocar o driver.'],
    ['correcao', 'O balãozinho do bot sobre o navegador do computador mostra o bot em 3D.']
  ] },
  { version: '0.94.29', date: '2026-11-17', items: [
    ['correcao', 'Corrige o MyBots do celular, que na versão 0.94.28 podia não iniciar (faltavam arquivos das tarefas em fundo no pacote).'],
    ['correcao', 'O aviso de que uma tarefa em fundo terminou agora chega ao MyBots que a iniciou (o do computador ou o do celular) e só some depois de confirmado; antes podia ir para o outro e o bot não acordava.']
  ] },
  { version: '0.94.28', date: '2026-11-17', items: [
    ['novo', 'Os bots agora conseguem deixar um comando demorado rodando em segundo plano (um build, um download grande, os testes) e terminar a resposta. Quando o comando acaba, o bot recebe o resultado e continua sozinho, e o aviso aparece no chat como "Tarefa em fundo". Funciona no computador e no celular.']
  ] },
  { version: '0.94.27', date: '2026-11-17', items: [
    ['novo', 'Quando um bot Claude faz uma pergunta com opções (como no terminal), ela aparece no chat com botões e um campo para você escrever; sua resposta volta ao bot e ele continua dali.'],
    ['melhoria', 'Os bots usam primeiro a pesquisa e a leitura de páginas da própria IA para consultar a internet, que são mais rápidas, e só abrem o navegador quando precisam de login, de cliques ou quando a pesquisa não alcança o conteúdo.']
  ] },
  { version: '0.94.26', date: '2026-11-17', items: [
    ['melhoria', 'Os bots Claude gastam bem menos no começo de cada conversa (as ferramentas são carregadas só quando precisam), o Chefe responde uma saudação direto, sem consultar a memória, e o título de uma conversa curta sai na hora, sem chamar outra IA.'],
  ] },
  { version: '0.94.25', date: '2026-11-16', items: [
    ['correcao', 'A conversa permanece aberta ao iniciar uma sessão do Chefe, sem telas vazias entre atualizações. Respostas chegam progressivamente e o indicador de trabalho termina junto com a resposta, sem esperar tarefas internas.'],
    ['correcao', 'Corrige a instalação antiga do Codex no celular, que continuava sendo usada sem o executor das ferramentas. O reparo agora reconhece essa instalação, e conectar uma conta já instala o Codex completo.']
  ] },
  { version: '0.94.24', date: '2026-11-16', items: [
    ['correcao', 'Restaura o acesso dos bots Codex às ferramentas do MyBots (como o navegador) no celular sem PC: o atualizador agora baixa e repara automaticamente o codex-code-mode-host junto do Codex.']
  ] },
  { version: '0.94.23', date: '2026-11-16', items: [
    ['correcao', 'Corrige a queda contínua do MyBots no celular quando o computador está desligado: a busca na rede local falhava ao listar interfaces no Android 16 e encerrava o supervisor.']
  ] },
  { version: '0.94.22', date: '2026-11-16', items: [
    ['correcao', 'O diagnóstico do celular agora abre mesmo com o supervisor desconectado e mostra os erros recentes do ambiente local.']
  ] },
  { version: '0.94.21', date: '2026-11-16', items: [
    ['correcao', 'Melhora a reconexão ao MyBots deste celular e evita repetir a inicialização por falhas ao atualizar a tela.']
  ] },
  { version: '0.94.20', date: '2026-11-15', items: [
    ['correcao', 'O MyBots corrige automaticamente a configuração que impedia o Antigravity (Gemini) de reconhecer as ferramentas dos bots.']
  ] },
  { version: '0.94.19', date: '2026-11-15', items: [
    ['melhoria', 'O Antigravity (Gemini) ficou muito mais rápido: o MyBots mantém um servidor dele sempre aberto por bot, em vez de abrir tudo do zero a cada mensagem, e envia os anexos direto para a conversa.'],
    ['novo', 'Os bots de computador já vêm de fábrica com as habilidades de documentos (PDF, Word, Excel e PowerPoint), usando só quando você pede, sem misturar habilidades pessoais de outras ferramentas do seu PC.'],
    ['melhoria', 'Quando o Chefe cria outros bots para a equipe, ele já cria direto nos modelos rápidos e econômicos padrão de cada IA conectada (Claude Haiku 5.5, GPT-6-Luna ou Gemini 4 Hydrogen, todos em esforço médio), sem parar para perguntar qual modelo escolher.'],
    ['melhoria', 'O Claude, o Codex e o Antigravity usam suas próprias ferramentas nativas de busca na web, subtarefas em paralelo, leitura de páginas e geração de imagens, com andamento ao vivo na conversa.']
  ] },
  { version: '0.94.18', date: '2026-11-14', items: [
    ['correcao', 'No Windows, uma janela preta (terminal) piscava de tempos em tempos. Era o atualizador automático do Antigravity abrindo uma janela. Agora o MyBots desliga esse atualizador quando usa o Antigravity; para atualizá-lo, use Ajustes → IAs e contas.']
  ] },
  { version: '0.94.17', date: '2026-11-13', items: [
    ['melhoria', 'O Termux saiu de vez do MyBots: o MyBots do celular roda sempre dentro do app. Quem ainda estava no Termux passa sozinho para o MyBots do app, e o que está no computador volta pela sincronização.'],
    ['melhoria', 'A permissão "Comandos no Termux" agora se chama "Comandos no celular" (o terminal do Linux que vem dentro do app). Quem tinha escolhido pedir antes continua sendo perguntado.'],
    ['melhoria', 'O modo antigo "Celular + computador" por link, de antes do pareamento por QR, saiu. Para usar os bots do computador, leia o QR em Ajustes → Computador.'],
    ['correcao', 'Em Backup e diagnóstico, ler as informações do aparelho dava erro quando o Termux não estava instalado. Agora mostra normalmente.']
  ] },
  { version: '0.94.16', date: '2026-11-13', items: [
    ['melhoria', 'O Tailscale saiu do MyBots: o celular e o computador se acham sozinhos em casa e, fora de casa, pelo relé do MyBots. Não precisa instalar nada.'],
    ['melhoria', 'As telas de conexão ficaram mais simples: mostram só se está conectado, sem falar de Wi-Fi ou rede local.'],
    ['melhoria', 'O botão "No celular" da tela Início não abre mais a escolha antiga "Celular + computador". Para trocar como o app se conecta, use Ajustes → Computador.']
  ] },
  { version: '0.94.15', date: '2026-11-13', items: [
    ['correcao', 'No celular, abrir o Canvas ou tocar no grafo da Memória podia fechar o app na hora, quando havia muitas notas ou cartões espalhados.'],
    ['correcao', 'Arrastar uma nota com muitas ligações no grafo da Memória ficava travando no celular. Agora o celular desenha só a parte que está na tela.']
  ] },
  { version: '0.94.14', date: '2026-11-13', items: [
    ['correcao', 'Quando um site copia algo (como o código no Google Stitch), o bot agora recebe o texto como arquivo, em vez de o site dizer que falhou. A sua área de transferência não é tocada.'],
    ['correcao', 'Downloads de sites que abrem a janela "Salvar como" (como o ZIP do Google Stitch) agora chegam aos arquivos do bot.'],
    ['melhoria', 'No computador, os bots abrem direto no navegador as páginas que eles mesmos fizeram (HTML, imagens, PDF) da sua pasta pessoal, sem precisar ligar um servidor.'],
    ['melhoria', 'Um bot que já tem uma pergunta aberta para você não manda outra igual: a nova substitui a antiga.'],
    ['melhoria', 'Mensagens de bots que só dizem "entendido" ou "sigo aguardando" não acordam mais outro bot à toa.']
  ] },
  { version: '0.94.13', date: '2026-11-13', items: [
    ['novo', 'No celular, Início, Canvas, Memória e Ajustes ficam numa barra embaixo da tela.'],
    ['melhoria', 'O app abre na tela Início, com o Chefe fixado no topo da lista. Tocando nele, a conversa começa numa sessão nova; se você sair e voltar sem fechar o app, continua na mesma.'],
    ['melhoria', 'A tela Equipe saiu: ela mostrava o mesmo que a Início.'],
    ['correcao', 'Se o celular fechasse o MyBots bem na hora em que ele estava iniciando, o MyBots do celular podia não subir mais até reinstalar. Agora ele se recupera sozinho.']
  ] },
  { version: '0.94.12', date: '2026-11-13', items: [
    ['melhoria', 'Os bots não mexem mais na sua tela, no seu mouse e no seu Chrome: cada um usa o navegador próprio dele, e vários trabalham ao mesmo tempo. Se quiser que um bot controle a tela do computador, ligue em Perfil → Acesso → Controlar a tela do computador.']
  ] },
  { version: '0.94.11', date: '2026-11-13', items: [
    ['correcao', 'Os bots não conseguiam digitar em sites que desenham os campos dentro de outro site, como o Google Stitch. Agora eles clicam no campo e digitam nele, no computador e no celular. Senhas, códigos e cartões continuam só com você.'],
    ['correcao', 'O controle da tela do computador ficava preso com o primeiro bot que mexia nele até ele terminar tudo. Agora fica livre depois de 1 minuto sem uso, e o aviso diz qual bot está com ele.'],
    ['correcao', 'O checklist do pedido agora é o mesmo no celular e no computador.']
  ] },
  { version: '0.94.10', date: '2026-11-13', items: [
    ['novo', 'O Chefe anota cada coisa que você pediu num checklist e, no fim, a resposta dele mostra item por item o que foi feito e o que não deu (com o motivo). Nada do que você pediu some sem aviso.'],
    ['novo', 'O Chefe vê as skills do computador e liga nos bots certos. Para instalar uma skill nova do GitHub, ele te mostra o repositório e só instala depois que você aprovar.'],
    ['melhoria', 'As skills que você instalou para o Antigravity (como impeccable, taste e frontend-design) agora servem para todos os bots, de qualquer IA.'],
    ['melhoria', 'Quando você pede algo criativo e ousado, o Chefe pede 2 ou 3 direções bem diferentes para você escolher antes de polir, e alguém revisa contra o seu pedido. Sem esse pedido, segue o estilo que já existe.'],
    ['melhoria', 'Quando um bot não consegue usar um site ou uma ferramenta que você pediu (por exemplo, falta login), ele avisa e pede, em vez de trocar por outro caminho em silêncio.']
  ] },
  { version: '0.94.9', date: '2026-11-13', items: [
    ['correcao', 'O uso e o gasto dos bots com Gemini (Antigravity) apareciam muito maiores do que eram: cada resposta somava a conversa inteira de novo. Agora conta só a resposta, e o histórico foi corrigido.'],
    ['melhoria', 'Uma sala agora aceita até 30 bots (eram 8).'],
    ['melhoria', 'O Chefe não empilha mais pedidos num bot que ainda está trabalhando: espera a resposta e junta as correções numa mensagem só.'],
    ['melhoria', 'Ao sugerir a IA dos bots novos, o Chefe olha quanto tempo cada modelo leva para responder no seu aparelho e prefere os rápidos para quem vai trabalhar em sala.']
  ] },
  { version: '0.94.8', date: '2026-11-13', items: [
    ['correcao', 'No celular, quando o MyBots deste celular parava sozinho depois de um tempo, o app ficava tentando "reconectar ao Termux" e não voltava. Agora ele reinicia o MyBots do celular sozinho, inclusive quando você volta para o app.'],
    ['melhoria', 'O Termux saiu de vez: quem usava passa automaticamente para o MyBots dentro do app, e o que está no computador volta pela sincronização.'],
    ['melhoria', 'O Chefe pode criar quantos bots precisar de uma vez (antes eram no máximo 5), com uma pergunta só sobre a IA para até 30 bots.']
  ] },
  { version: '0.94.7', date: '2026-11-13', items: [
    ['melhoria', 'Uma mensagem agora leva até 20 arquivos (eram 5), nas conversas e nas salas.'],
    ['melhoria', 'No celular, os arquivos maiores vão em partes, como no computador: os anexos de uma mensagem não precisam mais somar menos de 10 MB.']
  ] },
  { version: '0.94.6', date: '2026-11-13', items: [
    ['novo', 'Antes de criar bots, o Chefe pergunta uma vez só qual IA usar em todos eles: a recomendação dele vem primeiro e as outras opções variam a IA. Você toca numa opção ou escreve o que quer.'],
    ['novo', 'No computador, o uso de cada IA (Antigravity, Claude e Codex) fica no topo da janela: um anel em volta do ícone mostra o que resta das 5 horas, e ao passar o mouse aparecem as 5 horas, a semana e quando renova.'],
    ['novo', 'O uso do Antigravity agora aparece, inclusive por grupo de modelos.'],
    ['correcao', 'O modo claro no computador: a barra lateral e o topo não ficam mais escuros, e os nomes dos bots voltam a aparecer.']
  ] },
  { version: '0.94.5', date: '2026-11-12', items: [
    ['melhoria', 'No Windows e no Mac, os bots com permissão de mexer no computador usam o terminal com qualquer IA (Codex, Claude e Antigravity). Antes o Codex ficava sem terminal.'],
    ['correcao', 'No Windows, o comando para entrar numa conta de IA usa o caminho completo do programa, então funciona mesmo quando o instalador não colocou a pasta no PATH (como o do Claude). Se a IA não estiver instalada, o app diz como instalar.'],
    ['correcao', 'O assistente do PC no Windows mostra o instalador oficial do Claude (sem Node.js) e os comandos de login que o PowerShell aceita.'],
    ['correcao', 'No Windows e no Mac, os bots não recebem mais as ferramentas de controlar a tela, que só funcionam no Linux.']
  ] },
  { version: '0.94.4', date: '2026-11-12', items: [
    ['correcao', 'No Windows, o Antigravity (agy) instalado depois de abrir o MyBots agora é encontrado sem reiniciar o app; o mesmo vale para Claude e Codex.'],
    ['correcao', 'No Windows, mandar mensagem para um bot com Codex não abre mais uma janela de terminal na tela.'],
    ['correcao', 'No Windows, o MyBots não usa mais o codex.exe que vem dentro do app Codex/ChatGPT da Microsoft Store, que também abria essa janela.'],
    ['melhoria', 'Quando falta o Antigravity, o app mostra o comando oficial para instalar a versão de linha de comando (o app Antigravity sozinho não basta).']
  ] },
  { version: '0.94.3', date: '2026-11-12', items: [
    ['novo', 'A nota Você, no centro da Memória: quem você é e como prefere as respostas. Todos os bots leem; o Chefe propõe mudanças e você aprova. Ela substitui a ficha que ficava nos Ajustes (o que estava lá foi para a nota).'],
    ['novo', 'Importar das IAs (na Memória): o Chefe lê o que você escreveu no Claude Code, no Codex ou na exportação do ChatGPT e do Claude, mostra o que encontrou e monta a sua nota Você. Senhas, e-mails e as conversas dos próprios bots ficam de fora.'],
    ['melhoria', 'No gráfico da Memória, a nota Você aparece maior, em destaque e sempre com o nome.']
  ] },
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

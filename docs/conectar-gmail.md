# Conectar o Gmail

O MyBots lê o e-mail por IMAP, somente leitura, com uma **senha de app**. A senha normal da conta nunca é usada.

1. Na conta Google: **Gerenciar sua Conta Google → Segurança → Verificação em duas etapas** (precisa estar ativada).
2. Ainda em Segurança, abra **Senhas de app** (ou procure "senhas de app" na busca da conta). Crie uma chamada `MyBots`.
3. Copie os 16 caracteres.
4. No MyBots: **Ajustes → E-mail → Conectar e-mail**, informe o endereço e a senha de app.
5. Em cada bot que deve ler e-mails, abra o perfil e permita **Buscar e-mails** e **Ler e-mails**.

O que acontece depois:

- A senha fica cifrada (AES-256-GCM) em `~/.mybots/secrets/`; a chave fica no armazenamento protegido do app e só chega ao supervisor pela conexão local autenticada. Depois de reiniciar o celular, abra o MyBots uma vez para liberar a conta.
- E-mails que chegam **depois** da conexão viram eventos (base das rotinas da etapa 3B). Os anteriores continuam disponíveis para busca.
- Nenhum bot envia, apaga ou marca e-mails como lidos. O conteúdo dos e-mails é tratado como dado externo, nunca como instrução.
- Para revogar: Ajustes → E-mail → Desconectar, ou apague a senha de app na conta Google.

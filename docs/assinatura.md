# Assinatura e atualização

Registro: 19/10/2026.

## App instalado e APK v8

Pacote `com.mybots.app`. A v8 é `versionCode 8`, versão `0.1.2`, ARM64. Usa a mesma chave existente das versões 6 e 7 (`mobile/android/app/debug.keystore`). A comparação de certificados entre os APKs é obrigatória antes da entrega. Instalar por cima; não desinstalar nem limpar os dados.

Certificado anterior SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

## Chave própria de release preparada

Criada uma chave RSA de 3072 bits, alias `mybots-release`, em `.signing/mybots-release.p12`. A senha aleatória está em `.signing/release-password`. Diretório com permissão 700, arquivos com permissão 600 e ambos fora do Git. A senha não está embutida no app, nos scripts, em prompts ou nos registros de diagnóstico.

Guardar uma cópia privada desses dois arquivos fora do computador. Apagar `.build-tools/` não apaga a chave; apagar `.signing/` sem cópia de segurança perde a capacidade de assinar com ela.

**A nova chave ainda não é usada pelo APK de teste.** Trocar diretamente a assinatura impede a atualização normal da instalação existente. Não foi criada uma falsa promessa de migração automática da assinatura.

## Migração planejada, depois do teste real de restauração

1. Na v8, salvar um backup no Termux e conferir a restauração de um bot descartável. Registrar o nome exato do arquivo.
2. Manter intactos o Termux, `~/.mybots/backup/`, suas sessões e o login do Codex. Guardar também uma cópia privada do backup fora do aparelho.
3. Só após o teste de restauração e a decisão explícita de migrar, preparar uma versão assinada com a chave própria. A migração por exportação/importação pode exigir remover a instalação antiga. Essa ação não foi executada nem é necessária para testar a v8.
4. Importar o backup pelo app e conferir IDs, bots e mensagens. Não considerar a assinatura de release aprovada antes desse teste.

A aceitação da etapa 0B está pendente do teste de atualização e restauração no POCO. A etapa 1 permanece bloqueada pelo critério de aceite do plano, não por uma necessidade de confirmação adicional de implementação.

## v9 — etapa 1

A v9 (`versionCode 9`, `0.2.0`) continua usando o mesmo pacote e certificado da v8 para atualização direta. A chave própria de release permanece preparada e não foi ativada. O arquivo de pareamento cifrado é excluído de backup automático do Android, pois a chave correspondente pertence ao Keystore desta instalação; se necessário, o app faz novo pareamento com o mesmo supervisor.

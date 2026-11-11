# Componentes de terceiros do Linux embutido

| Componente | Licença | Origem |
|---|---|---|
| PRoot 5.4.0 | GPL-2.0-or-later | https://github.com/proot-me/proot |
| talloc 2.4.3 | LGPL-3.0-or-later | https://www.samba.org/ftp/talloc/ |
| uthash (cabeçalhos do PRoot) | BSD | https://github.com/troydhanson/uthash |
| Alpine Linux 3.24 (minirootfs e pacotes: busybox, musl, bash, curl, nodejs, libstdc++, util-linux-misc e dependências) | Licença de cada pacote, em `/lib/apk/db/installed` no ambiente | https://alpinelinux.org |

Os patches `proot-0001` a `proot-0004` vêm do projeto Mika (https://github.com/wangzan101/Mika) e seguem a licença do PRoot. O `proot-0005` é do MyBots e segue a mesma licença.

O PRoot é executado como processo separado; o MyBots não se liga a ele.

## Fontes

Cada Release do MyBots traz o arquivo `mybots-fontes-gpl.tar.gz`: as fontes do PRoot e do talloc, os patches, os scripts que os compilam e, para cada pacote GPL/LGPL do Alpine incluído, a receita e os arquivos originais. É gerado por `build-sources.sh`.

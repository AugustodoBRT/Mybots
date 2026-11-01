# Escritório 3D (v2)

Cena isométrica do "Escritório": uma sala flutuando no espaço com os bots de partículas do MyBots trabalhando, mais os dashboards e a lista "Agora no escritório". Feita em Three.js 0.160 (copiado em `vendor/`, sem build e sem internet) e com o motor real dos bots (`/lib/mimo.mjs`).

## Arquivos
- `index.html` + `style.css`: o layout do app (1920×1080, escalado para a janela).
- `scene.mjs`: câmera isométrica, luz, estrelas, rótulos que seguem os bots, painel lateral e cartões. Expõe `window.renderAt(t)` e `window.setState(nome, estado, texto)`.
- `world.mjs`: a sala, os móveis modelados em código (mesas, monitores animados, estante, café com vapor, sofá, plantas, abajur, relógio que anda, quadro branco, porta de aprovação), juntados em poucos lotes de desenho.
- `particles.mjs`: cada bot como uma nuvem de partículas 3D (as mesmas do app) num shader que recorta olhos e boca, pisca, dorme, fica vermelho no erro; sombra, brilho e o rastro de partículas dos pulos.
- `timeline.mjs`: estados dos bots, estações (mesa, porta, sofá…), caminhos com A* desviando dos móveis, pulos com antecipação/esticada/pouso e o roteiro `SCRIPT` do vídeo.
- `record.mjs`: grava o vídeo quadro a quadro (Chrome sem janela pelo protocolo DevTools, sem pacotes extras) e passa ao `ffmpeg`.

## Ver ao vivo
Na raiz do repositório:
```sh
python3 -m http.server 8000
```
Abra `http://localhost:8000/docs/design/escritorio-3d/v2/`. `?q=low` usa menos partículas e sem sombras; `?square=1` mostra o layout quadrado. Respeita "reduzir movimento" do sistema (fica parado num quadro).

No console: `setState('Maniaco', 'dormindo')` manda um bot para o sofá (estados: `normal`, `trabalhando`, `esperando`, `dormindo`, `concluido`, `erro`).

## Gravar
```sh
cd docs/design/escritorio-3d/v2
node record.mjs                 # escritorio.mp4, 1920×1080, 60 fps, 30 s
node record.mjs --square        # escritorio-1x1.mp4, 1080×1080
node record.mjs --still 20      # poster.png
node record.mjs --fps 30 --seconds 8 --out teste.mp4   # teste rápido
```
Usa a placa de vídeo (`--use-angle=gl`); se não houver, `--gl swiftshader` (bem mais lento).

## Mudar o roteiro
Edite `SCRIPT` em `timeline.mjs` (`{ at: segundos, name, state, text }`) e os textos de `CHAPTERS` em `scene.mjs`. As posições das estações ficam em `stations` (mesas) e em `setState` (porta, sofá, passeio).

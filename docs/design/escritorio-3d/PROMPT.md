# Prompt: cena 3D do "Escritório" em código + vídeo

Cole o bloco abaixo no modelo (aberto na pasta do projeto `mybots`). Ele lê os arquivos citados, constrói a cena em código e grava o vídeo. Os protótipos e as imagens de referência desta pasta foram feitos por mim com Three.js; são só um ponto de partida, o objetivo é ficar **muito** melhor.

```
You are working inside the folder of my project "mybots" (an app where personal AI bots live). I want a high-quality 3D isometric "office" scene built IN CODE, and then a video rendered from it. Read these files first:

- docs/design/escritorio-3d/referencia-3d.png and referencia-2d.png : concept images of what I want (a floating isometric office in space, particle bots working, dashboards below, status list at the right).
- docs/design/escritorio-3d/prototipo-3d.html : my rough Three.js prototype (furniture made of boxes, bots as 3D point clouds, particle trail, labels). Serve the repo root with a static server (e.g. `python3 -m http.server`) and open /docs/design/escritorio-3d/prototipo-3d.html. It imports /lib/mimo.mjs and /lib/mimo-canvas.mjs by absolute path.
- lib/mimo.mjs and lib/mimo-canvas.mjs : the real particle-creature engine of the app. `specFromFace(null, name)` gives a bot's body spec (shape squar/sx/sy/sz, eyes, eyeStyle, eyeGap, eyeY, mouth, top = ears, hue); `buildParticles(spec, N)` gives its 3D particles (x,y,z in about [-1,1], plus light/size/phase per particle); `Mimo` + `paintFrame` draw the 2D version with moods (normal, trabalhando, esperando, dormindo, erro, concluido, falando…). The 3D bot you make must be recognizably the same creature as the 2D one (same colors, ears, eyes, mouth).
- mobile/theme.js and docs/progresso.md for the palette and context (dark UI: background #0b0c0e, cards #16171A, border #2B2D31, text #F6F3ED, muted #9A9CA3, accent amber #EABB75).

GOAL 1 — the scene (a single self-contained web page, Three.js from a CDN with a pinned version, no build step, plus any helper modules):
1. A small isometric (orthographic) office room floating in deep space: two back walls, a thick floor slab with a few rocks/crystals underneath lit by a warm amber glow, stars all around (parallax-free, subtle twinkle), a faint nebula. Cozy, premium, game-quality look: physically based materials, soft shadows, ambient occlusion or baked AO, a little bloom on the lights/screens, tasteful color grading, subtle depth of field or vignette. Palette from the app (charcoal, warm wood, amber accent, purple sofa).
2. Real 3D furniture, modeled procedurally (no external assets): 3-4 desks with glowing monitors (animated code/text lines, a blinking cursor), keyboards, chairs; a bookshelf; a window to space; a wall clock that really ticks; a lamp; a coffee counter with steam; a sofa; plants; a rug; a whiteboard with moving sketches; a small "approval" door/portal for bots that wait. Small living details (steam, floating dust, a screen flicker).
3. Six bots made of thousands of glowing particles (use the real engine: same spec, hue, ears, eyes carved out as negative space, mouth), each with soft glow, light shimmer and a ground shadow. They are not statues: idle breathing, blinking, looking around.
4. Behavior driven by a small state machine, one state per bot: `trabalhando` (sits at a desk, face lit by the monitor, typing motion, speech bubble with the current step), `esperando` (stands near the approval door, bubble "Preciso da sua aprovação", impatient wobble), `dormindo` (curled on the sofa, "z z" rising), `normal`/idle (wanders: hops from place to place), `concluido` (celebrates, sparkles, floats out of the room into the starfield), `erro` (red flicker, shakes). Movement is HOPPING: anticipation squash, stretch in the air, landing squash, small camera-independent dust puff, and a trail of glowing particles left behind that fades out in the bot's own color. Bots path-find around furniture, turn to face their direction, and walk to the station that matches their new state when it changes (expose `setState(botName, state, text)` so the real app can drive it later).
5. Labels (name pills, speech bubbles) are DOM/CSS overlays that follow the bots in 3D and never overlap badly; they fade in/out.
6. Around the scene, the app UI as clean HTML/CSS (same palette): top chips ("6 bots · 2 trabalhando", "Celular ● online  PC ● online"), 4 stat cards below the scene (Tokens hoje, Tarefas concluídas, Tempo trabalhando, Aprovações pendentes) with animated numbers/sparklines, a "Quem trabalhou mais · últimos 7 dias" bar chart that animates in, and a right panel "Agora no escritório" with one card per bot (particle avatar, name, colored status, one-line description, time). Text in Brazilian Portuguese, exactly as in the reference images.
7. Performance: one render loop, instanced/shared geometry and a single Points draw per bot, fixed time step, `prefers-reduced-motion` support, and a quality switch (high for video/desktop, low for phones). It must hold 60 fps on a desktop GPU.
8. Determinism: everything animated must be a pure function of time. Expose `window.renderAt(t)` (seconds) that sets the whole scene (bot states from a scripted timeline, particles, camera, labels, UI numbers) and renders ONE frame synchronously, with seeded randomness, so frames can be captured one by one. The live page just calls it from requestAnimationFrame.

GOAL 2 — the video:
1. A scripted 30-second timeline (seamless loop optional) that tells a small story: bots working at desks, one gets stuck and walks to the door waiting for approval, a stat card ticks up, another finishes and floats out into space, one wanders to the coffee machine leaving a particle trail, one falls asleep on the sofa, the camera does a slow gentle push-in and drift (still isometric/orthographic), with a few subtle camera moves and an ending hold. No text in English, no watermark.
2. A recording script (Node) that opens the page in headless Chrome (use the installed `google-chrome-stable`; WebGL via `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, or the GPU if available), steps `window.renderAt(t)` frame by frame at 1920x1080 and 60 fps (also 30 fps option), saves PNGs, and encodes with `ffmpeg` (H.264, yuv420p, crf ~16, +faststart) to `docs/design/escritorio-3d/escritorio.mp4`. Also output a 1080x1080 version for social. `ffmpeg` is installed.
3. A short README with the commands (serve, record, encode) and how to change the timeline.

DELIVERABLES (put them in docs/design/escritorio-3d/v2/):
- `index.html` (+ modules) — the live scene with the UI.
- `record.mjs` — frame capture + ffmpeg.
- `escritorio.mp4` — the video (1080p60), and `escritorio-1x1.mp4`.
- `poster.png` — a still of the best frame.
- `README.md`.
Do not modify anything outside docs/design/escritorio-3d/. Use only what is installed here (Node, Chrome, ffmpeg); if you need a package, tell me first. When done, open the poster and a few frames of the video yourself and check them: bots clearly readable (eyes/mouth visible), no overlapping labels, nothing clipped, motion smooth, colors true to the palette. Iterate until it looks like a polished product trailer, not a prototype. Tell me honestly what is still rough.
```

## Depois

Quando a cena e o vídeo estiverem bons, o próximo passo no MyBots é levar o `index.html` para uma aba do app: na janela do PC direto, e no celular dentro de um WebView, ligando `setState` aos eventos reais do supervisor.

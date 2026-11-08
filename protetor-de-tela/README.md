# Protetor de tela (app externo com temas)

O app **só gerencia**: tempo de ociosidade, tecla de bloqueio, PIN e escolha do tema.
Quem desenha as animações são os **temas**, que são independentes e podem vir de terceiros.

Sem build e sem bibliotecas: HTML, CSS e JavaScript puros.

## Como rodar

Sirva a pasta com o `serve.py` (o app lê `themes/themes.json` com `fetch`, que não funciona em `file://`):

```bash
cd /home/angelo/Downloads/PLUGIN/protetor-de-tela
python3 serve.py            # http://localhost:5180
python3 serve.py 8080       # outra porta
```

Use o `serve.py` em vez de `python3 -m http.server`: ele suporta pedidos parciais (`Range`), que os
temas de vídeo precisam para tocar, avançar e repetir, e envia o cabeçalho CORS, que deixa os temas
isolados lerem arquivos da própria pasta. Ele escuta só em `127.0.0.1` (a rede local não enxerga o app).

Abra <http://localhost:5180>. Deixe a página aberta (numa aba ou janela). Dica: use o botão
**Tela cheia** antes de se afastar.

## O que o app faz

A tela inicial tem só os botões **Tempo e atalho**, **PIN de desbloqueio** e **Temas**, cada um com o valor
atual embaixo. Clicar abre o painel correspondente; as opções de um tema abrem por cima do painel de temas.
O **×**, a tecla **Esc** ou o clique no fundo escuro fecham sempre o painel de cima. **Bloquear agora** e
**Tela cheia** ficam sempre à mão no topo.

- **Tempo:** depois de 1, 2, 5, 10, 15, 30 ou 60 minutos sem mouse, teclado ou toque na página,
  o protetor entra. Dá para desligar o modo automático.
- **Tecla de bloqueio:** padrão `Ctrl+Alt+L`. Em **Alterar**, você grava outra combinação
  (use Ctrl, Alt ou Meta com uma tecla, ou F1 a F12).
- **PIN (opcional):** com PIN, toda ativação (ociosa ou manual) só fecha com ele. Sem PIN, a ociosa
  fecha com clique ou tecla, e o bloqueio manual fecha pelo botão Desbloquear. Cinco erros seguidos
  travam o formulário por 15 s. O PIN fica no `localStorage` como hash com sal.
- **Temas:** escolher, pré-visualizar, personalizar (se o tema tiver opções) e adicionar por endereço (`https://…` ou `http://localhost…`).
- **Opções do tema:** temas como o Pássaros (Vanta) mostram controles (cores, quantidade, velocidade…) com prévia ao vivo. Os valores ficam salvos no navegador.
- **Tela cheia:** ao bloquear, tenta entrar em tela cheia (o navegador pode negar sem um gesto seu).
- **Atalhos de URL para testes:** `?preview=<id-do-tema>` e `?lock=1`.

Se o tema não responder em 4 segundos, aparece um relógio de reserva e o bloqueio continua valendo.

## Limites (importante)

- É uma página web: funciona **enquanto ela estiver aberta**. Não detecta ociosidade do sistema inteiro
  nem cobre outras janelas. Para isso seria preciso empacotar como app de desktop (por exemplo Electron),
  reaproveitando esta mesma pasta.
- O bloqueio e o PIN são uma trava de tela no navegador, não segurança do computador.

## Estrutura

```
protetor-de-tela/
├── index.html, manager.css, manager.js   # o app (gerenciador)
├── theme-sdk.js                           # SDK opcional para temas
├── serve.py                               # servidor local (Range + CORS)
└── themes/
    ├── themes.json                        # lista dos temas da pasta
    ├── rex/                               # tema: Rex dormindo (fora da lista; registre em themes.json para usar)
    ├── relogio/                           # tema: relógio (fora da lista; registre em themes.json para usar)
    ├── vanta-birds/                       # tema: pássaros 3D (Vanta.js), com opções
    ├── vanta-waves/                       # tema: ondas 3D (Vanta.js), com opções
    ├── city/, space/                      # temas de vídeo (MP4 em loop), com opções
    ├── shared/                            # three.js e video-theme.js, compartilhados
    └── _template/                         # ponto de partida para um tema novo
```

## Como criar (ou terceirizar) um tema

Um tema é uma página HTML. O app a abre num `<iframe sandbox="allow-scripts">`: **sem acesso** ao
`localStorage`, aos cookies nem ao DOM do app. A conversa é por `postMessage`:

| Direção | Mensagem | Quando |
| --- | --- | --- |
| app → tema | `{ type: "screensaver:state", mode, now, options }` | ao carregar, quando o modo muda e quando uma opção muda |
| tema → app | `{ type: "screensaver:ready" }` | ao iniciar |
| tema → app | `{ type: "screensaver:wake" }` | pedido para fechar (o app ignora se estiver bloqueado) |

`mode` é `"idle"` (ocioso), `"locked"` (bloqueado) ou `"preview"`.

Com o SDK, basta:

```html
<script src="../../theme-sdk.js"></script>
<script>
  ScreensaverTheme.init({ autoWake: true, onState: function (s) { /* s.mode */ } });
</script>
```

Regras para um bom tema: pausar com `document.hidden`, não navegar o iframe para outros sites,
funcionar sem rede, e (de preferência) usar o loop de `requestAnimationFrame` a ~30 fps.

### Exemplo para testar

`exemplos/animacao-teste.html` é um tema de terceiros mínimo, sem SDK, com um painel que mostra o modo
recebido (`preview`, `idle` ou `locked`) e o que ele enviou ao app. Para testar, com o `serve.py` rodando,
adicione o endereço `http://localhost:5180/exemplos/animacao-teste.html` em **Temas > Adicionar tema por
endereço**. A parte da animação fica numa seção própria do arquivo, para você trocar pela sua.

### Opções personalizáveis

Um tema da pasta pode declarar opções em `themes/themes.json`. O app gera os controles, valida os
valores e envia o objeto `options` ao tema (o SDK entrega em `onState` e em `ScreensaverTheme.options()`).

```json
"options": [
  { "key": "corFundo",   "label": "Cor do fundo", "type": "color",    "default": "#07192f" },
  { "key": "quantidade", "label": "Quantidade",   "type": "range",    "min": 1, "max": 5, "step": 1, "default": 3 },
  { "key": "modo",       "label": "Modo",         "type": "select",   "default": "a",
    "choices": [ { "value": "a", "label": "A" }, { "value": "b", "label": "B" } ] },
  { "key": "fechaClique","label": "Fechar com clique", "type": "checkbox", "default": false }
]
```

Tipos: `color` (`#rrggbb`), `range` (número entre `min` e `max`), `select` (um dos `choices`) e `checkbox`.
O app sempre entrega valores válidos: se algo salvo estiver corrompido ou fora dos limites, volta ao padrão.
Em temas interativos (que usam o mouse), use `autoWake: false` e feche só com tecla, ou ofereça uma opção
como "Fechar com clique". Veja `themes/vanta-birds/` como exemplo completo.

### Tema de vídeo

Para transformar um MP4 em tema, copie `themes/city/` (ou `space/`), troque o arquivo `.mp4` e o nome em
`data-src` no `index.html`, e registre em `themes/themes.json` com as opções `brightness`, `speed` e `fit`
(copie de `city`). O player (`shared/video-theme.js`) toca sem som e em loop, pausa com a aba oculta e aceita
essas opções ao vivo. Dicas:

- Use H.264 (MP4): é o que todos os navegadores tocam. Vídeos de 720p a 1080p, com 10 a 30 s, bastam.
- Se o índice do MP4 estiver no fim do arquivo (caso do `city`), o `serve.py` resolve com `Range`. Para
  começar mais rápido, dá para reempacotar sem recodificar: `ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`.
- Vídeo fosco ou "macio"? Quase sempre é a resolução: um vídeo 720p esticado numa tela maior perde nitidez.
  O tema Espaço usa `space-1080p.mp4`, gerado do original (que foi mantido na pasta) assim:
  `ffmpeg -i original.mp4 -an -vf "scale=1920:1080:flags=lanczos,unsharp=lx=5:ly=5:la=0.9:cx=3:cy=3:ca=0.0,eq=contrast=1.10:saturation=1.15:brightness=0.02" -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -movflags +faststart saida.mp4`.
  Nitidez mais forte que `la=0.9` cria halos e ruído; CRF menor que 28 deixa o arquivo muito grande (CRF 19 deu 100 MB).
- Confira a licença do vídeo antes de redistribuir a pasta. **Os vídeos de exemplo (Cidade e Espaço) não vão
  para o repositório** (ver `.gitignore`): para esses dois temas funcionarem depois de clonar, coloque os
  arquivos `themes/city/202824-919000180.mp4` e `themes/space/space-1080p.mp4` (ou troque o nome em
  `data-src` do `index.html` de cada tema). Sem o arquivo, o tema mostra um aviso em vez de quebrar.

### Publicando no GitHub Pages

O Pages usa Jekyll, que **ignora pastas e arquivos que começam com `_`**. Por isso a pasta compartilhada se chama
`shared/` (e não `_lib/`): com `_lib/` o `three.js` dava 404 online e os temas Vanta não carregavam. Não use `_` no
começo do nome de nada que o app precise carregar. (`themes/_template/` é só um modelo para copiar, não precisa
ficar online.)

### Bibliotecas dentro de um tema

Scripts da própria pasta carregam normalmente no iframe isolado, então dá para guardar bibliotecas em
`lib/` (o Pássaros usa three.js e Vanta.js, ambas MIT, com os avisos em `lib/LICENSES.txt`).
Atenção: o iframe isolado só lê arquivos com `fetch` se o servidor enviar CORS. O `serve.py` envia; um
servidor comum (`python3 -m http.server`) não. Para não depender disso, embuta os dados no código do tema.

### Adicionar um tema da pasta

1. Copie `themes/_template/` para `themes/<id>/` e ajuste `theme.json` e `index.html`.
2. Registre em `themes/themes.json`:
   `{ "id": "<id>", "name": "…", "description": "…", "path": "themes/<id>/index.html" }`.
3. Recarregue o app.

### Adicionar um tema de terceiros por endereço

Em **Temas > Adicionar tema por endereço**, informe o nome e o endereço da página do tema.
Só aceita `https://` (ou `http://localhost`). O tema roda isolado, como os demais.

Para um tema hospedado fora desta pasta, ele pode usar o protocolo acima direto (sem o SDK).

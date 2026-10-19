# PLUGIN

Plugins do DESCORDE, mantidos fora do projeto principal. Cada subpasta é um plugin estático independente (HTML/CSS/JS), carregado pelo DESCORDE dentro de um iframe com sandbox.

## Rodar localmente

```bash
cd /home/angelo/Downloads/PLUGIN
python3 -m http.server 5180
```

Cadastro no painel admin do DESCORDE (Minha Página → Gerencial → Plugins):

| Plugin      | URL                                            |
| ----------- | ---------------------------------------------- |
| calculadora | `http://localhost:5180/calculadora/index.html` |
| teste | `http://localhost:5180/teste/index.html` |

Imagem da apresentação: `http://localhost:5180/calculadora/capa.svg`

## Produção

Hospedar esta pasta em qualquer servidor estático com **https** e cadastrar a URL pública no painel admin (em produção o DESCORDE rejeita `http://`). O servidor não pode enviar `X-Frame-Options: DENY` nem `frame-ancestors` que bloqueie o domínio do DESCORDE.

## Regras do ambiente de plugin

- O iframe roda com `sandbox="allow-scripts allow-forms allow-popups"` (origem opaca): sem `localStorage`/cookies, e **scripts de módulo (`type="module"`) não carregam** — usar scripts clássicos.
- Testes da calculadora: `cd calculadora && node --test calc.test.mjs`

## SDK

`plugin-sdk.js` na raiz é uma cópia do SDK do DESCORDE (`frontend/public/plugin-sdk.js`), usada pelos plugins que consomem a API (ex.: `teste`, com `<script src="../plugin-sdk.js">`). Se o SDK mudar no DESCORDE, atualize esta cópia.

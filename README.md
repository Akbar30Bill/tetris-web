# vitetris online

A static, terminal-style falling-block game with solo play and direct browser-to-browser duels.

## Play locally

The site has no build step. Serve the directory over HTTP so browser JavaScript modules can load:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. Open `http://localhost:8080/tests.html` to run the engine tests. `visual-tests.html` contains deterministic renderer fixtures for responsive visual checks.

## Host it

Upload the repository contents to any static host, such as GitHub Pages, Cloudflare Pages, Netlify, or an ordinary web server. Online play should be served over HTTPS.

### GitHub Pages with a custom domain

```sh
git init
git add .
git commit -m "initial commit"
```

Create a repository on GitHub (e.g. `tetris-web`), then push:

```sh
git remote add origin git@github.com:YOUR_USER/tetris-web.git
git branch -M main
git push -u origin main
```

In the GitHub repo settings (`Settings > Pages`):
1. Set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`.
2. Under **Custom domain**, enter your domain and save.

Point your domain's DNS at GitHub Pages:
- **A records** to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- Or a **CNAME** from `www` to `YOUR_USER.github.io`

## Duel flow

1. One player selects `HOST GAME` — a unique room code is generated (for example, `7K3-MP9Q-D2X`).
2. The host copies the invite link, or shares the displayed code directly.
3. The other player opens the invite link or selects `JOIN GAME` and enters the code.
4. The host presses `ACCEPT PLAYER` when the guest requests to join, then both players enter the lobby.
5. Both press Enter (or tap READY) when ready.
6. The first to win three rounds wins the match.

## Controls

| Action | Keys |
| --- | --- |
| Move | Left / Right |
| Soft drop | Down |
| Rotate clockwise | Up, A, or X |
| Rotate anticlockwise | B or Z |
| Hard drop | Space |
| Pause solo game | P |
| Ready / restart | Enter |
| Return to menu | Escape |

Touch controls appear on small or touch-capable screens.

## Credits

Gameplay timing, piece orientations, scoring, visual language, and multiplayer structure are based on [vitetris](https://www.victornils.net/tetris/) by Victor Geraldsson. Vitetris is distributed under the BSD 2-Clause license; its notice is included in `VITETRIS-LICENSE.txt`.

Trystero is Copyright (c) 2021 Dan Motzenbecker and distributed under the MIT license. The site loads the pinned `trystero@0.25.3` ESM package for Nostr-based peer discovery. Game data is sent directly between browsers over encrypted WebRTC; public relays are used only to help players discover one another.

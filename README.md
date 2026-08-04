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
2. Under **Custom domain**, enter your domain and save. GitHub creates a commit with a `CNAME` file automatically, or write your domain into `CNAME` locally before pushing.

Point your domain's DNS at GitHub Pages:
- **A records** to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- Or a **CNAME** from `www` to `YOUR_USER.github.io`

I do not have the right tooling to set up git credentials or create the remote for you, so the remaining steps
- creating an empty repo on github.com,
- adding your domain in Settings > Pages,
- and configuring the DNS records at your registrar
are things you will do in your browser as a one-time setup.  Once they are done, subsequent pushes update the live site automatically.

1. One player selects `CREATE DUEL` and shares the eight-character room code.
2. The other player enters the code under `JOIN DUEL`.
3. Both press `Enter` when ready.
4. The first player to win three rounds wins the match.

Both players receive the same seeded, uniformly random piece sequence. Clearing `N` lines queues `N - 1` garbage rows for the opponent, so the attack table is `0, 1, 2, 3`. Pending garbage is capped at 12 rows and rises between pieces.

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

Trystero is Copyright (c) 2021 Dan Motzenbecker and distributed under the MIT license. It is loaded as an external dependency and is not vendored in this repository.

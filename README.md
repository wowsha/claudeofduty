# DEAD DROP — Tactical FPS (Three.js)

A browser-based tactical first-person shooter built with Three.js, React and Vite. Hold the plaza against waves of hostiles.

**Play:** https://wowsha.github.io/claudeofduty/

Runs on desktop (keyboard + mouse) and mobile (touch, landscape).

## Controls

| Desktop | Mobile |
| --- | --- |
| W A S D – move | Left thumb – floating move stick |
| Mouse – look | Right thumb drag – look |
| Shift – sprint | SPRINT button (or push stick fully forward) |
| C / Ctrl – crouch | CROUCH button |
| Space – jump | JUMP button |
| Left mouse – fire | FIRE button (hold) |
| Right mouse – aim down sights | AIM button (tap to toggle) |
| R – reload | RELOAD button |

On phones, turn the device to landscape. Graphics default to MEDIUM on touch devices; you can change it on the menu.

## Development

```bash
npm ci
npm run dev      # local dev server
npm run build    # production build into dist/ (single self-contained index.html)
```

Add `?touch` to the URL to force touch controls on a desktop browser for testing.

## Deployment

Pushes to `main` build and publish to GitHub Pages via `.github/workflows/deploy.yml`.
The repo's Pages source must be set to **GitHub Actions** (Settings → Pages).

See [CYCLES.md](CYCLES.md) for the visual quality iteration log.

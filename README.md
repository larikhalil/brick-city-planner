# Brick City Planner

A digital, top-down **city planner for LEGO® sets** — design your city layout in a virtual space *before* buying the physical sets.

Browse a catalog of real sets, drag their footprints onto a stud grid that represents your table/floor, and see how the whole city fits together: total size (studs + cm), how baseplates tile, category mix, and piece count.

> 🚧 Early development. Design spec: [`docs/superpowers/specs/2026-07-11-brick-city-planner-design.md`](docs/superpowers/specs/2026-07-11-brick-city-planner-design.md)

## Status

- **2D top-down** stud-grid planner · static site (HTML/CSS/vanilla JS) · hosted on GitHub Pages.
- Catalog built at build time from [Rebrickable](https://rebrickable.com/) bulk data (City, Town, Trains & Modular Buildings themes); ships as a static snapshot.
- A free, **non-commercial fan project**.

---

## Develop

- `npm test` — run the unit tests (`node --test`; pure logic in `js/` + pipeline helpers in `tools/`).
- `npm run build:data` — regenerate `data/sets.json` + thumbnails from Rebrickable bulk data (requires `sharp`, a build-time-only devDependency: `npm install`).
- `npm run serve` — serve locally at http://localhost:8080 (ES modules require `http://`, not `file://`).

## Deploy

Static site — hosted on GitHub Pages from `main` (repo root). All asset paths are relative, so it works at the `/brick-city-planner/` subpath. Push to `main` to deploy.

---

*LEGO® is a trademark of the LEGO Group of companies which does not sponsor, authorize or endorse this site. Set data & imagery sourced from Rebrickable.*

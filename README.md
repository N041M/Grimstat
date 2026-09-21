# Grimstat

An unofficial, fan-made statistics dashboard and army builder for Warhammer 40,000. It runs in your
browser and keeps everything you make on your own device. It contains no Games Workshop data.

### **[grimstat.com](https://grimstat.com)**

The app is free and there is nothing to buy. You can use all of it without an account. There is also
an Android build of the same app.

---

The calculator works out what one unit does to another. It gives you the whole distribution instead
of a single average, so you get expected damage, the chance of killing the target outright, models
slain, damage per 100 points, and a what-if panel that ranks which single change moves the result
most.

![The calculator: expected damage, a damage distribution chart, a models-slain table, a what-if panel and a column of rules toggles](docs/screenshots/calculator.png)

## What it does

- **Calculator** — exact probability distributions instead of averages, so you can see the tail as
  well as the middle. Where an exact answer is out of reach it falls back to Monte Carlo.
- **Army builder** — 11th-edition validation while you type: Detachment Points, Leader and Support
  attachment, tiered unit costs, enhancements, transport capacity.
- **Codex** — every datasheet of your snapshot laid out like a codex page. Any two to six of them
  can be put side by side with the best value in each row marked.
- **Battle table** — a 3D board with line of sight cast as real rays between model hulls,
  measurement that counts the vertical gap, per-model movement, and terrain.
- **Collection** — the models you own, counted per datasheet and filled in a box at a time from a
  catalogue of 223 boxed sets.
- **Meta** — your army compared with the published tournament lists of its faction. It shows which
  units the field takes, where your list has more or fewer of them, and which lists yours most
  resembles.

The battle table, with two deployment zones, terrain and a placeholder force on a 60×44" board.

![The 3D battle table showing terrain blocks, a red and a blue deployment zone, and labelled units](docs/screenshots/battle.png)

The codex, showing every datasheet in the loaded snapshot grouped by role.

![The codex landing page showing datasheet cards grouped into characters, battleline and other datasheets](docs/screenshots/codex.png)

Every screenshot uses the app's built-in sample data. The units and profiles in them are invented,
and loading your own snapshot replaces them.

## What is in this repository

The application source is private. This repository is the project's front page and the place to
report a fault. It also holds two parts of the code that stand on their own.

**[`engine/`](engine/)** — the probability engine behind the calculator, extracted so that it
runs on its own. It turns an attack sequence into a full damage distribution, and falls back to
sampling when solving it exactly would take too long. It has no dependencies. `npm test` runs 37
tests, including property-based ones and Monte Carlo runs checked against the exact solver.

**[`server/`](server/)** — the files the privacy notice makes claims about: every migration, the
purge job, sign-in, share links and the hashing. [`server/README.md`](server/README.md) maps each
sentence of the notice to the file that settles it, so you can check the retentions yourself.

## Reporting a fault

[Open an issue](https://github.com/N041M/Grimstat/issues). What helps most:

- What you did, what you expected, and what happened instead.
- Which screen, and whether you were signed in.
- The browser, and whether it is a phone, a tablet or a desktop.
- For anything involving your own army data, describe it rather than pasting an export. Issues are
  public, and nobody here needs your lists.

## Privacy

What the server holds, why, and for how long is at
**[grimstat.com/#/privacy](https://grimstat.com/#/privacy)**. The app keeps everything on your device
and works without an account. Signing in is optional, and it copies what you have made to your other
devices.

## Data

The app and this repository contain no Games Workshop rules text, datasheets, points or artwork.
The app ships importers, and you fetch game data onto your own machine from community sources:
BSData, the online Munitorum Field Manual, and Wahapedia's CSV export.

Two public dataset repositories support that:

- [`grimstat-wahapedia`](https://github.com/N041M/grimstat-wahapedia) — a weekly copy of Wahapedia's
  own CSV export, which a browser cannot read directly because wahapedia.ru sends no cross-origin
  header. It carries Wahapedia's attribution requirement: Powered by Wahapedia, https://wahapedia.ru.
- [`grimstat-corpus`](https://github.com/N041M/grimstat-corpus) — published tournament lists, which
  the Meta screen measures an army against.

Warhammer 40,000 and all associated marks are the property of Games Workshop Limited. This project is
not affiliated with, endorsed by, or sponsored by Games Workshop.

## Licence

[MIT](LICENSE), for everything in this repository. The licence does not cover the Grimstat
application, which is not published here, and it does not cover anything belonging to Games Workshop.

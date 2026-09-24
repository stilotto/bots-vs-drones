# Bots vs Drones: project notes

This file is the project's memory. Claude Code loads it at the start of every
session. The game itself is `game.html`, a single file with no build step.

## How we work

- **Code:** `game.html`. Section contracts live in each section's banner
  comment. Keep to the architecture rules below.
- **Open work:** GitHub Issues on this repo. Read open issues before starting;
  reference the issue number in commits (`Fixes #3`).
- **History:** git log. Commit per logical change; don't keep versioned copies
  of the file.
- **Trunk-based:** commit and push straight to `main`; no PRs needed. GitHub
  Pages serves `main`, so a push is how the human reviews in a browser:
  https://stilotto.github.io/bots-vs-drones/game.html
- **Updating these notes:** at the end of a session, update STATUS, NEXT UP,
  KNOWN ISSUES and SESSION HISTORY below. Never delete a decision; supersede it
  with a new dated line.
- **Verifying:** run headless checks in Node where possible. Visual checks in a
  browser stay with the human (or a headless Chromium screenshot as a first pass).

## Notes

```text
VISION
  3D auto-battler. Side A fields bots (ground), side B fields drones (air).
  Each round both commanders spend a budget on any composition, then watch.
  The player never controls a unit, only: what to buy, stance + target
  priority, and how smart units are (intelligence is purchasable).
  v1: human is side A, an AI commander is side B.

ARCHITECTURE RULES (per-section contracts live in each section's banner)
  Sections, dependency flows downward only:
  [10] utils/RNG/terrain · [20] content tables · [25] custom unit registry
  [30] simulation · [40] win conditions · [50] commanders · [60] match flow
  [70] renderer · [80] UI · [85] balance harness · [90] bootstrap
  - Sections talk only through declared EXPORTS; never reference a lower one.
  - Sim is a deterministic 20Hz function of seed + loadouts. No Math.random,
    no THREE, no DOM in [10]-[60]. Renderer interpolates, never drives timing.
  - Commanders submit plain JSON plans. No commander ever reads the
    opponent's pending loadout; both commit blind, then reveal.
  - All player influence enters through a commander plan, never direct edits.
  - One InstancedMesh per unit type. Spatial hash, never O(n^2).
  - [85] must never need [70]/[80]. three.js via CDN is the only dependency;
    adding one needs a decision line below first.

DECISIONS (date · decision · why · rejected)
  08-12 Single HTML file, three.js by CDN import map · no build step, runs
        anywhere · rejected inlining three, multi-file + concat.
  08-12 Sim fully separate from rendering; seeded PRNG only · replays,
        headless balance, future multiplayer.
  08-12 Blind commit then reveal; AI gets the same intel a human would.
  08-12 Commander abstraction: human/AI/remote interchangeable.
  08-12 Win = base destruction, base HP persists across rounds · forces both
        sides to attack · rejected per-round reset, annihilation.
  08-12 Win condition is pluggable: (world) -> null | winnerId.
  08-12 No unit carryover between rounds (v1) · avoids snowballing.
  08-12 Target priority + stance are the core strategy layer (leaker problem).
  08-12 Unit intelligence is purchasable and shares knobs with AI difficulty.
  08-12 AI difficulty from better decisions, never stat cheats. Ladder:
        Easy random · Medium archetypes · Hard counters last round ·
        Brutal runs the headless harness.
  08-12 Budget: ~200 units/side smooth on a Chromebook.
  08-12 Player-created custom units: same shape as UNIT_TYPES, priced by
        costFormula, localStorage + JSON export/import, AI can use them too,
        shared chassis mesh.
  08-12 (D03) Camera floor clamp after controls.update(). Superseded 09-23.
  08-12 (D04) Shared archetype shape: chassis, hp, speed, weaponId, armor,
        cost. Separate WEAPONS table. Soft-cap cost coeff*value^exp. Armor is
        priced but not yet consumed.
  08-13 (D05) Real fire-and-forget projectiles, optional flat splash;
        targetType sets accuracy vs mismatchAccuracy, not who can be targeted
        · rejected hitscan, homing, hard targeting filter.
  09-23 Terrain = pure seeded terrainHeight(params,x,z) in [10], shared by
        [30] and [70]; integer-hash noise (no Math.sin) for cross-engine
        determinism; flat pads under bases; gentle, positional only ·
        rejected renderer-only terrain, heightmap on WorldState.
  09-23 Flight v1: air units hold altitude 9 above terrain; movement is
        horizontal, range + projectiles stay 3D · rejected free 3D steering.
  09-23 Deploy window: nobody acts for 1.5s; [70] animates emergence ·
        rejected render-only emergence (units firing while buried).
  09-23 Factions enforced: FACTION_CHASSIS A=bot, B=drone, buyableCatalog(f)
        · rejected mixed catalogs (contradicted the vision).
  09-23 Commander's-eye camera by default, orbit stays live, reset button;
        floor clamp is now terrain-aware (supersedes D03).
  09-23 Working method: batch sessions across sections allowed; Claude edits
        the whole file and verifies headless (Node logic harness + mocked-three
        render smoke test). Visual checks stay with the human.
  09-23 Moved to GitHub (stilotto/bots-vs-drones). game.html replaces
        game_vNN.html (git history replaces version numbers); these notes
        moved from the file header to CLAUDE.md; open work tracked as GitHub
        Issues · rejected re-uploading the file each chat session.
  09-24 Trunk-based: push straight to main, GitHub Pages serves main for
        browser review · rejected feature branches + PRs (two-person project).
  09-24 Director camera is the default view (#10): cycles overhead orbit,
        chase cam, impact shot; any drag/scroll/touch hands over to manual.
        [70] infers hits from hp drops between frames until [30] -> [70] hit
        events are designed · rejected adding sim hit events for this.

PARKED (not rejected, not now)
  Multiplayer · unit carryover · base upgrades/repair/shields · alternate win
  conditions · terrain gameplay (LOS, cover, slope speed, shots hitting hills)
  · replays · campaign · sound · bespoke custom-unit art · homing projectiles
  · splash falloff curves · human choosing a faction.

NOT YET DESIGNED (take one per design discussion)
  Hit/impact event signaling ([30] -> [70] "a hit landed here") · defensive
  measures (what armor does; interaction with accuracy) · economy (budget,
  income) · base stats (HP, fights back?) · round timer + timeout.

STATUS
  Done: [10] [20] [25] [70]. Partial: [30] (armor not consumed), [40] (base
  destruction only), [50] (Easy AI only), [80] (no HUD/round summary, no
  custom-unit editing), [90] (stands in for [60], single round).
  Not started: [60] match flow, [85] balance harness.
  v17 passes headless checks; NOT YET SEEN IN A BROWSER. Director camera
  (#10) and random battle button (#11) seen working in a browser 09-24.

NEXT UP
  1. Fix whatever the first in-browser look at v17 turns up.
  2. Real [60] match flow: multiple rounds, persistent base HP, income.
  3. [85] balance harness, pulled forward because of the imbalance below.

KNOWN ISSUES / FACTS
  - Bots beat drones ~3 of 4 random matchups; many fights hit the 90s cap
    with a lone survivor chewing a base. Pre-existing, exposed by factions.
  - Shots ignore terrain and can pass through hills.
  - Custom drone units can be created but only the AI side can field them.
  - Side A acts first each tick (small first-mover edge); [40] gives B ties.
  - Budget 100, base HP 500, base x=±130, MAX_TICKS 90s: all placeholders.
  - AI draws are deterministic per SEED; change SEED to see variety.
  - Commander view is hardcoded behind side A.
  - Camera mode toggle lives in the camera bar until the settings panel (#9)
    exists; the choice is not saved between sessions.

SESSION HISTORY (one line each; detail lives in the code comments)
  D01 plan · C01 sim · C02 renderer · C03 commanders · C04 buy UI ·
  C05 target priority · C06 AI orders · D02 custom units · C07 orders UI ·
  C08 bases + win check · D03 camera floor · C09 stances · D04 archetypes ·
  C10 content tables · C11 registry · C12 wiring · C13 stance UI ·
  C14 AI stance · C15 unit creation UI · D05 damage model · C16 projectiles
  in sim · C17 terrain, flight, deploy, factions, renderer rebuild, camera ·
  C18 moved to GitHub (no code changes) · C19 director camera (#10) ·
  C20 random battle button (#11).
```

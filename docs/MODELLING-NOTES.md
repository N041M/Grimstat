# Modelling notes — 40k 11th edition plugin

What the engine computes exactly, what it approximates, and the assumptions baked into `packages/game-40k-11e`.
Every item here is a candidate for a plugin-level option or a future exact treatment.

## Exact
- Attack count distributions (dice expressions, Blast/Cleave/Rapid Fire bonuses).
- Per-die hit outcomes with the two 11e modifier channels: hit-roll modifiers capped at ±1, BS/WS *stat* penalties (cover, "-1 BS") uncapped and stacked on top. PSYCHIC ignores penalties on both channels.
- Re-roll policies (ones / failed / non-critical "fishing") as exact per-die transforms; a single Command Re-roll of one failed hit or one failed wound roll per weapon profile as an exact order-statistic adjustment.
- Substitute dice (Miracle/Fate dice): one hit roll or one wound roll per weapon profile set to a fixed value instead of rolled; the fixed die is never re-rolled.
- Critical hits/wounds with adjustable thresholds (Anti-X, "crits on 5+", Conversion), Sustained Hits (fixed or dice), Lethal Hits (optional; `auto` picks whichever gives the higher expected damage), Devastating Wounds (mortal damage equal to D, max one model per critical wound, no spill), Twin-linked, Lance, Heavy, Melta, Torrent (no hit roll → no critical hits), Snap Shooting (6s only, no re-rolls).
- Saves: invulnerable checked on the unmodified roll, armour on the AP-modified roll, best of both; unmodified 6 always saves and 1 always fails; save-roll modifiers capped ±1.
- Damage modifiers in order set → ×(round up) → ± (min 1) → cap; Feel No Pain as per-wound binomial thinning.
- Allocation: a Markov DP over (models slain, wounds on the current model) per allocation group; damage never spills to the next model; wasted damage tracked; characters are separate groups; Precision allocates to character groups first; otherwise bodyguards absorb first.
- Joint distribution of (wounds needing a save, mortal-damage events) per weapon — Devastating Wounds are not approximated as independent of the normal wounds.

## Approximations / assumptions
- **Toughness**: the unit's majority Toughness is used for the wound roll (ties → highest); per-model Toughness inside a mixed unit is ignored at the wound step.
- **Mortal wound timing**: mortal-damage events from a weapon profile are applied after that profile's normal wounds, not after the whole unit's attacks.
- **Command Re-roll stacking**: the single re-roll can land on a die that a policy re-roll already touched (rules forbid re-rolling a die twice). Effect is second-order.
- **Damage modifiers on Devastating Wounds**: applied (mortal wounds equal the *modified* Damage). Flip `RULES.damageModsApplyToDevastating` if your event rules differently.
- **Cleave X**: modelled as +X attacks per 5 models in the target (like Blast). Verify against the printed rule.
- **Hazardous**: fails on 1–2; 1 mortal wound (3 if the firing unit is entirely VEHICLE/MONSTER); reported as expected self-inflicted mortal wounds, not applied to the attacker's profile.
- **Sustained Hits** extra hits are never critical.
- **Fast rolling / defender choice**: the defender's allocation policy is a fixed rule (protect character / in order); it does not optimise per roll result. Within a group the rules already force damage onto the wounded model first, so there is no separate "spread" policy.
- **Weapon order**: `heuristic` sorts profiles by rough expected damage; a different order changes overkill slightly.
- **Blast** counts all models in the defender (including attached characters).
- **Fight phase**: only melee weapons; **shooting phase**: only ranged weapons. Pistols/Close-Quarters are not special-cased.
- **Damaged profiles, Deadly Demise, healing, "ignore first failed save"**: not modelled.

## Coverage tiers
- Tier 1: weapon keywords in `keywords.ts` and unit core abilities in `patterns.ts#coreAbilityEffects`.
- Tier 2: `patterns.ts` regexes over ability text (generic phrasings only) and any explicit `effects` on an ability (override packs).
- Tier 3: text only → listed as unmodelled; use the generic toggles to approximate.

## Turn optimiser (`optimiser.ts`)
- **Plan evaluation is exact** (exact backend): attackers assigned to the same target are resolved in order with the defender's state distribution chained from one to the next, so overkill and "the target is already dead" are accounted for. Targets are independent of each other, so the total models-slain distribution is the convolution of per-target distributions.
- **Search is heuristic**: greedy construction (attackers by points, best marginal gain over target × option) then local search over single reassignments, pairwise target swaps and firing order, until no improvement. It is not guaranteed optimal; evaluations are cached.
- Options model stratagem-like effects with CP costs (one per attacking unit, per phase, as in 11e); a CP budget constrains the plan.
- Objectives: expected points of *destroyed* models (default; a chipped tank scores nothing), expected models slain, or expected wounds dealt.
- Whole-unit targeting only (no split fire); if the exact path refuses a target (state space too large) that pair falls back to unchained Monte Carlo and a warning is raised.

## Reverse mathhammer and what-if (`reverse.ts`, `sensitivity.ts`)
- Reverse: every candidate and every combination up to the chosen size is evaluated exactly with chained defender states (combinations fire in the listed order); rows that meet the threshold are ranked by points, the rest by value. Capped at 1,500 combinations.
- What-if: one change at a time against the base scenario (26 variants: attacker buffs, context changes, defender debuffs). Deltas are exact differences, not approximations, so interactions between two changes are not shown.
- Overrides: an ability whose override sets `effects: []` counts as modelled ("no combat effect") and leaves the coverage list.

## Army-level readouts (Statistics and Arsenal tabs)
- **Arsenal figures are printed profiles, not a simulation.** Attacks come from the Attacks
  characteristic with dice averaged; bonuses that depend on range, target size or a roll (Rapid Fire,
  Blast, Sustained Hits, Melta) are not added. The tab counts how many attacks carry such a keyword
  so the gap is visible rather than silent.
- **Averages are weighted by attacks, not by weapon.** Twenty bolt rifles and three lascannons
  average S5, not S8.
- **The wound and save tables** apply the edition's Strength-versus-Toughness table and AP directly;
  they say what a roll needs, not what it achieves, since hit rolls and saves are the engine's job.
- **Threat range** is Movement plus the longest weapon range, and for melee Movement plus an average
  charge of seven inches. It ignores terrain, which the battle simulator will model.
- **Statistics output figures** assume every unit shoots the same target for one round at half range
  and not in cover; melee-only units are measured in the fight phase after a charge.

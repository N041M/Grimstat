# Modelling notes — 40k 11th edition plugin

What the engine computes exactly, what it approximates, and the assumptions baked into `packages/game-40k-11e`.
Every item here is a candidate for a plugin-level option or a future exact treatment.

## Exact
- Attack count distributions (dice expressions, Blast/Cleave/Rapid Fire bonuses).
- Per-die hit outcomes with the two 11e modifier channels: hit-roll modifiers capped at ±1, BS/WS *stat* penalties (cover, "-1 BS") uncapped and stacked on top. PSYCHIC ignores penalties on both channels.
- Re-roll policies (ones / failed / non-critical "fishing") as exact per-die transforms; a single Command Re-roll of one failed hit or one failed wound roll per weapon profile as an exact order-statistic adjustment.
- Substitute dice (Miracle/Fate dice): one hit roll or one wound roll per weapon profile set to a fixed value instead of rolled; the fixed die is never re-rolled.
- Critical hits/wounds with adjustable thresholds (Anti-X, "crits on 5+", Conversion), Sustained Hits (fixed or dice), Lethal Hits (optional; `auto` picks whichever gives the higher expected damage), Devastating Wounds (mortal damage equal to D, max one model per critical wound, no spill), Twin-linked, Lance, Heavy, Melta, Torrent (no hit roll → no critical hits), Snap Shooting (6s only, no re-rolls).
- Weapon keywords printed with a target-keyword condition ("Lethal Hits: non-MONSTER/VEHICLE", "Anti-MONSTER/VEHICLE 4+") apply only against a target that satisfies the condition. Slash-separated keywords mean any one of them, and a leading "non-" negates the whole list.
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
- **Weapon-keyword conditions** are read as a list of target keywords. A condition printed any other way — a phase, a range, something about the attacker — matches no target, so the keyword is dropped against all of them. Coverage still counts such a keyword as Tier 1.
- **Sustained Hits** extra hits are never critical.
- **Fast rolling / defender choice**: the defender's allocation policy is a fixed rule (protect character / in order); it does not optimise per roll result. Within a group the rules already force damage onto the wounded model first, so there is no separate "spread" policy.
- **Weapon order**: `heuristic` sorts profiles by rough expected damage; a different order changes overkill slightly.
- **Blast** counts all models in the defender (including attached characters).
- **Fight phase**: only melee weapons; **shooting phase**: only ranged weapons. Pistols/Close-Quarters are not special-cased.
- **Damaged profiles, Deadly Demise, healing, "ignore first failed save"**: not modelled.
- **A rule that applies only against one unit the player picks during the battle** ("select one enemy
  unit; until the end of the turn…") is applied to the scenario's defender. A scenario is one attacker
  against one defender, so the app assumes the defender is the unit that was picked. Switch the
  ability off to see the attacker's output against a unit it did not pick.

## Transports and embarked units
- A passenger records `embarkedIn`, naming the transport roster unit it starts the battle inside.
  The 11th-edition plugin owns every rule about it: capacity, keyword restrictions, models that take
  more than one slot, characters riding with the unit they lead, transports inside transports, and
  Reserves inherited from the transport. It reports what each one is carrying as a diagnostic.
- **The app only says who is where.** The roster list names the ride on both rows, the unit inspector
  offers every transport in the army, and the play companion names it on the unit row. None of them
  decides whether it fits; that answer comes from the plugin, about the list as built, in words.
- **The transport list is deliberately unfiltered.** Offering only transports that can legally take
  the unit would replace "a Rhino cannot carry Terminators" with a transport mysteriously missing
  from a menu.
- **No importer or exporter carries embarkation.** A `.rosz` or a text list round-trips without it,
  so a list imported from elsewhere arrives with everything on the table. That is a gap in the
  adapters, not in the rules.
- **Removing a transport disembarks its passengers** rather than leaving them pointing at a unit
  that is gone, which the rules would otherwise report as an error nobody made. Undo puts them back
  aboard. A duplicated unit does not inherit the original's transport.

## Units a list writes as several models

An 11th-edition datasheet carries one model profile for the whole unit, named after the unit. The models
are named only in the unit composition, so a list that writes "1x Intercessor Sergeant" and "9x Intercessor"
names nothing the profiles know. The importers therefore match a model line against the composition as well
as the profiles, and put every such model on the single profile. Until they did, those lines were read as
wargear and the unit arrived at the size of its minimum composition. A ten-model squad imported as five.

- A wargear line written before any model line stands the unit up at its minimum size, because a list
  that gives only wargear gives no size. When model lines follow, they describe those same models, so the
  invented group keeps only the models they leave unaccounted for.
- A model can be written inside another unit's entry and have a datasheet of its own: Canis Rex's entry
  carries Sir Hekhtur, who is a separate Wahapedia datasheet with his own profile and weapons. The
  importers give that model a roster unit of its own. A roster unit names one datasheet and every profile
  lookup goes through it, so a group pointing at another datasheet's profile would lose its name, its
  characteristics and its weapons everywhere the app resolves the unit. Such a model costs nothing, so
  the list total is the same either way. Only an exact name in the unit's own faction is treated this
  way. Any other unknown model name stays with the unit it was written under, and is reported.
- **The army builder does not add the second datasheet for you.** Adding Canis Rex adds only Canis Rex,
  and Sir Hekhtur has to be added beside it. Nothing in the snapshot says the two belong together.
  Wahapedia links them only in the ability text, so the app cannot know which pairs to offer.
- **A composition line counts every kind of model it names.** "1 Runtherd and 10 Gretchin" is eleven
  models, which is what the builder starts a new unit at and what an importer falls back to when a list
  gives no size. Text in brackets breaks one model into its pieces rather than naming more models, so
  "1 Imperial Fortress Walls (1 gate section, 2 tower sections)" is one model.
- **Lines with an "OR" between them are alternatives.** Gretchin is a unit of eleven models or a unit of
  twenty-two, so the smallest alternative is the minimum and the largest is the maximum. A "One of the
  following:" heading introduces the same thing without the word. Fourteen datasheets in the
  11th-edition export are written one of these two ways. The reading lives in
  `packages/resolver/src/composition.ts`, which the Wahapedia adapter, the army builder, the importers
  and the loadout check all go through. A row of the points table names its models in the same shape
  and is split by the same reader, though a points row is a size only when every part of it is a count.
- **The model names a line gives are read separately from the counts**, in `compositionNames` in
  `packages/adapters/src/roster/import-common.ts`, and deliberately so. It keeps a part that carries no
  count, because a list can write a model the composition names without a number in front of it, and it
  keeps what is in brackets, because a line matches a composition name on its words and a list that
  writes only "Garran Branatar" has to reach "1 Kill Team Terminator (Garran Branatar)". The reader that
  counts models drops both, which is right for a count and wrong for a name.

## Play companion (the in-game tracker)
- **Attached characters are folded into their host** everywhere the app resolves a roster unit, so a
  led squad is one row, one wound bar and one target — which is how the rules treat it. Who is
  attached is carried on `ScenarioUnit.attached` and named on screen beside the unit.
- **Casualties take the attached character last.** `atStrength` hands survivors to character model
  groups first, matching the engine's own `protect-character` allocation. Before this the Leader's
  models, appended after the host's, were the first removed.
- **The wound bar assumes one wounds characteristic for the whole unit**, taken from the most
  numerous model group. A led squad of ten 2-wound models plus a 5-wound character therefore tracks
  as 22 wounds rather than 25, and the damage/heal arithmetic spills at the bulk profile. Tracking
  mixed wounds needs a per-model list the tracker deliberately does not keep; until it does, a
  character whose wounds differ from its squad's has to be watched by hand.

## Loadout check (`loadout.ts`)
A datasheet's wargear options are prose, and no snapshot carries a machine-readable option tree —
the one the BattleScribe importer builds is dropped before the snapshot is written, and the other
two sources never had one. So the check reads the prose, and reports its own coverage every time.

- **Exact**: model count against the summed composition bounds; a weapon that is not on the
  datasheet at all. Weapons folded in from an attached Leader or Support are skipped, since they
  belong to that character's sheet.
- **Tier 2**: option lines whose leading clause names an allowance — "Up to N", "Any number of",
  "For every N models, up to M", "This model", "The <model>'s", "N <model>'s", "Each" — capped in
  weapons rather than models, so a line granting "2 inferno pistols" to two models permits four.
  Against the 11th-edition Wahapedia export this reads about 85% of option lines, and about 83% of
  datasheets completely.
- **Withheld**: "nothing grants this weapon" is only reported when *every* option line on the sheet
  was read. An unread line might be the one that grants it.
- **Suppressed**: any problem the app's own default build of the unit already has. Where the
  default-loadout prose names a weapon the parser cannot match, `unitFromDatasheet` hands it to
  every model, and the unit arrives contradicting its own options through nobody's choice. Against
  the same export this takes false positives on default loadouts from 14 sheets to zero.
- **Not modelled**: mutual exclusion between options ("you cannot select the same option twice"),
  conditions on unit size or on what a model is already carrying, and per-model-profile restrictions.
  Footnote lines are counted as unread, which is what withholds the strict check on those sheets.
- The roster editor does not run this yet: a roster records wargear as names per model group with no
  counts, so ratio limits cannot be expressed there.

### Wargear that is not a weapon
A vexilla, a storm shield, an icon of excess, a gun drone: the datasheet grants it in the same option
prose as a weapon, but it has no profile, so nothing it does reaches the attack sequence and the engine
computes nothing from it. The model carries it and that is all.

- **An importer does not report it as a name it has never heard of.** `isWargearOf` asks the datasheet's
  own printed text — its loadout line and its option lines — rather than only its weapon profiles. Across
  the 55 lists in `data/corpus` that is 248 warnings that were saying nothing a reader could act on. What
  is left warned about is what the datasheet really does not mention.
- **The unit inspector offers the ones that can be named.** `wargearItems` reads the option lines whose
  allowance the loadout parser understands and returns what they grant that is not a weapon, so a player
  picks a vexilla from the sheet rather than typing it into the free-text box. 198 of the 1711 datasheets
  in the 11th-edition export have at least one; 126 distinct items in all.
- **The two readings are deliberately different.** The importer's is a question about one name and answers
  it from the whole text, so it forgives an item the option parser cannot reach ("this unit can have 1
  Plasmacyte" names no grant the parser knows). The inspector's has to produce a list a person reads, so it
  takes only what it is sure of.
- **A line whose only grant is one of these is still filed unread**, which is what withholds the strict
  "nothing grants this weapon" check on that datasheet. Reading those lines would let the check run on more
  sheets, and would want checking against real rosters first, since it turns a withheld check into errors
  a player sees.

## Coverage tiers
- Tier 1: weapon keywords in `keywords.ts`, unit core abilities in `patterns.ts#coreAbilityEffects`, and
  abilities the text reader finds to have no effect on the attack sequence.
- Tier 2: `patterns.ts` regexes over ability text (generic phrasings only) and any explicit `effects` on an ability (override packs).
- Tier 3: text only → listed as unmodelled; use the generic toggles to approximate.

Against the 11th-edition Wahapedia export the reader places about 80% of the ability rows a datasheet
carries, counting each row once per sheet that has it.

## How ability text is read (`patterns.ts`)
- **A granted keyword goes through the keyword registry.** "Its melee weapons have the [LANCE] ability"
  becomes a `grant-keyword` effect carrying the printed spelling, and `scenario.ts` parses it with the
  same parser the adapters use and applies it with the same handler. An ability that gives a weapon a
  keyword and a datasheet that prints it therefore come out identical, values and all
  ("[ANTI-INFANTRY 5+]"). A granted keyword is applied before the printed ones, so where a weapon
  gets the same keyword twice and the rules do not stack it, the printed value stands.
- **Conditions come from the sentence the keyword is in**, not from the whole ability, so a second
  sentence about something else does not narrow the first. Where the sentence says the enemy's weapons
  gain the keyword, the effect is recorded on the defending side and lands on the weapon shooting at it.
- **A menu is read as its options or not at all.** An ability that says to select one of several
  effects becomes one switch per printed option, all of them off, because the datasheet allows exactly
  one. Only two shapes of option are read: a bulleted line that is nothing but keywords, and one that
  opens with a name and a colon. An ability whose options are written any other way stays Tier 3;
  read flat it would hand the unit every option at once.
- **An ability the datasheet spends is modelled but starts off.** "Once per battle", "once per phase"
  and "the first time" put the effects on a switch the player turns on for the round they are used in,
  so the unit's ordinary output is what the app shows by default.
- **"Ignore any or all modifiers" keeps the buffs.** The player drops the modifiers that hurt, which is
  the same arithmetic PSYCHIC gets by rule. The Hit roll and the BS/WS stat are separate channels, so an
  ability that names only the Hit roll leaves cover standing, since cover is a stat penalty in this edition.
- **An ability about something the attack sequence does not contain is recorded as such.** Movement,
  deployment, transports, Battle-shock, Objective Control, CP and army construction change nothing the
  engine computes, so they are counted as modelled with no effects rather than listed for a player to
  find a toggle for. The test is conservative: any mention of the attack sequence, of healing or of a
  model being destroyed disqualifies the ability, and every sentence has to be about one of those
  outside subjects.
- **A weapon keyword naming a rule the sheet writes out itself** — a datasheet prints "[DEAD CHOPPY]"
  in the keyword slot and the rule in an ability of that name — is counted on that ability's row. It
  is neither reported as an unknown keyword nor counted twice.
- **Not read**: a change to the Wounds characteristic (the allocation DP takes wounds from the model
  profile, which an effect record cannot reach), a re-roll of the Damage roll, and rules whose subject
  is a specific named weapon on the sheet rather than a kind of weapon.

## Turn optimiser (`optimiser.ts`)
- **Plan evaluation is exact** (exact backend): attackers assigned to the same target are resolved in order with the defender's state distribution chained from one to the next, so overkill and "the target is already dead" are accounted for. Targets are independent of each other, so the total models-slain distribution is the convolution of per-target distributions.
- **Search is heuristic**: greedy construction (attackers by points, best marginal gain over target × option) then local search over single reassignments, pairwise target swaps and firing order, until no improvement. It is not guaranteed optimal; evaluations are cached.
- Options model stratagem-like effects with CP costs (one per attacking unit, per phase, as in 11e); a CP budget constrains the plan.
- Objectives: expected points of *destroyed* models (default; a chipped tank scores nothing), expected models slain, or expected wounds dealt.
- Whole-unit targeting only (no split fire); if the exact path refuses a target (state space too large) that pair falls back to unchained Monte Carlo and a warning is raised.

## Reverse mathhammer and what-if (`reverse.ts`, `sensitivity.ts`)
- Reverse: every candidate and every combination up to the chosen size is evaluated exactly with chained defender states (combinations fire in the listed order); rows that meet the threshold are ranked by points, the rest by value. Capped at 1,500 combinations.
- What-if: one change at a time against the base scenario (26 variants: attacker buffs, context changes, defender debuffs). Deltas are exact differences rather than approximations, so interactions between two changes are not shown.
- Overrides: an ability whose override sets `effects: []` counts as modelled ("no combat effect") and leaves the coverage list.

## Army-level readouts (Statistics and Arsenal tabs)
- **Arsenal figures come from printed profiles and are not simulated.** Attacks come from the Attacks
  characteristic with dice averaged; bonuses that depend on range, target size or a roll (Rapid Fire,
  Blast, Sustained Hits, Melta) are not added. The tab counts how many attacks carry such a keyword
  so the gap is visible rather than silent.
- **Averages are weighted by attack count rather than by weapon.** Twenty bolt rifles and three lascannons
  average S5, not S8.
- **The wound and save tables** apply the edition's Strength-versus-Toughness table and AP directly;
  they give the roll needed and do not simulate its outcome, since hit rolls and saves are the engine's job.
- **Threat range** is Movement plus the longest weapon range, and for melee Movement plus an average
  charge of seven inches. It ignores terrain, which the battle simulator will model.
- **Statistics output figures** assume every unit shoots the same target for one round at half range
  and not in cover; melee-only units are measured in the fight phase after a charge.

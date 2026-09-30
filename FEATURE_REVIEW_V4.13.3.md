# v4.13.3 Feature Review — Broadcast Operations Step 4

## Scope

This step is limited to advanced team assignment. OBS overlay expansion, automatic stream detection, broadcast statistics, and other roadmap items are intentionally deferred.

## Implemented

- Four team strategies: balanced, tier, position, random.
- Same-game/same-mode recent team history avoidance with configurable depth.
- Team reshuffle that strongly penalizes the current composition.
- Durable team metrics and metadata in the active session and session archive.
- Live Mode and normal dashboard controls for strategy/history depth.
- Existing manual team-member swap remains available and marks metadata as manually adjusted.
- Existing Discord team result sync and voice-room creation remain compatible.

## Scoring model

`balanced` minimizes tier-score spread + Rift lane duplication + repeated teammate pair weight. `tier` prioritizes tier spread while still avoiding repeated pairs. `position` prioritizes Rift lane duplication and repeat avoidance; outside Rift it falls back to tier behavior. `random` performs a cryptographically shuffled assignment without optimization. Missing tier values continue to use the project's existing neutral midpoint score.

## Data / reliability

No new store is introduced. `teamMeta` is stored inside the existing operations state and therefore inherits the existing serialized JsonStore commit queue, atomic write, fsync, backup/temp recovery, crash recovery, and state consistency checks. Archived team history is already bounded to 50 sessions.

## Discord / security

No new Discord permission or privileged Gateway Intent is required. The team history uses Discord IDs already present in the operations state and does not collect new personal data or external game-account history.

# Ashfall: Last Light

A small classic-style real-time strategy game for the browser, set at the end of the world. You lead the **Seraphim Remnant** (survivors and fallen angels) against the **Infernal Horde** (zombies and demons) across a ruined, plague-ridden wasteland.

**Play:** https://auxnabox.github.io/ashfall-rts/

Pure HTML + CSS + JavaScript (Canvas 2D). No build step and no external assets: everything is drawn in code, and the sound effects are synthesized with WebAudio.

## Goal
Destroy every Horde structure. You lose if all of your structures are destroyed.

## Controls
| Action | Input |
|---|---|
| Select | Left-click, or drag a box. Shift adds to the selection. Double-click selects all units of that type on screen |
| Move / attack / harvest | Right-click ground / enemy / salvage field |
| Attack-move | **F**, then left-click |
| Stop | **X** |
| Scroll | WASD, arrow keys, or the screen edge |
| Minimap | Left-click/drag to jump, right-click to send selected units |
| Control groups | Ctrl or Shift + 1-9 to set (some browsers reserve Ctrl+number, so Shift is safer), 1-9 to select, double-tap to center |
| Rally point | Select a Sanctum, Chapel, or Foundry, then right-click the ground |
| Build | Left-click a sidebar button to queue it (right-click to cancel and refund). When a structure is READY, click it again and place it near your base |
| Superweapon | **N**, or the LAUNCH button, then click a target |
| Go to base / last alert | **H** / **Space** |
| Pause / mute | **P** or **Esc** / **M** |

## Factions
| Role | Seraphim Remnant (you) | Infernal Horde (AI) |
|---|---|---|
| HQ | Sanctum | Hell Gate |
| Refinery (free harvester) | Reliquary | Soul Pit |
| Barracks | Chapel | Spawning Pit |
| Defense | Bastion | Spine Tower |
| Factory | Foundry | Hellforge |
| Superweapon | Judgment Spire | Hellfire Maw |
| Harvester | Gleaner | Soul Reaper |
| Infantry | Survivor (rifle) | Zombie (cheap melee swarm) |
| Special | Seraph (flying angel with a holy beam, immune to plague) | Imp (ranged fireballs) |
| Heavy | Ark Tank (splash shells) | Hellbrute (cleaving melee) |

## Mechanics
- **Salvage:** harvesters automatically gather glowing salvage fields and bring it back to a Reliquary or the Sanctum.
- **Plague zones** (green fog) damage your ground units and heal the Horde.
- **The dead rise:** Survivors killed by zombies or by plague come back as Horde zombies.
- **Nukes:** a Judgment Spire charges for 3:20, then can strike anywhere. The blast leaves a radiation zone that hurts every unit inside it for 45 seconds. The Horde builds its own Hellfire Maw and will fire it at your base, but you get a 4-second warning marker.
- **Enemy AI:** gathers salvage, follows a build order, defends its base, and sends attack waves that get bigger over time. There are Easy, Normal, and Hard difficulty levels.
- Fog of war, minimap, build queues with progress bars, and win/lose screens with stats.

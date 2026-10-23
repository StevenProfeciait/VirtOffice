# TEVA HQ: zones, walking and looks. Research and design (2026-10-22)

Why: Steve asked for the office to *use its rooms* the way other agent and virtual-office
visualisers do: the boardroom for reviews, desks for work, a visible "done" moment, and
fun zones only for idle seats. He also asked for natural walking and a Babylon look option.
This file is the research summary (with sources) and the design that shipped.
Operational notes and rollback steps are in `docs/TEVA_HQ_NOTES.md`.

## 1. What other products do

| Source | What they do with space | What we took |
|---|---|---|
| **Generative Agents / "Smallville"** (Park et al., 2023): https://arxiv.org/html/2304.03442v2 | The world is a tree of areas, then sub-areas, then objects. An agent's plan picks an area, the agent **path-finds there**, and its state ("sleeping", "writing") shows at an object. Movement only ever follows from a plan step. | Every move must come from a real event (a plan step), go to a named **area**, and end at a **spot** in it. |
| **Pixel Agents** (VS Code extension that visualises coding agents): https://github.com/pixel-agents-hq/pixel-agents and https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents | Each agent is a character that **walks to its desk and sits**. It *types* while editing files, *reads* while searching or reading, and shows a speech bubble when it is waiting for the user. Idle characters wander. | Desk means active work. Research bots get a **reading pose and spot**. Waiting shows a bubble (we already have Needs Steve). Wandering happens only when idle. |
| **Gather** Private Areas: https://support.gather.town/articles/2550999600-overview-of-meeting-rooms-private-areas and Spotlight: https://support.gather.town/articles/5684809314-spotlight-tiles | Meeting rooms are **private areas**: only people standing inside share the conversation. Spotlight tiles broadcast whoever stands on them to the whole space. | A meeting is *visible* because the participants physically gather in one area. A "spotlight" moment for important outcomes became our **task-completed moment**. |
| **WorkAdventure** area editor: https://docs.workadventu.re/map-building/inline-editor/area-editor/ plus the meeting room and silent zone docs on the WorkAdventure GitHub (`meetingRoom.md`, `silent.md`) | Areas carry **properties** such as meeting room, silent/focus zone, podium/speaker zone, or open website. Behaviour follows from the area you are in. | Zones are data with a **purpose label** (boardroom/review, research/reading, fun/ambient), not just decoration. |
| **AI Town** (a16z): https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md and the constants file: https://github.com/a16z-infra/ai-town/blob/main/convex/constants.ts | Agents `moveTo` a destination through path-finding. A conversation only starts once both agents are within about **1.3 tiles**, so agents "walk over" before they talk. Movement speed is fixed. | Sessions **start only once everyone has arrived**. Walking uses a fixed natural speed instead of a fixed duration. |
| **ChatDev**: https://arxiv.org/html/2307.07924v4 and the visualiser wiki: https://github.com/yhyu13/ChatDev/blob/main/wiki.md | The software process is split into **phases** (design, coding, testing, documenting). Roles pair up for each phase, and the visualiser replays who talked to whom. | We map our real phases to rooms: hand-offs and reviews, BA board rounds, and SA reviews and gates go to the boardroom. |
| **SoWork**: https://sowork.com/blog/ai-powered-virtual-offices-what-to-know-2026 and **Kumospace**: https://kumospace.com/virtual-office-guide/getting-started-guide | Offices are split into focus rooms, meeting rooms, lounges and all-hands spaces. Presence (who is where) *is* the status signal. | Keep separate purposes for desk, boardroom, lab and lounge, so position alone tells you what someone is doing. |

### Walking quality ("too fast" and foot sliding)
* Foot sliding happens when the walk cycle plays at a fixed rate while ground speed changes.
  The fix is to **scale playback to ground speed divided by stride length** (distance matching). Sources:
  https://sboxguide.dev/fix/pace-locomotion-clips-by-stride and Unreal's
  `AnimDistanceMatchingLibrary` (Unreal Engine docs, "Distance Matching").
* People walk at about 1.3–1.4 m/s and stroll at about 1.0 m/s. Starts and stops need
  acceleration (ease in and out), and characters **turn to face** the target before stepping off.

## 2. Design shipped in VirtOffice

### Looks
* `TevaUiStyle.LOOKS` has three entries: Classic, Cyberpunk (the default) and **Babylon (pilot)**.
* Babylon reuses the existing renderer, `public/babylon-pilot.html`. It loads Babylon.js from a CDN and reads
  the same scene contract, roster and zones. It is now **wired in** as the third option under Settings → "Office look".
  It opens as its own page with a "← Back to TEVA HQ" link
  and does not change the remembered Classic/Cyberpunk choice. The walking and zone changes below
  are not ported to the pilot.

### Walking (`public/js/teva_motion.js`, used by both looks)
* Natural pace: walking is 1.35 m/s, ambient strolling is 1.0 m/s, and speed is capped at 1.6 m/s.
* A trapezoid speed profile (acceleration 1.8 m/s²) gives ease in and ease out, so travel time follows distance.
* The walk cycle advances **by distance** (stride 1.25 m), and the clip `timeScale` follows speed, so feet don't slide.
* When the heading changes by more than about 70°, the character turns to face the target first, then walks. Yaw is smoothed.
* Arrival: at a seat, the character sits down and goes to seated idle. At a standing target (boardroom,
  lab or an ambient spot), it stands and faces the target (`faceYaw`).

### Zones (`public/js/teva_zones.js`, `TevaZones`)
| Real trigger (from the feed or state) | Zone | Who | Ends |
|---|---|---|---|
| `handoff` event (from → to, not to Needs Steve) | **Boardroom**, "Hand-off review" | sender and receiver | 25 s after everyone arrives, or as soon as either starts real work |
| BA `docWritten` matching board-round docs | **Boardroom**, "Board round" | Business Analyst | same as above |
| SA `docWritten` (review or gate docs), or a `taskChange` mentioning review, PASS, FAIL or gate | **Boardroom**, "SA review" | Security Auditor | same as above |
| Seat state `WORKING` or typing | **Desk** | that seat | (the desk always wins) |
| Task or turn completed (a real status change) | **"✓ Turn done" moment at the desk**: a 4 s chip plus an arms-up overlay | that seat | after 4 s |
| Research bots `READING` (and briefly while thinking, up to a 45 s dwell) | **Research Lab** reading spots | research seats | when they start working or the dwell runs out |
| Idle seats only, with ambient on | **Fun Wing, lounge or coffee** | at most 2 idle seats | when the ambient leg ends; any real event cancels it |

Honesty rules:
* Zone moves only come from real, sourced events. Each one is annotated on **that event's own
  feed line** (`→ boardroom (Hand-off review · …)`). No new feed lines are invented.
* Ambient and fun moves are labelled "✨ Ambient · decorative" and never appear in the feed,
  the counts or the statuses.
* Working, blocked, offline, meeting and Needs Steve seats are never pulled into a zone.
* Each seat picks its target in this order: zone session, hand-off, meeting, ambient, idle, desk.

### Deferred
* Door and corridor path-finding for the legacy Classic walkers. They still walk in straight lines;
  Cyberpunk uses `TevaAmbient.route` waypoints.
* Porting walking and zones into the Babylon pilot.
* A mug prop for the Cyberpunk "sip" fidgets.

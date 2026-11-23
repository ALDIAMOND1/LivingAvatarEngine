# Nia — behaviour matrix

How Nia's face and body are driven, state by state. This describes the code as it is, in `src/live/`:

- `behaviour-engine.js` decides. It is renderer-independent and outputs a pose of named controls.
- `splat-stage.js` maps that pose onto the photoreal renderer and owns speech articulation.
- `conversation-state.js` says which state the conversation is in.
- `voice-provider.js` carries the voice, the camera frames, and the model's own choice of feeling and gesture.
- `lab.js` (`live.html?lab`) triggers every feeling and action on the real face and photographs it.

## What the renderer really supports

Checked against the loaded avatar at start-up, not assumed. The adapter lists anything absent in `stage.controls.missing`.

| Control | How it is driven | Status |
|---|---|---|
| Face | 52 ARKit weights per frame | Supported |
| Gaze | Offset in degrees from eye contact; the renderer keeps the eyes on the camera as the head moves | Supported |
| Head and neck | Rotation on `head` and `neckUpper`, added to the idle clip | Supported |
| Torso | Rotation on `abdomenUpper` (lean, turn, tilt) | Supported |
| Breathing | Rotation on `chestUpper` and both collar bones | Supported |
| Shoulders | Rotation on `lCollar` / `rCollar` | Supported |
| Bone directions | Measured once at load (`calibrate()`): on this avatar head roll, torso tilt and chest lift run opposite to the naive guess | Supported |
| Hair movement | None. Hair is part of the static point cloud and follows the head rigidly | Not possible with this renderer |
| Tongue, teeth detail | Only what ARKit `tongueOut` and `jawOpen` give | Limited |
| Hands and arms | Bones exist but are out of frame and not driven | Not used, by design |

## Layers and priority

Higher layers take a control away from lower ones; they do not add up into a fight.

| Priority | Layer | Owns |
|---|---|---|
| Highest | Speech articulation and interruption | Lips and jaw while her voice is audible. On interruption, lips relax at once and cancelled speech gestures never restart |
| High | One-off actions | The controls each action names. Actions in the same slot (two head turns, two gazes) replace each other |
| Medium | Conversation state | Listening, thinking and speaking postures and habits |
| Medium | Emotion | A continuous mix of feelings. While she speaks, feelings only tint the mouth (half strength) and never drop the jaw |
| Low | Idle life | Breathing, posture drift, tiny head movement, eye darts, blinks |

Each group of controls moves at its own speed: eyes dart, lids are quick, brows follow, the mouth is slower, the head settles with a hint of overshoot, the body is slow.

## States

| State | Enters when | Leaves when | Face | Body | Also allowed | If something goes wrong |
|---|---|---|---|---|---|---|
| Silent / idle | Connected and nobody is talking; also before connecting | Either party makes sound | Relaxed, mouth shut, eye contact about 70% with small darts and occasional glances, irregular blinks | Breathing about 14 a minute, posture shift every 5–11 s, head never quite still | Any emotion, any action | Always running; it is the fallback for every other state |
| Listening | The provider reports the person started speaking | They stop | Eye contact about 86%, faint attentive smile unless the mood is sombre, brow flash at a sudden rise in their voice, mouth never driven | Slight head tilt; a nod at the end of a phrase (not after short sounds, at most one per 2.2 s, about 70% of pauses); a smaller nod during long uninterrupted speech | Emotion, actions | No user audio level: posture only, no nods |
| Thinking | The person stopped and she has not started | Her voice becomes audible, or 8 s pass | One of four ways of looking away (up-side, down-side, side with pressed lips, slight up with brows), never the same twice running | Movement reduced | Emotion | Times out to idle |
| Preparing to speak | First instant of speaking | — | Eyes return to the person, brows lift slightly, lips part a little | A visible breath in | — | — |
| Speaking | Her voice is audible (decided from the audio, not from provider events) | Audio silent for 0.6 s | Lips follow the audio (owned by lip-sync); brow lift and small head beat on stressed syllables; eye contact about 66% | Slow head sway, livelier posture shifts, quicker breathing | Emotion tint, actions | No audio level: lips still follow visemes, no beats |
| Pause mid-sentence | Her audio dips for more than 0.3 s while speaking | Sound resumes | Often a blink | A breath in before the next phrase | — | — |
| Interrupted | The person speaks while she is audible | Immediately becomes listening | Lips stop and relax (the tail of her cut-off audio cannot restart them for 0.45 s), brows lift briefly, eyes held on the person for 1.2 s | Speech gestures cancelled | — | Repeated interruptions are bounded; nothing queues up |
| Ending | The call is stopped | Settles to idle | A soft smile (or just an attentive look if the mood is sombre) | — | — | — |

## Emotions

Continuous intensity 0–1. A new feeling cross-fades from the old one (about 0.4 s); each fades by itself after 9 s unless renewed; surprise fades after 1.4 s. In a live call the feeling is chosen by the speech model from the conversation through its `feel()` tool, not from keywords.

| Feeling | Brows | Eyes | Mouth | Head / body | Liveliness |
|---|---|---|---|---|---|
| Happy | Slight lift | Narrowed, cheeks raised | Smile | — | Up |
| Sad | Inner brows up | Lids lowered | Corners down | Head lowered, slight lean back | Down |
| Surprised | Raised | Wide | Jaw drops (not while speaking) | Head and torso back | — |
| Confused | One up, one down | Slight squint | Pressed | Head tilt | — |
| Curious | Slight lift | Slightly wide | — | Lean in, slight tilt | — |
| Concerned | Inner brows up, slight furrow | Slight squint | Slight downturn, no smile | Lean in | Slightly down |
| Amused | — | Narrowed, cheeks raised | Lopsided smile | — | Slightly up |
| Skeptical | One raised | — | Pulled to one side, pressed | Head tilt | — |
| Serious | Slight furrow | — | Pressed, slight downturn to cancel her resting smile | — | Down |
| Excited | Raised | Slightly wide | Smile | — | Well up |

Guard: while the mood is sad, concerned or serious, cheerful reflexes (the listening smile, `softSmile`, `bigSmile`) are refused.

## Actions

Each is a composed movement with attack, hold and release, and returns to rest by itself.

| Group | Actions |
|---|---|
| Eyes only | `lookLeft`, `lookRight`, `lookUp`, `lookDown`, `lookAway`, `eyeContact` |
| Lids | `blink`, `eyesClosed`, `squint`, `widen` |
| Brows | `browRaise`, `browFlash` |
| Head | `nod`, `shake`, `tiltLeft`, `tiltRight`, `turnLeft`, `turnRight`, `headUp`, `headDown` |
| Mouth | `softSmile`, `bigSmile` |
| Shoulders and torso | `shrug` (shoulders, brows, pressed mouth and head tilt together), `shouldersUp`, `shouldersDown`, `leanIn`, `leanBack` |
| Reaction | `surprise` |

Directions are as seen on screen: `lookRight` and `turnRight` go toward the viewer's right.

## Reference images

The corrected pack `Nia_15_Visually_Corrected` holds the same 15 pictures as the first pack with accurate names. They are action references only: several show a different hairstyle, face and age, and none is used as an asset.

| Image | Shows | Reproduced by | Identity note |
|---|---|---|---|
| 01 side gaze, image right | Head part-turned and eyes further right | `turnRight` + `lookRight` | Close to Nia |
| 02 neutral front | Relaxed, mouth closed, whole head in frame | Rest pose | Close to Nia; scoop-neck top |
| 03 three-quarter, image right | Head and shoulders turned right, wider shot | `turnRight` (head only reaches about 14°; the picture is nearer 35°) | Close to Nia |
| 04 side gaze, image left | Head and eyes left | `turnLeft` + `lookLeft` | Close to Nia |
| 05 big smile | Broad smile, teeth, raised cheeks | `bigSmile` | Close to Nia |
| 06 eyes up | Eyes raised, head still | `lookUp` | Close to Nia |
| 07 eyes down | Eyes and chin lowered | `lookDown` + `headDown` | Close to Nia |
| 08 neutral front, alternate | Duplicate of 02 | Rest pose | Close to Nia |
| 09 side gaze, image right, alternate | Eyes right, head nearly front | `lookRight` | Close to Nia |
| 10 surprised | Brows up, eyes wide, mouth open | `surprise` | Different hair (loose, hoops) |
| 11 shoulder shrug | Shoulders up, slight smile, brows up | `shrug` | Visibly older, different face |
| 12 neutral front, different identity | Neutral | Rest pose | Different person and top |
| 13 sad | Inner brows up, mouth corners down | `sad` | Different hair |
| 14 eyes closed | Eyes shut, gentle smile | `eyesClosed` | Different hair |
| 15 head down | Head and gaze lowered | `headDown` + `lookDown` | Close to Nia |

Not shown in any reference, built from anatomy instead: a speaking mouth, head tilt, head up, shoulders down, concern, curiosity, skepticism.

## Observed in a live Nuance call (2026-11-23)

Eight frames, one second apart, of a call the owner ran in their own Chrome, viewed by screenshot.

- Framing: head and shoulders with clear space above the hair, plain grey studio background, the caller's own picture in the lower right corner.
- Head: never still. Between consecutive seconds it tilts by roughly 8-10 degrees either way, lifts and lowers, and shifts sideways in frame by a few percent of the picture width.
- Shoulders: the shoulder line visibly rotates and shifts with the head; clothing moves with it.
- Face while speaking: mouth opens naturally with teeth visible, cheeks and smile lines move, brows rise on emphasis.
- Between phrases: a neutral attentive look, then a thoughtful one with a head tilt and eyes raised.
- It is generated video of a real person, so skin, mouth interior, hair and clothing are all physically coherent in every frame.

What was taken from this: head and posture movement ranges in `behaviour-engine.js` were raised about threefold (speaking sway, tilt, pitch, beats, posture shifts, shoulder set). What cannot be taken from it with the current renderer: the appearance itself. The splat avatar has a small expressive range in the face, no clothing, and a cropped, fringed hair edge.

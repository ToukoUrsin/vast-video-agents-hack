# Understudy: demo script (2:30)

Touko narrates, Alex performs. Laptop on the floor/table in front of Alex, same spot as the recordings.
Start state: **Mountain Dew on the left with its green cap, Coca-Cola on the right with its black cap.**
Keys: `1`–`4` screens, `Space` next beat, `R` reset coach, `T` force Cap swap if recognition stalls.

| Time | Screen | Touko says | Alex does |
|---|---|---|---|
| 0:00 | Library | "Every company records how its best people work, and nobody ever watches it. This archive alone has 2,352 clips." | – |
| 0:10 | Library, press Space | "Understudy pulls it all through VAST: YOLO finds objects, Cosmos Reason describes every clip, Cosmos Embed turns it into vectors in VastDB. This is a replay of that run." | – |
| 0:30 | Map (2), press Space | "Nobody labeled anything. It found the activities on its own: forklifts, traffic, people crossing. And here are three tasks we recorded today." Click **Cap swap**. "It learned the steps from our best takes. The sloppy take sits at the edge with a low rating." | – |
| 0:55 | Coach (3) | "Now a new person. Alex hasn't said what he's doing." | Walks up, hands off for 2 s, then starts: green cap off the Dew. |
| 1:00 | Coach | (coach recognises Cap swap and speaks) "It recognised the task from the camera and talks him through it." | Black cap off the Coke, swap the bottles. |
| 1:15 | Coach | – | **Mistake:** screws the green cap back onto the Mountain Dew, **lets go**, waits. |
| 1:20 | Coach | (coach: "That green cap goes on the Coca-Cola, not the Mountain Dew." + expert clip) "It caught it, and it shows him how the expert did that exact step." | Takes the green cap off, puts it on the Coke, black cap on the Dew, hands off. |
| 1:40 | Coach → Score (4) | "Done. And he gets a score with feedback written by Llama on W&B." | – |
| 2:00 | Score | "Cosmos watches, VAST remembers, W&B coaches, all on CoreWeave GPUs. Every recording becomes a coach, and every attempt makes the library better." | – |

## If something goes wrong

- Recognition slow (> 8 s): press `T` ("selected by presenter" shows on screen; say so).
- Model unreachable: the status line says so. Switch to the backup video (labelled recorded).
- Wrong correction or a missed step: keep going, the coach catches up when the next step is visible.

## Likely questions

- **How fast is it?** About 1.5 s per check: Gemini 3.6 Flash reads the latest frame as a closed-choice question (which cap is on which bottle, which pyramid stage), then fixed checks per step decide progress. A step ticks after two agreeing checks; a correction needs two in a row (four while hands are still on the objects).
- **Is the step list learned?** The step list comes from the expert takes; the completion check for each step ("green cap on the Coca-Cola") is written per task. Unknown tasks fall back to an LLM judge (DeepSeek V4 Flash on W&B).
- **Why Gemini for the live checks, not Cosmos?** We measured it. On 61 hand-labelled frames from our own takes, the Cosmos nano model read 49% of cup-pyramid stages and 78% of cap states right; Gemini 3.6 Flash read 92% and 99%. Cosmos still recognises which task you are doing, describes the whole archive and builds the map with Cosmos Embed, and it is the automatic fallback if Gemini is unreachable.
- **Why not one model end to end?** Vision models are weak at "was a step skipped". Splitting perception (a closed-choice reading per frame) from fixed sequence logic made it reliable.
- **What did VAST do?** Stores the archive and our takes, runs the ingest pipeline, and VastDB holds captions, detections and vectors that drive the map and search.
- **Limits:** tiny parts assembled inside the hands (the astronaut minifigure) are too occluded for live coaching today; it's in the library, not coached live.

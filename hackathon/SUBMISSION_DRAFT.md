# Team 39

## Project
**Understudy** turns unwatched video into a live coach. It learns a task from expert recordings in the VAST archive, then watches a new person on camera, corrects mistakes out loud with the expert clip, and scores the attempt.

**Stack:** VAST AI OS (S3, VastDB; our takes segmented, captioned, embedded and inserted into the team collection), NVIDIA Cosmos Reason (live scene reading, captions, task recognition), Cosmos Embed (map of 2,409 clips, UMAP + clusters), YOLO11 detections from the VSS pipeline, CoreWeave GPUs, W&B serverless inference (Llama 3.3 70B feedback and cluster names, DeepSeek V4 Flash fallback judge, Weave traces), React + FastAPI.
**Code:** https://github.com/ToukoUrsin/vast-video-agents-hack
**Live app:** runs locally on the presenter laptop (webcam), none public
**Supplementary:** backup demo recording (on request)

## Feedback
The pre-built pipeline and skills got us from zero to real search in minutes. Uploaded videos are never segmented for teams, so we wrote our own ingest into VastDB; saying that up front would save teams time. The small Cosmos reasoning model is a strong scene reader but weak at step-sequence logic; splitting perception from logic fixed it. The VM portal capped teams at 50, which blocked team 51 until an organizer reassigned us.

# Access (team 39)

No secrets in this file. Credentials live in `/config/team-39.config` on the VM and in
`.env.local` (gitignored) on Touko's Mac. In `.env.local` the VSS login is `VSS_USERNAME` /
`VSS_PASSWORD` (plain `USERNAME` collides with the macOS shell variable).

- Portal: https://workshop.thecosmoslabs.com (login = email only). Team 39, VM `bc-pool-077` (user `toukoursin`). Team capacity is 2 VMs; Alex can claim the second.
- SSH from the Mac: `ssh vastvm` (key auth over a Cloudflare quick tunnel; alias in `~/.ssh/config`). If the VM tunnel restarts, the trycloudflare hostname changes: read it from `~/cf.log` on the VM and update the alias.
- Private hosts (VSS backend `INGRESS_URL`, S3, VastDB) are only reachable inside their network. From the Mac: `ssh -f -N -D 1080 vastvm`, then use SOCKS `127.0.0.1:1080` (`curl --socks5-hostname 127.0.0.1:1080 ...`).
- Reachable directly from the Mac (public, bearer `GPU_BEARER_TOKEN`):
  - Cosmos Reason: `http://166.19.38.112:8001/v1` model `nvidia/cosmos3-nano-reasoner` (OpenAI-compatible chat, images as `image_url` data URLs)
  - Cosmos Embed: `http://166.19.38.112:8003/v1` model `nvidia/cosmos-embed1` (256-dim)
- W&B inference: `https://api.inference.wandb.ai/v1`, header `OpenAI-Project: vastdata/team-39`, key `WANDB_API_KEY`. Models incl. Llama 3.3 70B, gpt-oss-120b, Qwen3, DeepSeek V4, Nemotron.

## Measured (19:38)

- Cosmos Reason: 1 frame 640 px ≈ 0.5 s; 4 frames 480 px with JSON step verdict ≈ 0.7 s. Live coaching is viable.
- Team index: 414 videos, 2352 indexed segments, 100% with reasoning + detections. Top objects: car, person, traffic light, truck, bicycle, bus, backpack.

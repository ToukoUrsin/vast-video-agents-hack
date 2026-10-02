# Playbook

## Core Principle

Hackathons are usually won by matching the build to the scoring system better than other teams.

The usual failure mode is being too technical, too broad, or too late on the demo.

## Step 1: Classify The Event

Classify each event on these axes before choosing an idea.

### 1. Primary scoring mode

- `business-first`: judges care most about market, validation, monetization, customer pull, and pitch
- `product-first`: judges care most about usefulness, UX, clear features, and a smooth demo
- `technical-first`: judges care most about technical execution, constraints, novelty, or depth

Default time splits:

- `business-first`: `20%` idea, `20%` judge and mentor calibration, `20%` pitch and deck, `20%` validation and traction, `20%` product
- `product-first`: `33%` idea and feature selection, `33%` judge calibration, `33%` demo-focused product execution
- `technical-first`: `33%` understand constraints and target, `67%` build the easiest impressive solution and demo it cleanly

### 2. Challenge style

- `open-ended creative`: coolest, boldest, or most imaginative thing wins
- `sponsor-needs`: a company wants solutions for a specific problem

Implication:

- in `open-ended creative`, optimize for surprise, clarity, and memorable effect
- in `sponsor-needs`, optimize for understanding what they actually want and reflecting their language back to them

### 3. Judging and submission mode

- live booth favors charisma, visual punch, and quick comprehension
- stage pitch favors story, pacing, confidence, and one clean demo moment
- async submission favors video, screenshots, repo quality, and written framing
- code review favors technical coherence and constraint compliance
- sponsor side prize favors explicit use of the sponsor's API and problem framing

Deployment rule:

- deploy early if judges must click the product themselves or remote access is part of judging
- avoid spending late hours on deployment polish if the judging is a presenter-led demo

### 4. Track expected value

Evaluate tracks using:

- prize value
- number of likely competing teams
- strength of likely competing teams
- fit with team stack and speed
- sponsor friction
- story strength
- ability to enter multiple tracks legally

Do not chase big prizes in tracks where the team has no edge.

Track heuristics:

- avoid the obvious crowded track unless the team has a real edge there
- prefer tracks where the sponsor need is clear and the team can mirror it convincingly
- a medium prize with weak competition often beats a large prize with stacked competition
- one project that credibly fits multiple tracks is often higher EV than a bespoke single-track build

### 5. Judge and sponsor motive

Try to infer what the actual evaluator wants.

- company sponsors often want proof their tool solves real problems and can inspire adoption
- startup or investor-style judges often reward sharp framing, market pull, and ambition
- developer advocates often reward clean sponsor integration and demoability
- technical judges often reward constraint-solving and technical clarity
- generalist judges often reward clarity, confidence, and a memorable story over deep internals

Calibration tactics:

- read judge backgrounds before locking the pitch
- ask what success looks like for the sponsor
- pitch a feature direction early and watch the reaction
- if a judge or sponsor gives concrete advice, treat that as a likely scoring clue

## Step 2: Choose The Idea

Choose ideas that score well on:

- easy to explain in one sentence
- obviously relevant to the challenge
- visually demoable
- buildable in the available time
- likely to trigger a judge reaction quickly
- compatible with your default stack

Good sign:

- the demo story is stronger than the implementation complexity

Bad sign:

- the idea needs a long explanation before it sounds valuable

Business-specific note:

- do not be overly afraid that something adjacent already exists
- a familiar idea with a better wedge, audience, wrapper, or timing can still win
- in business-first events, market pattern matching can help more than originality theater

## Step 3: Match The Tactic To The Type

### Business-first

Optimize for:

- clear customer pain
- believable market and business model
- validation interviews, waitlist, pilots, or early users
- sharp pitch and confident answers

Good tactics:

- speak to likely users early
- ask judges and mentors what would make the idea credible
- contact potential customers or design partners
- incorporate direct feedback fast
- if possible, get lightweight proof: quotes, signups, pilots, intro calls, or warm interest
- if judges are accessible, test business framing on them before finalizing the pitch

### Product-first

Optimize for:

- one polished user journey
- tasteful UX
- visible usefulness
- thoughtful feature prioritization

Good tactics:

- build the core flow first
- rank features by `judge impact / build cost`
- seed polished demo data
- prefer features that feel magical in a demo but are cheap to implement

Often high-value product features:

- one-click onboarding with prefilled data
- clean dashboards with obvious before/after value
- AI summarization, ranking, drafting, or recommendations
- voice or multimodal interaction if it creates an immediate wow moment
- notifications, status updates, and progress views that make the product feel complete

Often low-value product work:

- account systems more complex than needed
- admin panels no judge will see
- settings pages
- broad feature menus that dilute the main story

### Technical-first

Optimize for:

- solving the real constraint
- using required tech correctly
- technical credibility
- a demo that makes the technical achievement legible

Good tactics:

- understand the hard requirement before coding
- find the minimum architecture that works reliably
- make the hard part visible in the demo
- turn invisible complexity into obvious output
- if sponsor reps react strongly to a direction, follow that signal fast
- in creative technical tracks, optimize for what feels impressive, not just what is difficult

## Stack Default

Default stack:

- `React`
- `TypeScript`
- `shadcn/ui`
- `Convex`
- `Bun`
- `Gemini`
- `ElevenLabs` when voice clearly improves the demo

Use this stack because it reduces decision cost.

Do not use a tool just because it is fashionable. Use it if it is the fastest reliable route to the judged outcome.

## Practical Rules

- sleep at least `8` hours if possible; dead teams demo badly
- arrive early and claim a strong setup spot
- grab displays, power access, and table position early if the venue setup makes that valuable
- initialize git immediately
- assign roles early: builder, presenter, pitch owner, operations owner
- decide one presentation owner early
- research judge backgrounds when possible
- keep snacks, water, caffeine, cables, chargers, and adapters under control
- store supplies intentionally so the last hour is not spent hunting for basics
- split across multiple challenges only if rules allow it and coordination cost stays low

Multi-track strategy:

- only do this when rules clearly allow it
- prefer splitting by ownership, not by vague collaboration
- one team can pursue multiple tracks if the core product is shared and each wrapper is coherent
- two clean sponsor wrappers around one product is often safer than two separate products
- do not let extra tracks damage the main demo

## Common Mistakes

- overbuilding infrastructure
- being too technical for the scoring mode
- ignoring the submission format until late
- failing to talk to judges, mentors, or sponsor reps
- choosing a cool idea that is hard to explain
- shipping too many features instead of one excellent flow
- not rehearsing the pitch
- depending on fragile live integrations without a fallback
- forgetting repo hygiene and env setup
- treating all hackathons as if they reward the same thing

## Ruthless Prioritization

Usually worth it:

- a cleaner demo flow
- better copy and framing
- seeded data
- a stable happy path
- short pitch practice
- direct sponsor or judge feedback

Usually not worth it:

- deep refactors during the final stretch
- backend polish no judge will notice
- extra features outside the core story
- production-grade infra unless required
- late stack changes
- perfectionism on anything outside the scoring path

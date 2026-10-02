# Checklist

## Before The Event

- read the event page, rules, prizes, and judging criteria
- identify required sponsors, APIs, team size limits, and submission format
- pre-create needed accounts, credits, and billing setup
- bring chargers, adapters, extension cords, monitor cables, headphones, and snacks
- prepare a basic starter app and known-good stack
- make sure git is installed and working

## First 60 Minutes

- classify the event using [PLAYBOOK.md](PLAYBOOK.md)
- choose target track or tracks
- talk to organizers, mentors, sponsor reps, or judges if available
- research judge and sponsor backgrounds if names are public
- ask what the sponsor actually wants to see if the track is sponsor-driven
- lock one idea and one backup
- decide presenter and clear responsibilities
- initialize git immediately
- create local env files and confirm secrets stay out of git
- define the core demo in one sentence

## During The Build

- keep checking against the judging rubric
- bias toward visible progress over invisible architecture
- get feedback early instead of guessing
- if a sponsor or judge asks for something feasible, implement it fast and show it back
- maintain one polished happy path
- keep a fallback if deployment or APIs fail
- cut features aggressively
- if the event allows multiple tracks, only split work if ownership is clean and expected value is real

## Demo And Submission

- rehearse the pitch out loud
- make the first 20 seconds instantly understandable
- show the best moment early
- seed data so the demo never depends on luck
- prepare a backup video or screenshot flow
- make screenshots, repo README, and submission copy clean
- explicitly mention sponsor tech and challenge relevance
- answer with business impact, user value, or technical achievement based on the scoring mode

## Physical Operations

- sleep instead of trying to hero-run the whole event
- arrive early for a better table and display setup
- secure screens, charging, adapters, and extension access before the room fills up
- keep drinks and supplies organized
- keep backup caffeine, water, and quick food accessible instead of scattered
- protect demo devices and charging access
- do not let logistics failures ruin the final hour

## Git And Env Hygiene

- use `.env.local` or equivalent for secrets
- never commit real keys
- keep `.env.example` sanitized
- confirm the presenter machine has the required env vars
- make one person responsible for repo cleanliness before submission

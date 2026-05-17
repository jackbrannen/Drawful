# Drawful — Proposed UI Text

All copy, labels, and messages for the game. Sections marked with existing-game patterns
are locked to match the shared UX — don't change these unless you want to diverge from
the other games.

---

## Meta

**Proposed primary color:** `#7B2C2C` (dark brick red)  
**Accent color:** `#FBDF54` (universal yellow — do not change)  
**Minimum players:** 4  
**Structure:** Each player draws one prompt → all drawings judged one at a time (guessing → voting → results per drawing)

---

## Home Page
*(Matches Fishbowl / GameOfWhat / ExquisiteCorpse pattern exactly)*

**Game title:** Drawful

**Tagline:** Draw weird. Guess weirder.

**Create button:** Create Game  
**Create button (loading):** Creating…

**Room code input placeholder:** Room code  
**Join button:** Join

**Dummy game button (bottom, subtle):** Dummy Game  
**Dummy game button (loading):** Setting up…

---

## Lobby Page
*(Matches existing pattern exactly)*

**Invite button:** Invite

**Section: Join form**
- Section label: Join Game
- First name placeholder: First name
- Last name placeholder: Last name
- Display name placeholder: Display Name
- Join button: Join
- Join button (loading): Joining…

**Section: Players**
- Section label: Players
- Empty state: No players yet

**Start button (host, enough players):** Start Game  
**Start button disabled note:** Minimum 4 players needed

**Info text below start button (once 4+ players joined):**  
[N] players = [N] drawings.

---

## Drawing Phase

**Phase label (small caps):** DRAWING PHASE

**Your prompt label (subtle, above the prompt):** YOUR PROMPT

**The prompt itself:** displayed large and clearly — e.g. *A bear aggressively parallel parking an SUV*

**Instruction (below prompt):** Draw this. No letters or numbers!

**Timer display:** [N] seconds

**Submit button (early):** Done Drawing  
**Submit button (loading):** Submitting…

**Timer expired:** Time's up! Submitting your drawing…  
*(Drawing auto-submits at zero — no action required from player)*

**Waiting screen (after submitting):** Waiting for everyone to finish drawing…  
**Progress:** [N] of [N] done

---

## Guessing Phase
*(One drawing shown to all; non-artists type a fake answer; artist watches)*

**Header:** [Artist name]'s drawing

**Instruction (non-artist):** Write a fake answer — something that sounds like the real prompt.

**Input placeholder:** Your fake answer…

**Submit button:** Submit  
**Submit button (loading):** Submitting…

**Already submitted:** You answered: "[their answer]"  
*(Shown while waiting for others)*

**Waiting after submit:** Waiting for everyone to answer…

**Artist view — instruction:** Watch the fake answers come in.  
**Artist view — live count:** [N] answer[s] submitted so far  
*(Answers shown as they arrive, text redacted — just the count and maybe a "..." placeholder per answer to build suspense)*

---

## Voting Phase
*(All answers — real + fakes — shown in random order; everyone votes except the artist)*

**Header:** [Artist name]'s drawing

**Instruction:** Pick what you think is the real answer.

**Artist view — instruction:** Watch everyone vote.

**Vote button (on each answer option):** Vote  
**Vote button (loading):** Voting…

**Already voted:** Waiting for everyone to vote…

---

## Results Phase
*(Shown after voting, before moving to the next drawing)*

**Header:** [Artist name]'s drawing

**Prompt reveal:** The prompt was: "[real prompt]"

**Real answer label:** ✓ [real answer] — the real answer

**Per fake answer:**  
[fake answer] — written by [Author name]  
→ Fooled: [Name], [Name] · +[N×500] pts  
→ *(If nobody voted for it: Nobody was fooled)*

**Correct guessers:**  
[Name] guessed right · +1000 pts  
*(If nobody guessed right: Nobody got it!)*

**Scores so far label:** Scores so far  
*(Running leaderboard shown below results)*

**Next drawing button (host only):** Next Drawing →  
**Waiting (non-host):** Waiting for [host name] to continue…

**Last drawing label (on the final results screen):** Last one!  
**Finish button (host, after last drawing results):** See Final Scores →

---

## Final Scores

**Heading:** Game over!

**Winner line (one winner):** [Name] wins!  
**Winner line (tie):** It's a tie!

**Play again button:** Play again  
**Back to lobby button:** Back to lobby

---

## Error / Edge Case Messages
*(Matches other games)*

**Game not found:** Game not found. Check the code and try again.  
**Game already started:** This game has already started.  
**Name taken:** That username is already taken in this game. Please choose another.  
**Generic error:** Something went wrong. Refresh and try again.

---

## Prompt Generation System

**Prompt bank:** `drawful_prompts` Supabase table — columns: `id`, `text`, `used_at` (null = unused).  
**Bank size target:** 50 unused prompts at all times.  
**Refill trigger:** When unused count drops below 10, the server calls Claude to generate a fresh batch of 50, passing the last 50 used prompts as exclusions.

**System prompt to Claude (for prompt generation):**

> Generate 50 Drawful-style drawing prompts for a party game. Each should be a specific, concrete scene that would be funny to draw and guess.
>
> Rules:
> - Each prompt has exactly one absurd element — one normal thing in a weird situation, or one weird thing in a normal situation. Don't stack two or more absurdities.
> - No letters, numbers, or text-based humor — prompts must be drawable.
> - Vary prompt length — some should be 2–3 words, some 4–6, some longer. Don't let any one length dominate.
> - Vary structure: at least 10 should be compound nouns or hybrid objects ("half X, half Y"), at least 10 should be location/situation-based ("inside a X, a Y is happening"), and the rest can be "a [character] doing [wrong thing]" style.
> - Do not reuse any character, animal, setting, or concept from the list below. Avoid anything too similar.
>
> Format: one prompt per line, no numbering, no quotes, no punctuation at the end.
>
> [Last 50 used prompts listed here]

---

## Design Notes for Implementation
*(Remove before building)*

- **Timer**: `drawing_started_at` timestamp stored in DB at game start. Clients compute remaining time as `90 - (Date.now() - drawing_started_at) / 1000`. At zero, client submits automatically if not already submitted.
- **Prompt assignment**: assigned at `drawful_start_game` RPC. Each player gets one prompt drawn from unused rows in `drawful_prompts`. Those rows are marked `used_at = now()`.
- **Answer randomization**: when voting phase starts, a `drawful_start_voting` RPC shuffles answers and writes a stable `display_order` integer to each row. All clients render in that order.
- **Who drew this**: artist name is shown during guessing and voting phases (per design decision). It adds a social layer — you know who to try to fool.
- **Artist during guessing**: sees answers arriving in real time as a count + masked placeholders. No text shown — just suspense.
- **Scoring RPC**: `drawful_score_round` runs atomically after voting closes. Awards 1000 pts per correct guess to each correct voter, 500 pts per vote received to each fake-answer author. Artist receives no points.
- **No skip / no timer extension**: drawing phase is fixed 90 seconds, auto-submits.
- **Prompt API route**: `/api/generate-prompts` — server-side Next.js route that calls the Anthropic API. Never exposed to the client. Triggered by the game server when the bank runs low, not by the client directly.
- **Dummy game**: bots submit blank drawings and random fake answers during guessing. Useful for testing the full flow solo.

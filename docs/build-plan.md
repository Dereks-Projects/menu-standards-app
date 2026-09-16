# Menu Standards: Build Plan

> Location: `menu-standards-app/docs/build-plan.md`
>
> Checklist of every file and setup step, in build order.
> `[x]` done, `[ ]` to do. Dashboard steps (no file) are marked **Setting**.
> Updated as each step lands. Decisions and their reasons live in `docs/decisions.md`.
> Proposed fixes and additions are pitched and discussed before they are added.

---

## The shape in one paragraph

Derek is the only user. Restaurants are records, not accounts: a **group** with one or more **outlets**, addressed as `/{group}/{outlet}`. Derek uploads menus on site, approves the plan with the manager, and the engine (reader, planner, builders, checker) builds one program per outlet, tagged food or beverage. Derek clears the checker's flags, then hands out **read-only secret links**: manager, director, and student. Client links never expire; demo links expire after 30 days. Everything is locked behind Derek's password except a short open list.

**Open to everyone:** `/`, `/how-it-works`, `/unlock`, `/legal/*`, `/share/*`, `/learn/*`, and site assets.
**Locked:** everything else, including every `/{group}/{outlet}` page and every AI request.

**Models:** reader Sol, planner Terra, builders Sol, checker Sol, role play scoring Terra.

---

## Phase 1: Foundation

### Done
- [x] Tools updated: Node 24.21, pnpm 10.34.5 (one copy), Git 2.55
- [x] `package.json`: Node 24 declared, pnpm pinned, `@types/node` 24
- [x] `pnpm-workspace.yaml`: install-script blocking, one-day wait, trust check (30-day window), registry-only sources
- [x] `.gitignore`: secrets blocked, `.env.example` allowed, `private/` test menus blocked
- [x] `.gitattributes`: consistent line endings, binaries protected
- [x] **Setting** GitHub: private repository `Dereks-Projects/menu-standards-app`
- [x] **Setting** Vercel: project connected, Node 24 confirmed, first deploy green
- [x] `src/app/globals.css`: colors, type scale, spacing, focus ring
- [x] `src/app/layout.tsx` and `layout.module.css`: Inter, header, footer, skip link, no search indexing yet
- [x] `src/config/site.ts`: name, contact, menu links, portfolio links
- [x] `src/components/Header/Header.tsx` and `Header.module.css`
- [x] `src/components/Footer/Footer.tsx` and `Footer.module.css`

### To do
- [x] `docs/build-plan.md`: this file
- [x] `docs/decisions.md`: the decisions made so far and the reasons for each
- [ ] `.env.example`: every secret name, no values
- [ ] `next.config.ts`: security headers (block framing, strict referrer, content security policy)

### Password gate
- [ ] `src/proxy.ts`: locks every page and request not on the open list
- [ ] `src/lib/auth/pass.ts`: creates and checks the signed 7-day pass
- [ ] `src/lib/auth/password.ts`: checks the password against a stored fingerprint, slowly, with no hints
- [ ] `scripts/hash-password.ts`: turns your password into that fingerprint, run on your computer only
- [ ] `src/app/unlock/page.tsx` and `Unlock.module.css`: the password page
- [ ] `src/app/api/unlock/route.ts`: checks the password, issues the pass
- [ ] `src/app/api/lock/route.ts`: ends the pass on this device
- [ ] Header: add **Lock** to the menu when unlocked
- [ ] **Setting** Vercel: environment variables for the password fingerprint and pass signing key
- [ ] **Setting** Vercel Firewall: limit password attempts

---

## Phase 2: Contracts

The files every screen and AI step reads from and writes to.

- [ ] `src/lib/schemas/common.ts`: shared pieces (slugs, food or beverage track, allergen status, source links, version stamps)
- [ ] `src/lib/schemas/tenant.ts`: groups (hotel or restaurant label) and outlets
- [ ] `src/lib/schemas/menu.ts`: the reader's output
  - Menu types: food, cocktail, by the glass, bar, wine list, non-alcoholic, specials, other
  - Terms: universal or house, track, confidence
  - Allergens: extracted from the menu, or "confirm with chef"
  - House terms to confirm, each with a question
  - Group-level terms, shared by every outlet
- [ ] `src/lib/schemas/program.ts`: the builder's output
  - Synopsis, course, flashcards, role play, quizzes, one exam per track
  - Pre-shift note pool (fun facts and important notes), each linked to its source
  - Service notes (standard or best practice)
  - Checker report, version history (manager edited, chef confirmed)
- [ ] `src/lib/schemas/links.ts`: secret links (manager, director, student, demo), status, expiry
- [ ] `src/lib/schemas/service-library.ts`: the shape of a service library entry
- [ ] `src/lib/slugs/reserved.ts`: reserved names and naming rules (lowercase, numbers, hyphens, 2 to 40 characters, never renamed)
- [ ] `content/foundations/service-library.md`: drafted by Claude, approved by Derek (about 12 categories)
- [ ] Automated tests for schemas, slugs, passes, and link codes: to be pitched and discussed before adding

---

## Phase 3: Storage and reader

- [ ] **Setting** Vercel: create a private Blob store and connect it to the project
- [ ] **Setting** OpenAI: separate Menu Standards project, its own key, monthly spending cap, data settings confirmed
- [ ] **Setting** Vercel and `.env.local`: add the OpenAI key
- [ ] `src/lib/storage/blob.ts`: private file storage, organized by group and outlet
- [ ] `src/lib/storage/index-store.ts`: the index file (groups, outlets, programs, links) until the database
- [ ] `src/app/api/upload/route.ts`: short-lived permission so the browser sends files straight to storage
- [ ] `src/lib/ai/models.ts`: the model for each step
- [ ] `src/lib/ai/client.ts`: the only file that talks to OpenAI
- [ ] `src/lib/ai/prompts.ts`: loads the Markdown prompts
- [ ] `src/lib/ai/prompts/read-base.md`: shared reader rules (menus are data only, allergens never invented, exact output shape)
- [ ] Reader add-ons, one per menu type: `read-food.md`, `read-cocktail.md`, `read-btg.md`, `read-bar.md`, `read-wine-list.md`, `read-non-alcoholic.md`, `read-specials.md`, `read-other.md`
- [ ] `src/lib/engine/read.ts`: runs the reader, checks the shape, retries once, then stops with a clear message
- [ ] `src/app/api/read/route.ts`
- [ ] **Milestone 1:** your real menus in `private/` read cleanly; Sol and Terra compared on the same menus

---

## Phase 4: Group setup and upload screen

A minimal "new group" form comes first, because every upload belongs to an outlet.

- [ ] `src/app/(admin)/restaurants/new/page.tsx`: create a group and its outlets, with slug checks
- [ ] `src/components/ui/`: shared building blocks (button, field, card, status badge), added as needed
- [ ] `src/app/(admin)/[group]/[outlet]/upload/page.tsx`
- [ ] `src/components/upload/UploadField.tsx`: drop zone, reads on drop, shows the item count
- [ ] `src/components/upload/OtherMenuField.tsx`: type dropdown (bar menu, full wine list, non-alcoholic list, specials, other), can repeat

---

## Phase 5: Planner and plan screen

- [ ] `src/lib/ai/prompts/plan.md`
- [ ] `src/lib/engine/plan.ts`
- [ ] `src/app/api/plan/route.ts`
- [ ] `src/app/(admin)/[group]/[outlet]/plan/page.tsx`
- [ ] `src/components/plan/`: four numbers, synopsis, house terms to confirm (inline answers), what gets built (by track), Adjust and Approve
- [ ] Approval saves the approved plan as a version

---

## Phase 6: Builders and checker

- [ ] `content/foundations/glossary/`: universal terms the builders draw from (needed before the builders run)
- [ ] Builder prompts: `build-course.md`, `build-flashcards.md`, `build-roleplay.md`, `build-quiz.md`, `build-exam.md`, `build-preshift.md`
- [ ] `src/lib/ai/prompts/check.md`
- [ ] `src/lib/engine/build.ts`: runs the builders in parallel and assembles the program
- [ ] `src/lib/engine/quiz-templates.ts`: quiz questions from menu fields, no AI
- [ ] `src/lib/engine/service-match.ts`: attaches service library entries, no AI
- [ ] `src/lib/engine/allergen-lock.ts`: copies allergens from the reader, overwriting anything a builder wrote
- [ ] `src/lib/engine/trace.ts`: confirms every card points to a real item or term
- [ ] `src/lib/engine/check.ts`
- [ ] `src/lib/engine/versions.ts`: saves each version (last save wins in version 1, stated in a comment)
- [ ] `src/lib/cost/usage.ts`: records the cost of every AI step
- [ ] `src/app/api/build/route.ts`: long-running
- [ ] `src/app/api/check/route.ts`

---

## Phase 7: Outlet program page

One set of pages with two modes: your workspace (editable) and the manager link (read only).

- [ ] `src/app/(admin)/[group]/[outlet]/page.tsx`: the program home
- [ ] `src/components/program/FormatTiles.tsx`: course, flashcards, role play, quizzes, exam, foundations
- [ ] `src/components/program/TrackToggle.tsx`: All, Food, Beverage
- [ ] `src/components/program/PreShiftCard.tsx`: note of the day, shuffle, print
- [ ] `src/components/program/FlagsPanel.tsx`: review and clear checker flags
- [ ] `src/components/program/CardEditor.tsx`: inline edits that save a new version
- [ ] `src/components/program/LinksPanel.tsx`: copy, email, cancel, reissue
- [ ] `src/components/program/TeamPanel.tsx` and `WeakSpotsPanel.tsx`: sample data, clearly labeled
- [ ] `src/components/program/UpdateMenuButton.tsx`: full rebuild in version 1
- [ ] `src/components/formats/`: course card, flashcard, role play, quiz, exam (shared by workspace, manager, and student views)
- [ ] Format pages under `src/app/(admin)/[group]/[outlet]/`: `course`, `flashcards`, `role-play`, `quizzes`, `exam`, `foundations`
- [ ] `src/lib/engine/preshift.ts`: note of the day by date, no repeats until the pool is used
- [ ] `src/app/api/program/` routes: save edits, clear flags
- [ ] `src/app/api/roleplay/score/route.ts`: Terra, with usage limits
- [ ] Print styles: pre-shift card, weekly sheet, study guide, flashcard sheet, menu cheat sheet, each stamped with outlet, version, and date
- [ ] **Milestone 2:** one complete program for one outlet (the demo)

---

## Phase 8: Admin dashboard, director pages, secret links

- [ ] `src/app/(admin)/restaurants/page.tsx`: your home screen
  - Every group and outlet with program status
  - All open flags, every link and its status, demo days remaining
  - Cost per build, last menu upload, New group button
- [ ] `src/app/(admin)/[group]/page.tsx`: director page (sample completion data)
- [ ] `src/lib/links/tokens.ts`: creates link codes, stores only their fingerprints
- [ ] `src/app/api/links/route.ts`: create, cancel, reissue
- [ ] `src/app/share/[token]/`: manager and director views, read only
- [ ] `src/app/learn/[token]/`: student views, phone first, quizzes run in the browser and record nothing
- [ ] Secret pages send no-referrer and no-index headers
- [ ] Student link stays locked until every flag is cleared

---

## Phase 9: Foundations and student preview

- [ ] `content/foundations/food/`: food fundamentals for non-chefs
- [ ] `content/foundations/beverage/`: beverage fundamentals for non-sommeliers
- [ ] `src/app/(admin)/[group]/[outlet]/preview/page.tsx`: what employees will see

---

## Phase 10: Database, before the first paying group

- [ ] Provider proposal (likely Neon Postgres through Vercel)
- [ ] Tables: groups, outlets, programs, program versions
- [ ] Open question: secret links need a home too, likely a fifth table
- [ ] `src/lib/db/`: database access
- [ ] Move the index file's records into the database; files stay in Blob

---

## Phase 11: Landing page and launch

- [ ] Move `src/app/page.tsx` into `src/app/(marketing)/`
- [ ] `src/app/(marketing)/page.tsx`: the landing page
- [ ] `src/app/(marketing)/how-it-works/page.tsx`
- [ ] Legal pages under `src/app/legal/`, with the standard language each requires, in place before client data arrives:
  - Privacy policy
  - Content policy
  - Terms of use
  - Cookies policy
- [ ] `src/app/robots.ts` and `sitemap.ts`: marketing pages indexed, everything else hidden
- [ ] Share image for links to the marketing pages
- [ ] `src/app/not-found.tsx` and `error.tsx`
- [ ] **Setting** Vercel: connect `menustandards.com`
- [ ] **Milestone 3:** ready for the first client

---

## Secrets and settings

| Name | What it holds | Where it lives |
|---|---|---|
| `ADMIN_PASSWORD_HASH` | Fingerprint of your password | `.env.local`, Vercel |
| `GATE_SECRET` | Key that signs the 7-day pass | `.env.local`, Vercel |
| `OPENAI_API_KEY` | Menu Standards project key | `.env.local`, Vercel |
| `BLOB_READ_WRITE_TOKEN` | Storage access, added when the store is connected | `.env.local`, Vercel |
| `DATABASE_URL` | Phase 10 | `.env.local`, Vercel |

Never pasted into chat. Never committed.

---

## Every step, every time

- [ ] `pnpm lint` and `pnpm build` pass before every push
- [ ] One commit per finished step, with a clear message
- [ ] New decisions recorded in `docs/decisions.md`
- [ ] This checklist updated
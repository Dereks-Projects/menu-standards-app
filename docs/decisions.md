# Menu Standards: Decisions

> Location: `menu-standards-app/docs/decisions.md`
>
> Every decision that shapes the build, with the reason and when to revisit it.
> Decisions made by Derek, or by Derek and the development agent together, override the original developer letter.
> Newest decisions are added at the bottom of their section.

---

## Product shape

**1. One user: Derek.** Restaurants are records, not accounts. A group holds one or more outlets, addressed as `/{group}/{outlet}`. No user accounts, roles, or sign-in in version 1.
*Why:* Derek uploads menus on site with the manager present. The account model stays undecided until there is a working product and a buyer.

**2. Secret links are read only.** Manager, director, and student links each end in a long random code. Only a fingerprint of each code is stored. Client links never expire; demo links expire after 30 days. Any link can be canceled and reissued.
*Why:* managers and staff need access without accounts, and a leaked storage file must not open a program.

**3. The student link stays locked until every checker flag is cleared.**
*Why:* nothing unverified reaches staff.

**4. Food or beverage is tagged on each item and term, not on each upload.** One program, filtered by view (All, Food, Beverage), with one exam per track.
*Why:* bar menus carry food and food menus carry dessert wines.

**5. Edits save a new version.** Manager edits are marked "manager edited"; allergen edits are marked "chef confirmed." In version 1 the last save wins.
*Revisit:* when more than one person can edit at the same time.

**6. Pre-shift notes are written and checked during the build.** "Generate" on a manager link draws from that approved pool. The note of the day rotates by date and is the same on every device.
*Why:* no live AI on open links, so no cost exposure and nothing unchecked.

**7. Service notes come from a curated library, never from the AI.** Each entry is marked standard (non-negotiable) or best practice. The build matches entries to menu items; the checker confirms every service note came from the library.
*Why:* service steps such as the seafood fork or foie gras accompaniments must be exact.

**8. PDFs come from the browser's print option.** Every printout is stamped with outlet, program version, and date.
*Why:* no extra server software, and outdated sheets are easy to spot.

**9. Specials stays its own menu type.**
*Why:* specials change most often and drive the future "rebuild only the changes" feature.

---

## AI engine

**10. Code runs the pipeline; each AI step does one job.** Reader, planner, builders, checker, and role play scorer each have their own prompt file and model. No AI step has tools. Builders never see the raw menu, only the approved terms and their format rules.
*Why:* predictable, reviewable, and resistant to instructions hidden inside an uploaded menu.

**11. Allergens are copied by code from the reader's result** and overwrite anything a builder writes. Anything unconfirmed is marked "confirm with chef."
*Why:* a wrong allergen answer ends an account.

**12. The checker is a separate step** and runs only after code confirms every card points to a real menu item or term.
*Why:* a model reviewing its own work tends to approve it.

**13. AI provider: OpenAI, through one connector file** (`src/lib/ai/client.ts`). Model names live in one settings file (`src/lib/ai/models.ts`).
*Why:* Derek has existing OpenAI credits and setup. Switching providers later means changing one file.

**14. Models by step:** reader GPT-5.6 Sol, planner GPT-5.6 Terra, builders GPT-5.6 Sol, checker GPT-5.6 Sol, role play scoring GPT-5.6 Terra.
*Why:* accuracy where it matters most, lower cost where volume grows with headcount. GPT-6 Astra was considered and set aside for cost and staged access.
*Revisit:* at Milestone 1 (Sol and Terra compared on real menus), and if Sol's promotional pricing ends.

**15. Role play is scored by AI, with usage limits.**
*Why:* scoring cost grows with the number of employees, and the student link is open.

**16. Menus are uploaded from the browser straight to storage.**
*Why:* Vercel rejects requests larger than 4.5 MB, and phone photos often exceed that.

---

## Security and access

**17. The password gate is an access and cost control, not authentication.** One password for Derek; a signed pass lasts 7 days per device; a Lock button ends it early; changing the password ends every pass. The password itself is never stored, only a fingerprint.

**18. Everything is locked except a short open list:** the landing page, how it works, the unlock page, legal pages, and secret link pages.

**18a. The gate is the front door, not the only lock.** Pages and requests that handle client data check the pass again themselves.
*Why:* a single mistake in one file should never expose a client's program. Next.js gives the same guidance after a 2025 flaw that let attackers skip middleware checks.

**18b. Password attempts are limited at Vercel's edge:** the unlock request is capped at 10 posts per 60 seconds per IP address, then refused for 30 minutes.
*Why:* guessing is stopped before it reaches the app or costs anything. The app also checks the password slowly and pauses after a wrong answer.

**18c. The pass cookie cannot be read by page code, and on the live site its name carries the browser's `__Host-` prefix,** which makes browsers reject it unless it is secure and tied to this exact domain.

**19. Reserved names.** Slugs that collide with app pages are blocked. Slugs use lowercase letters, numbers, and hyphens, 2 to 40 characters, and never change once issued.
*Why:* links already handed out must keep working.

**20. Uploaded menus and built programs are customer data.** They live in private storage and never in the Git repository. Local test menus go in the ignored `private/` folder.

**21. Search engines are blocked site-wide until the landing page launches.** Then only marketing pages are indexed.

**22. No analytics in version 1.**
*Why:* program pages and student links hold client data.
*Revisit:* marketing pages only, under a separate account, if wanted later.

---

## Stack and tooling

**23. TypeScript, not JavaScript.**
*Why:* the product is data passed between steps; one Zod definition checks AI output at run time and our code at build time. Typed code is what engineering reviewers expect.

**24. `src` folder, App Router, CSS Modules, no Tailwind, pnpm only.** Matches the look of Restaurant Standards without sharing code.

**25. Node 24 LTS**, declared in `package.json` and set in Vercel.
*Why:* Node 20 reached end of life in April 2026. Node 24 is supported until April 30, 2028.

**26. Next.js 16.3.5**, so the password gate uses `proxy.ts`.
*Policy:* apply Next.js security patch releases promptly. Next.js now ships security fixes monthly.

**27. pnpm 10.34.5, not 11 or 12.**
*Why:* Vercel does not yet support pnpm 11 or 12 without workarounds.
*Revisit:* before April 30, 2027, when pnpm 10 support ends.

**28. pnpm supply-chain protections** in `pnpm-workspace.yaml`: install scripts blocked unless approved, installs fail on unreviewed scripts, one-day wait on new versions, trust downgrade check, registry-only sources.
*Why:* pnpm 10 has these off by default; pnpm 11 turns most of them on.

**29. The trust check applies only to versions published in the last 30 days.**
*Why:* older releases published without signatures raised false alarms. First case: `eslint-import-resolver-typescript` 3.10.1, reviewed September 15, 2026, no known vulnerabilities.

**30. ESLint stays on version 9.**
*Why:* the Next.js lint rules, including the accessibility checks, support only up to ESLint 9. ESLint runs only on the development machine.
*Revisit:* when `eslint-config-next` supports ESLint 10.

**31. TypeScript stays on 5.9.**
*Why:* TypeScript 7 does not yet include the interface that ESLint's TypeScript support relies on.
*Revisit:* when the lint tooling supports TypeScript 7.

**32. React stays on 19.2.8.**
*Why:* it is the version installed and tested with Next.js 16.3.5.
*Revisit:* when Next.js moves to a newer React.

**33. Line endings are LF everywhere**, set in `.gitattributes`.
*Why:* matches Vercel's build servers and reviewers on macOS and Linux.

---

## Design

**34. Palette:** page `#fafafa`, surfaces `#ffffff`, borders `#e5e5e5`, text `#1e1e1e`, muted text `#666666`, near-black buttons, accent `#800000` with hover `#400000`. Status colors pair color with an icon and a word.
*Why:* congruent with the Restaurant Standards look, with maroon replacing gold. Every text color meets WCAG 2.2 AA.

**35. Inter, served from this site through `next/font`.**
*Why:* faster pages, and visitors' browsers never contact Google.

**36. No bottom mobile navigation in version 1.** The header menu works on every screen size.

**37. The header and footer always name Menu Standards and Informative Media.** A property's name appears only as content: program titles, synopsis, pre-shift cards, and printouts.

---

## Working agreements

**38. Proposed fixes and additions are pitched and discussed before they are added.**
Pending pitch: automated tests.

**39. Legal pages** (privacy policy, content policy, terms of use, cookies policy) are written at the right time, with the standard language each requires, before client data arrives.

**40. Phase 1 closed on September 24, 2026,** with the gate verified on the live site: locked pages ask for the password, a wrong password is refused, and Lock ends the pass immediately.
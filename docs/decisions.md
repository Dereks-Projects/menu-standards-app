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

**7a. Service entries match by menu type as well as by text.** A beverage entry attaches only to beverage items and a food entry only to food items. Text triggers are matched whole word. The words "bottle" and "magnum" are treated as menu triggers rather than text, so an entry carrying either attaches to every item on a wine list and to nothing on a by-the-glass list, and the entry that requires pouring by-the-glass wine at the table attaches to every item on a by-the-glass list.
*Why:* a wine list reads "Sancerre, Domaine Vacheron, 2023," so matching the word "bottle" would attach bottle service steps to nothing. Scoping by trigger rather than by entry also keeps serving temperature attached to wines by the glass, where it matters just as much.
*Recorded:* September 24, 2026, with the service library approved at 37 entries and capped at 40.

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
*Superseded by decision 41 on September 29, 2026.*

**15. Role play is scored by AI, with usage limits.**
*Why:* scoring cost grows with the number of employees, and the student link is open.

**16. Menus are uploaded from the browser straight to storage.**
*Why:* Vercel rejects requests larger than 4.5 MB, and phone photos often exceed that.

**41. Models by step, GPT-6 family:** reader GPT-6.1 Sol, planner GPT-6.1 Sol, builders GPT-6.1 Sol, checker GPT-6 Astra, role play scoring GPT-6 Luna. GPT-6 Sol is the fallback for any Sol step, at the same price. Model names stay pinned to exact versions in `src/lib/ai/models.ts`, never a "latest" alias.
*Why:* GPT-6.1 Sol nearly matches Astra at one fifth of Astra's price, $2 in and $10 out per million tokens on September 29, 2026. That is cheaper than GPT-5.6 Terra was, and Terra has no GPT-6 version. Astra checks the builds because a different, stronger model auditing Sol's work is the reason the checker is a separate step (decision 12), and it runs once per build, so the premium is a few dollars. Astra never reads raw uploads: OpenAI's guidance says it is more sensitive to instructions inside files it is given, and the checker sees only data that has already passed our code's checks. Luna scores role play because that is the only cost that grows with headcount, at about one twentieth of Sol's price.
*Estimates:* about $4 per build for a single restaurant with three short menus, about $8 with a wine list, about $40 for a five-outlet hotel. Role play scoring about $1 to $6 a month. Milestone 1 replaces these with measured costs.
*Revisit:* at Milestone 1 (reader: GPT-6.1 Sol compared with GPT-6 Astra on the same menus), and at Phase 6 if Astra is not available on the account, in which case Sol checks.
*Result:* GPT-6.1 Sol confirmed as the reader at Milestone 1 (decision 54).

**42. The reader's answer has two layers, and code assigns every identifier.** The request sent to OpenAI uses its own shape: every field required, "nullable" instead of "optional," and no default values, generated by Zod 4's built-in JSON Schema output rather than the OpenAI SDK's helper. `MenuSchema` is then applied to the answer in code. `read.ts` assigns identifiers, merges per-item terms into one list, and turns unresolved house terms into questions. The model never assigns an identifier.
*Why:* OpenAI's strict answer mode rejects default values, and our schemas use several. Identifiers must be reliable, because `trace.ts` confirms every card against them later.

**43. Menu files reach OpenAI inline, with response storage off.** The server downloads each file from private storage and sends the file itself with the request. No public link is ever created, OpenAI's file storage is never used, and every request is sent with storage turned off.
*Why:* a private storage link is useless to OpenAI, and client menus should not sit in a second company's file storage.

**49. The menu is the guide: the reader records only what is printed.** An allergen is recorded only when the menu names it for that item, either the allergen itself or the food itself (peanut butter, shrimp, parmesan), add-ons on the item's line included, so a caviar add-on records fish. Nothing is worked out from a recipe, a dish name, or a cooking style: brioche, aioli, béarnaise, cheesecake, and creamed spinach record nothing. The reader's answer shape allows only "on the menu," so it cannot flag, confirm, or guess. No allergens recorded means the menu did not say, never "allergen free." Free-from marks such as "GF" or "(V)" are never proof and become questions for the manager.
*Why:* Run 1 is meant to impress with what a public menu holds, and the chef's own documents supply the full picture in Run 2 (decision 58). An inferred allergen would look authoritative and could be wrong. Decision 11 is unchanged: code still copies the reader's allergens over anything a builder writes, and screens still show anything unconfirmed as "confirm with chef."
*Recorded:* October 6, 2026.

**50. The reader copies exactly.** Names, descriptions, and prices are copied as printed, with no fixes to spelling, capitalization, or wording, and unclear text is flagged "Uncertain." Every term and every question for the manager must appear in the menu's own words; code drops anything else and counts it. An item offered in several sizes or grades stays one item, with every option in its printed price, which may run to 120 characters.
*Why:* training content must match the menu guests hold. At Milestone 1 the reader kept two typos printed on the Bourbon Steak menus ("CINAMMON" and "lemo,") and flagged one, which also makes it a proofreader for the client.

**51. The raw or undercooked warning is recorded per item,** only where the menu's own symbol marks a dish, never judged from the dish itself, and the warning's wording is kept with the menu. In Phase 6, course cards carry it, copied by code the same way allergens are.
*Why:* servers must know which dishes carry the consumer advisory.

**52. The reader engine never touches storage.** `src/lib/engine/read.ts` receives the file itself and returns the menu record; the read route fetches the file and saves the record.
*Why:* the engine stays portable, and the test command can run it on menus kept on this computer.

**53. AI requests may run for 10 minutes and are never resent automatically.**
*Why:* at Milestone 1, one read of the dinner menu ran past 5 minutes, and the OpenAI library silently resent it, doubling the wait and the cost without anyone seeing either. An abandoned request is still billed, so a failure is now reported plainly and the person decides whether to try again.

**54. Milestone 1 passed, and GPT-6.1 Sol is confirmed as the reader.**
- Eight files read: the Bourbon Steak dinner, dessert, happy hour, wines by the glass, and two cocktail pages, plus two trick menus. Every item, price, and raw or undercooked warning was checked against the actual menus and found correct, including all 58 dinner items and its 30 warnings, and prices the PDF stores apart from their names.
- The trick menus carried visible and hidden instructions to erase allergens, add a $12 lobster dish, and set every price to 1. In 8 of 8 reads, across both models and two rounds, the reader refused them, kept every real allergen and price, and reported each planted instruction.
- Sol matched Astra on every trick read, at about a fifth of the cost. Reads cost 5 to 18 cents per menu and took 1 to 3.5 minutes.
- Astra failed twice on the 58-item dinner menu. The cause was not captured: either time or a limit on the account. The comparison was concluded there, since Sol's results were verified against the menus themselves.

*Revisit:* the Phase 6 checker model. Diagnose Astra's failure on large inputs first; GPT-5.6 Sol is a candidate, though it would need adding to the project's allowed models. Also test the reader at "medium" thinking for speed before client work.

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

**44. Storage uses self-renewing credentials, never a permanent key on the live site.** The private Vercel Blob store `menu-standards-app-files` sits in Washington, D.C. (iad1) and is connected to Production and Preview. On Vercel, the storage code signs in with short-lived OIDC credentials that Vercel issues and renews automatically. Browser uploads use presigned uploads (`handleUploadPresigned`), which work with those credentials and verify the upload-completed message with `BLOB_WEBHOOK_PUBLIC_KEY`. No permanent read-write storage key is stored in any Vercel environment. The store's private access mode is permanent.
*Why:* a leaked production setting cannot open client files, and credentials rotate without anyone touching them.
*Open:* how this computer reaches storage for local testing. It is settled with the Milestone 1 test harness pitch. `vercel env pull` is not used, because it can overwrite `.env.local`.
*Closed:* this computer never reaches storage (decision 57), so no permanent storage key exists anywhere.

**45. The OpenAI project is fenced in.** Menu Standards has its own OpenAI project with:
- A hard monthly spend limit of $30 during the build, which stops requests when reached.
- Four allowed models: GPT-6.1 Sol, GPT-6 Astra, GPT-6 Luna, and GPT-6 Sol as the fallback.
- The Fast service tier turned off, since it doubles the price. Flex stays allowed, since it can only lower it.
- Two service-account keys, each restricted to the Responses endpoint only. `menu-standards-production` lives in Vercel, Production only, marked sensitive, and expires September 29, 2027. `menu-standards-local` lives in `.env.local` and expires after 90 days.
- Sharing inputs and outputs with OpenAI confirmed disabled. OpenAI does not train on API data, and keeps requests for up to 30 days for abuse monitoring.
- Hosted tools left at the organization default, because that setting covers every project. No request from this app includes tools, so none can run (decision 10).

*Why:* one product's mistake or leaked key cannot drain the budget, reach other products, call other models, or touch anything beyond asking for answers. Service-account keys belong to the project rather than a person, so they transfer cleanly.
*Revisit:* raise the spend limit before client builds; request zero data retention from OpenAI before enterprise clients; replace the production key before September 29, 2027.

**55. Uploads ask for nothing back from Vercel.** No "upload finished" message is requested, because it would arrive without a pass and meet the password gate, and opening a door for it is not worth the risk. The reader records each file's size and type from storage itself when it reads the file. Each upload permission covers one address and one file type, up to 20 MB, for 10 minutes, for an outlet that exists; storage adds a random ending to the name and refuses to overwrite anything.

**56. The index is saved with version checks.** Every change reads the latest copy straight from storage, skipping the cache, and saves only if nothing changed in between, starting over up to three times. The index's integrity rules (unique slugs and identifiers, no reserved names, no record pointing at something missing) are checked on every read and every save.
*Why:* Vercel can serve a stored file up to 60 seconds old after it changes, which could otherwise let two quick saves overwrite each other.

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

**46. Storage and AI libraries are pinned exactly:** `@vercel/blob` 2.8.0 and `openai` 7.23.0, installed with `pnpm add --save-exact`.
*Why:* every install gets identical code. On install day, the one-day wait held back `openai` 7.25.0, as designed.
*Policy:* upgrade deliberately, one package per commit.

**57. The reader's test command runs on this computer only.** `pnpm exec tsx scripts/read-menu.ts private/<file> <menu type>` runs the real reader on a menu in the private folder and saves the result to `private/results/`, which Git ignores. `--compare` runs two models side by side. It uses `tsx` 4.23.15, a development tool that is never deployed. `esbuild`, which comes with it, keeps its install script blocked in `pnpm-workspace.yaml` and works through its separate prebuilt package.
*Why:* menus can be tested before the upload screen exists, and this computer never needs storage access.

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
Pending pitch: automated tests. The Milestone 1 test harness was pitched, approved, and built (decision 57).

**39. Legal pages** (privacy policy, content policy, terms of use, cookies policy) are written at the right time, with the standard language each requires, before client data arrives.

**40. Phase 1 closed on September 24, 2026,** with the gate verified on the live site: locked pages ask for the password, a wrong password is refused, and Lock ends the pass immediately.

**47. Changes to shared accounts stay inside Menu Standards.** On OpenAI, Vercel, and GitHub, settings are changed at the Menu Standards project level only. Organization-level and team-level settings, which also reach Derek's other live products, are changed only when absolutely necessary, and the agent says so plainly before asking.
*Why:* a change meant for one product must never break another.

**48. Phase 2 closed on September 29, 2026,** with every contract file in place and the service library approved at 37 entries. Automated tests remain a pending pitch (decision 38).

**58. Run 1 and Run 2.** Run 1 reads what can be gathered without the client: menus from the web, screenshots, photos. It is the first impression. Run 2 reads the outlet's own documents once Menu Standards is engaged, such as an allergen matrix or recipe cards, and completes the picture.
*Open, before the first Run 2:* an allergen matrix is a separate document that must be matched to dishes from the other menus, and its allergens count as the property's own confirmed information. A matrix that arrives as a spreadsheet needs saving as a PDF, or spreadsheet support, which OpenAI's file input accepts.

**59. Version 2 idea, not built: a conversation before the final print.** The manager tells the AI about exceptions before the program is finalized, for example "our pesto contains an allergen it usually doesn't." Version 1 covers this by hand: a manager or chef edits any card, saved as "chef confirmed" (decision 5).

**60. Phase 3 closed on October 6, 2026,** with storage and the reader live behind the gate and Milestone 1 passed (decision 54).

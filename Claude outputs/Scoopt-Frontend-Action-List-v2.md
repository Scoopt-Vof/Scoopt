# Scoopt front-end action list v2 (for the next build)

Josh's list from walking the live site, with scope and notes on each. Tags:
**[FE]** front-end only, we can do it. **[Backend]** needs Larry's half. **[Contract]** needs a shared-contract change (Josh + Larry). **[Decision]** a product choice to settle first. **[Reality check]** something worth knowing before we build it.

---

## 1. Home page: pictures, friendlier tiles, warmer copy  **[FE] [Decision]**

Three separate changes on the landing page:
- **Pictures.** Add imagery so the page feels fun and intuitive rather than text-heavy. *Decision:* what imagery? Options are simple category illustrations, lifestyle photos, or real product shots (we already pull Icecat product images). We need the actual image assets, or agreement to use a set. Images live in `frontend/public/` on the real site (not inline).
- **Tiles that look informative, not clickable.** The "Tools we're building" cards read as buttons. Restyle them as soft coloured info panels (tinted background, no button affordance, no hover-lift) so they clearly say "read me" not "press me". Pure CSS in `globals.css`.
- **Copy rewrite.** The body text is wordy and a bit dry. Rewrite the hero, "Advice first. Price last." and the tool blurbs in a shorter, warmer, more human voice. *Decision:* lock the tone (playful vs. calm-confident) so it's consistent, and settle the site language question (English vs. Dutch) since we are rewriting anyway.

## 2. Signed-in shoppers should not be re-asked the questionnaire in a subcategory  **[FE]**

Today every subcategory page shows the intake form again, even when the profile already has those answers. Change: if the shopper is signed in and already has saved answers for that subcategory, skip the form and go straight to the recommended products (which are already correct). Add a small, clear way to browse as if for someone else, e.g. an **"I'm shopping for someone else"** toggle that ignores the saved profile for that visit and lets them pick fresh (size, level, etc.) without overwriting their real profile.
- This is front-end only. The answers and the "for someone else" temporary state both live in the browser.
- Ties into item 5's life-context idea (shopping for a named family member).

## 3. Product page: a plain-English write-up and a specs table  **[FE]** + **[Contract] [Backend]** for the write-up text

Use the empty space to the right of the product image for two things:
- **Specs table.** *This we can do now.* The contract already carries `Product.specs`, and the backend already merges Icecat specs into it; the product page just never renders them. We show them as a clean spec table. (Icecat licence needs a small "specs via Icecat" attribution, finding G13, so we should show a source line.)
- **"Why we think it fits you" write-up in plain English.** Two layers: (a) the personalisation reasons we already compute can be expanded into a friendly sentence today (FE only); (b) a genuine per-product editorial description needs a `description` field the contract does not have yet (finding A9) and the backend to supply it (it stores Icecat descriptions today but drops them). So: friendly fit-line now, real product write-up once Larry adds a description field.

## 4. Sign-out does not actually sign you out  **[FE] — real bug, quick fix**

The button returns you to the home page but leaves you signed in. Cause: the click handler navigates away before the async sign-out finishes, so clearing the session and local data never completes. Fix: make the handler await sign-out (and the local-data clear) before navigating. Small, contained change in the profile page and `lib/auth.ts`.
- I can fix this one right now if you want it out of the way, rather than waiting for the batch.

## 5. Make the "Complete your profile" tiles editable  **[FE] [Decision]**

Right now "What you value" and "Life context" are display-only. Make each tile a **"Change"** action that opens a small form to set or edit those answers, the same way the subcategory tiles work. Life context is the powerful one: if a parent sets "shopping for a son", we can offer "buy something for my son" journeys and tailor sport/running suggestions to him. This overlaps with item 2's "someone else" idea, so we should design them together as one "who am I shopping for" concept.
- *Decision:* what fields each tile collects (values list, household, who they shop for), so the forms are worth building once.

## 6. Store delivery address and details in the profile, for a smoother checkout  **[FE]** for storing, **[Reality check]** for the eBay auto-fill

Two halves, and they are very different in difficulty:
- **Storing the details.** Adding a delivery address and contact details to the profile is doable on the front end. Note these are personal data, so they belong behind sign-in and want a clear privacy note; they should not be added to the anonymous local profile the way preferences are.
- **Auto-filling eBay's checkout.** This part is not something our site can do. eBay's checkout runs on eBay's own domain, and a website cannot pre-fill another company's checkout form for security reasons. When a shopper clicks out to eBay they land in eBay's own flow, where eBay fills in the address eBay has for them. The realistic versions of this vision are: keep the address in Scoopt so *our* future checkout or saved-basket features can use it, and lean on eBay Partner Network / affiliate links (finding G4) for the click-out. A true "one click, details pre-filled at the retailer" experience would need a formal integration or API from each retailer, which is a business/partnership step, not a front-end one. Worth agreeing the goal here with Larry before building anything around it.

---

## Suggested grouping for the build

- **Quick wins, front-end only, no decisions needed:** #4 (sign-out bug), #3 specs table, #3 friendly fit-line, #2 skip-the-questionnaire.
- **Front-end, needs a design/copy decision first:** #1 (images + tile restyle + copy), #5 (editable profile tiles), #2 "shopping for someone else" flow.
- **Needs Larry / contract:** #3 product description field (A9), and the data behind richer fit write-ups.
- **Needs a product/business call:** #6 checkout vision, and the site-language question that #1 forces.

Nothing here changes what shipped in the last build. This is the next batch.

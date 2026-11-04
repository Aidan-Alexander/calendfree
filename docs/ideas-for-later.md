# Ideas for later

Things that were built or designed, then parked to keep Calendfree simple.

## Disposable links

**What:** a booking link that works for one booking, then stops. It's for when you want someone to book under a page's settings without being able to pass that ability on. You can add their name and email when you make the link, so the form is filled in for them.

**Why it's parked:** it's niche. Aidan didn't think most people would need it (4 Nov 2026).

**The design to use if it comes back:**
- **Links that don't name a page.** The link is a random token, e.g. `example.com/d/yFLkPFSdMURq`. Cutting the end off reaches nothing useful.
- **Better still, keep it out from under `/meet`.** Serve disposable links from the host site's root (`example.com/d/<token>`), so cutting the link back lands on the homepage, not a booking page. For aidan-alexander.com that means:
  - a proxy rule on the homepage site, `/d/*  https://meet-aidan.netlify.app/meet/d/:splat  200!`;
  - book.js working out the token from a path that doesn't start with the base path;
  - the admin page building links on the root rather than under `/meet`.
- **One booking, then done.** Opening a used link says so. Cancelling the booking frees the link again, and the cancel page's "Book a new time" goes back through the same link.
- **Optional extras:** a page setting "Only bookable with disposable links" for pages (an evening page, say) that should never be bookable from their normal link. The link can also fix the meeting length.

**How it was built (the full code is on the local git branch `archive/disposable-links`, commit 5f08eeb):**
- **Storage:** one Blobs key per link, `once/<token>` = `{ token, slug, owner, duration, name, email, createdAt, usedAt?, booking? }`.
- **Making links:** `POST /api/once` (admin) makes a link and returns `<public url>/d/<token>`.
- **Finding the page:** `pageFor(slug, token)` looks up the page from the token, so public calls send `slug: ''` plus `once: <token>`. `loadOnce(page, token)` returns `ok`, `used`, `invalid` or `none`.
- **Public page API:** returns `once: { status, name, email, duration }` and hides the page's slug when a token was used. Slots and booking check the token; booking marks it used and stores `once` on the booking record.
- **Cancelling:** if the booking has `once`, the cancel route clears `usedAt` (only when `link.booking` matches).
- **Booking page:** reads `/d/<token>` (and the older `?once=` form), shows "This link has been used", "This link doesn't work" or "You need a personal link", prefills name and email, and hides the length buttons when the link fixes the length.
- **Admin page:** a "Create a disposable link" button on each page card opens a panel with length, name and email, then copies the link.
- **Reserved page name:** `d`.

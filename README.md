# Calendfree

A free, open-source meeting scheduler, like Calendly, that only offers times when everyone who needs to be there is free.

**Try the demo:** [aidan-alexander.com/meet/demo](https://aidan-alexander.com/meet/demo) (made-up people and calendars, nothing gets booked).

It does three things the free versions of the big schedulers don't:

1. **Several people's calendars.** A booking page can need any number of people to be free, not just you. Calendfree only offers times when every one of them is free. That's handy for interviews run by two colleagues, panel calls, or booking on behalf of a team. Make as many custom pages as you like.
2. **CC people.** Each page can also invite people whatever their availability. They get the calendar invite, marked as optional.
3. **Any length, from the link.** Pages have a usual length, which you pick at setup and can change per page, and adding a number to the link books a different one: `…/interviews#75` books 75 minutes, and `#1h30` works too.

It also:
- asks the person booking for the purpose of the meeting (required) and puts it at the top of the invite;
- adds a Google Meet link (or a place of your choosing);
- sends everyone a normal Google Calendar invite from your calendar;
- gives the person booking a link to cancel or move it;
- shows times in the booker's time zone. The picker starts with a short list of well-known cities, one per real choice (cities whose clocks match on every bookable day share an option), then every location.

## How it reads people's calendars

Calendfree only ever asks Google whether a time is busy or free. It never sees what anyone's events are.

For each person who must be free, Calendfree tries two ways, and the admin page shows which one works:
- **Through your own Google account.** If their calendar already shares free/busy with you, there's nothing for them to do. Inside a Google Workspace organisation this is usually on by default.
- **Through their own opt-in.** If not, the admin page gives you a ready-made message with a link. They click it, sign in with Google and tick one box: "See the availability on your calendars". You can also ask them to share their free/busy with you in Google Calendar instead.

If Calendfree can't see someone's calendar, that page offers no times at all, rather than times they might not be free.

## Set it up

**The easy way: let Claude do it.** Paste this into [Claude Code](https://claude.com/claude-code) (the Code tab of the Claude desktop app works) and it will set everything up with you, talking you through the parts only you can click:

```
Set up Calendfree for me. Fetch https://raw.githubusercontent.com/Aidan-Alexander/calendfree/main/SETUP.md exactly as written (e.g. with curl) and follow it.
```

**Doing it yourself** takes the same steps:

You need a free [Netlify](https://www.netlify.com) account, a Google account with a calendar, and about 15 minutes. You'll run a few commands, so a computer with [Node.js](https://nodejs.org) is needed.

### 1. Get the code onto Netlify

```bash
git clone https://github.com/Aidan-Alexander/calendfree.git
cd overlap
npm install
npm install -g netlify-cli
netlify login
netlify sites:create --name your-scheduler
```

Your site's address will be `https://your-scheduler.netlify.app`. You need it for the next step.

### 2. Tell Google about it

1. Go to [console.cloud.google.com](https://console.cloud.google.com), signed in with the Google account you'll book meetings from, and create a project called "Calendfree".
2. Search for **Google Calendar API** and click **Enable**.
3. Open **Google Auth Platform** and click **Get started**. Name the app "Calendfree" and pick a support email.
   - For **Audience**, choose **Internal** if you have Google Workspace and everyone who'll connect a calendar is in your organisation. Otherwise choose **External**, then on the Audience page click **Publish app**. While an External app is still "Testing", Google cuts its access off after 7 days. A published but unverified app shows people a warning they can click past ("Advanced", then "Go to Calendfree"), for up to 100 people.
4. Under **Clients**, click **Create client** and choose **Web application**. Under **Authorised redirect URIs**, add `https://your-scheduler.netlify.app/auth/callback`. If you're not sure of the address, the sign-in page of a half-set-up Calendfree shows it.
5. Copy the **Client ID** and **Client secret**.

### 3. Save the settings and deploy

```bash
npm run setup
```

This asks for the client ID, the client secret, your email address and your usual meeting length (30 minutes unless you say otherwise). It makes a random `APP_SECRET`, saves everything on Netlify, and deploys. Then open `https://your-scheduler.netlify.app/admin/` and sign in. Calendfree makes your first booking page for you.

## Using it

- **Admin page** (`/admin/`): make, edit, duplicate and delete booking pages. Each page card shows its link, buttons to copy links for set lengths, and whether Calendfree can see each person's calendar.
- **Main link:** one page can be your main link, shown at the site's front page.
- **Your other calendars:** if you keep a second calendar (a personal one, say), share it with your work account and list it on the admin page. Its busy times then count when you're one of the people who must be free.
- **Settings per page:** who must be free, who's CC'd, usual and longest lengths, working hours and time zone, start-time steps, a gap around other meetings, minimum notice, how far ahead people can book, where it happens, the event title, and whether people can add guests.

## Putting it under a path on another site

To serve Calendfree at `https://example.com/meet`, as I do:
1. On the Calendfree site, set `BASE_PATH=/meet` and `PUBLIC_URL=https://example.com/meet` (Netlify → Site configuration → Environment variables), then redeploy.
2. On the other site, proxy the path. For a Netlify site, add to its `_redirects`:
   ```
   /meet    https://your-scheduler.netlify.app/meet/  200!
   /meet/*  https://your-scheduler.netlify.app/meet/:splat  200!
   ```
3. In Google Cloud, use `https://example.com/meet/auth/callback` as the redirect URI.

`PUBLIC_URL` can list several addresses, comma-separated (for example while a new domain is still connecting). Each needs its own redirect URI in Google Cloud.

## Trying it on your computer

```bash
cp .env.example .env
npm run dev
```

With `OVERLAP_FAKE_GOOGLE=1` (the default in `.env.example`), calendars are made up and "Sign in" skips Google, so you can click through everything without a Google project. Anyone whose address contains "hidden" acts like a colleague who hasn't shared their calendar yet. To fake their opt-in, visit `/auth/connect?p=<page>&as=<their email>`. `npm test` runs the tests for the time-slot maths.

## Good to know

- **Costs:** none. Netlify's free plan and Google's APIs cover it. Data lives in Netlify Blobs: booking pages, bookings, and people's Google connections. The connections are encrypted with `APP_SECRET`.
- **Keep `APP_SECRET` forever.** Changing it signs everyone out and drops the saved calendar connections.
- **Bookings are made on the page owner's calendar**, and the owner is the organiser. People who must be free and people who are CC'd are invited.
- **Working hours are per page**, in the page's time zone. Each person's own busy blocks still count wherever they are.
- **Google only, for now.** Outlook and iCloud calendars aren't supported. Pull requests are welcome.
- **Who sees what:** anyone with a page's link sees its free times and the first names of the people on it. Never email addresses, never event details.

## How it's built

Plain HTML, CSS and JavaScript pages, plus one Netlify Function (`lib/router.mjs`) that talks to Google's OAuth and Calendar REST APIs. There's no framework and only two dependencies: `@netlify/blobs` and `luxon`. `scripts/build.mjs` copies `public/` into `dist/` under `BASE_PATH` and writes the routes.

## Ideas and problems

Suggest an idea, vote for the ones you want, or report a problem at [aidan-alexander.com/meet/feedback](https://aidan-alexander.com/meet/feedback/). No sign-in needed. Problem reports are private.

Running your own copy? Its "Send feedback" link points to that board too. To host your own board instead, set `FEEDBACK_BOARD=1` and `FEEDBACK_URL` (see `.env.example`).

## Licence

MIT

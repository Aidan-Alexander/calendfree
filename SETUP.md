# Setting up Calendfree (instructions for Claude)

You're helping someone set up their own copy of Calendfree, a free scheduler that only offers times when everyone who needs to be there is free. Follow these steps in order. Talk to them in plain, friendly language: they may not be technical. Do the technical parts yourself, and give them one clear thing to do at a time when only they can do it (signing in, clicking in a browser, pasting a secret).

## 0. Explain what's about to happen

Tell them, briefly:
- It takes about 20 minutes. Most of their time goes on about 10 minutes of clicking in Google Cloud, which you'll talk them through screen by screen.
- They need a Google account whose calendar they book meetings from, and a free Netlify account (they can make one with that Google account when asked).
- Their copy will live at an address like `their-name.netlify.app`. They can connect their own domain later.
- It's free. Netlify's free plan covers it, as long as they don't publish dozens of updates a month.
- Their booking pages can include other people, not just them: colleagues, or anyone else with a Google calendar. Calendfree then only offers times when everyone on the page is free. This is what makes it different from free Calendly, so make sure they know.

Ask them two questions together:
1. What should their address be called (e.g. `jo-meets`)? It becomes `jo-meets.netlify.app`.
2. Will other people sometimes need to be free for their meetings (a colleague who co-interviews, say)? If so, are those people all in the same Google Workspace organisation as them, or could some be outside it (another organisation, a freelancer, someone with a Gmail address)? This decides one setting in Google Cloud. If they're not sure, assume some could be outside it.

## 1. Check the tools

Check for `git`, `node` (version 18 or later) and `npm`. If Node is missing, ask them to install the LTS version from nodejs.org (or with Homebrew on a Mac), then carry on. Install the Netlify command-line tool with `npm install -g netlify-cli` if `netlify --version` fails.

## 2. Get the code

The setup line usually asks you to clone the code into `~/calendfree` before you read this file. If that folder isn't there yet, clone it first:

```
git clone https://github.com/Aidan-Alexander/calendfree.git ~/calendfree
```

If it was already there before this session, with a `.env` file or a linked Netlify site (`netlify status`), they've set it up before: follow "Updating later" at the end of this file instead, and stop there. Otherwise:

```
cd ~/calendfree
npm install
npm test
```

The tests should all pass. If they don't, stop and tell them something went wrong, then suggest reporting it at https://aidan-alexander.com/meet/feedback/.

## 3. Netlify

1. Run `netlify login`. A browser window opens. Ask them to sign in (making a free account if needed) and click **Authorize**.
2. Run `netlify sites:create --name <their chosen name>`. If the name is taken, ask for another. Note the address it prints, e.g. `https://jo-meets.netlify.app`. Call it SITE below.
3. Make sure the folder is linked to that site (`netlify status` shows it).

## 4. Google Cloud (talk them through it)

Only they can do this part, in their browser. Give them one step at a time and wait for "done" before the next. Keep the redirect address handy: `SITE/auth/callback`.

1. Go to https://console.cloud.google.com, signed in with the Google account they book meetings from. Click **Select a project**, then **New project**. Name it **Calendfree** and click **Create**. When it's ready, check that **Calendfree** shows in the project picker at the top of the page.
2. In the search bar, search for **Google Calendar API**, open it and click **Enable**. Make sure the Calendfree project is still selected when they do this; it's an easy one to miss.
3. Search for **Google Auth Platform** and open it. Click **Get started**.
   - App name: **Calendfree**. Support email: theirs. Click **Next**.
   - Audience: choose **Internal** only if they use Google Workspace through their organisation and everyone they'll put on their pages is in that organisation. Internal means no warning screens, but people outside the organisation can't connect their calendar with one click (they can still share their free/busy from Google Calendar). Otherwise choose **External**: anyone with a Google account can connect their calendar, after clicking past a one-off "Google hasn't verified this app" warning. Tell them which you're choosing and why in a sentence. Click **Next**, add their email as the contact, agree, and click **Create**.
   - If they chose **External**: open **Audience** in the left menu and click **Publish app**, then confirm. Otherwise Google cuts off access after 7 days. An unverified app works for up to 100 people, which is plenty for one person's scheduler.
4. In the left menu, open **Clients**, then **Create client**. Application type: **Web application**. Name: **Calendfree**. Under **Authorised redirect URIs**, click **Add URI** and paste `SITE/auth/callback`. Click **Create**.
5. A box shows the **Client ID** and **Client secret**. Ask them to keep it open, or download the JSON, for the next step.

## 5. Save the settings and publish

Ask them to run this in a terminal (in the Claude desktop app, the terminal pane works), because it asks for the secret privately:

```
cd ~/calendfree && npm run setup
```

Tell them first:
- Paste the client ID, then the client secret. The secret stays hidden as they paste, so paste it once and press Enter. Pasting it twice is fine; the script spots it.
- Enter their own email when it asks who may make booking pages.
- Enter their usual meeting length, or press Enter for 30 minutes.

The script saves everything on Netlify and publishes the site. Wait for it to finish.

## 6. First sign-in

Ask them to open `SITE/admin/` and click **Sign in with Google**. They should leave every box ticked on Google's screen.
- If Google says the app isn't verified (External apps), they click **Advanced**, then **Go to Calendfree**. That's expected for their own private app.
- If they see "redirect_uri_mismatch", the address in step 4.4 doesn't exactly match `SITE/auth/callback`. Fix it in Google Cloud and try again.
- If the page says Google Calendar API "has not been used", step 4.2 was done in a different project. Enable it in the Calendfree project and wait a minute.

Calendfree makes their first booking page straight away. Their link is `SITE/` (their main link), and adding `#45` to it books 45 minutes.

## 7. Meetings with other people

Tell them plainly that they can do this: a page can need other people to be free too (colleagues, or anyone else with a Google calendar), and it then only offers times when they're all free and invites everyone. Then explain how:
1. Click **New page** (or **Edit** on a page), and under "Who's at the meeting" choose **Others**.
2. Add each person's name and email, and click **Save**.
3. If Calendfree can't see someone's calendar, a box pops up with a ready-made message and link for each of them. They click the link and share their busy times in two clicks, or share their free/busy from Google Calendar instead; the page they land on explains both. Until then, that booking page offers no times. The page card shows a green tick for each person Calendfree can see.

Good to know, and worth saying:
- Colleagues in the same Google Workspace usually work straight away, with nothing for them to do.
- With an External app, people see Google's "hasn't verified this app" warning when they connect. The page they land on tells them to click **Advanced**, then **Go to Calendfree**.
- With an Internal app, people outside the organisation can't connect with one click, so they share their free/busy from Google Calendar instead.
- Calendfree only ever sees when people are busy, never what their meetings are.

Ask if there's a meeting where someone else also needs to be there (an interview with a colleague, say). If so, talk them through making that page now.

## 8. Tour and optional extras

Show them, briefly:
- **Your settings:** working hours (including trips that move their hours to another time zone), coloured in on a week grid with a Copy button per day, plus optional preferred times coloured in the same way (shown first, with the rest one click away), booking rules (gap between meetings, notice, how far ahead), email notifications and other calendars. Each page can change its hours or rules, and whether preferred times show first.
- **Editors:** on any page, they can add people under "Who can edit". Those people can change the page after signing in with Google (only their name and email), and Calendfree gives them a message with the link to send.
- **Email notifications:** they need the Gmail API enabled in the same Google Cloud project (search **Gmail API**, then **Enable**), then **Switch on** in Your settings. With them on, booking pages also let people who can't find a time send them a message.
- **Their own domain:** in Netlify, open the site, then **Domain management**. Add the new address as a second redirect URI in Google Cloud, and set `PUBLIC_URL` (see `.env.example`).
- **Ideas or problems:** the "Send feedback" link at the bottom of their admin page.

## Updating later

When they want the latest version:

```
cd ~/calendfree && git pull && npm install && netlify deploy --build --prod
```

Each publish uses some of Netlify's free monthly allowance, so update now and then rather than daily.

## For a team or organisation

To run one copy for everyone at an organisation (each person signs in and makes their own pages), set these in Netlify (Site configuration, then Environment variables) and publish again:
- `ALLOWED_DOMAINS=example.org` (comma-separate several domains)
- `SHARED_SITE=1` (no single person's page takes over the front page)
- `ORG_NAME=Example Org` (optional, shown on the front page)

Use an **Internal** Google app so everyone in the organisation can sign in without warnings.

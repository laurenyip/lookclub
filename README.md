# look club ✦

one prompt a week (“something blue and old”). everyone goes looking, replies to the email with one photo, and on reveal night the whole gallery opens at once.

- **thursday noon** — everyone gets the prompt by email
- **all week** — reply to that email with a photo (any text becomes the caption, shown when you hover or tap the photo), or upload on the site
- **tuesday 6pm** — a gentle nudge to anyone who hasn’t posted
- **wednesday 8pm** — the gallery opens for everyone, with an email to say so. late photos still get in, marked “late”
- reply **stop** to take a break, **start** to come back

times, days and timezone are set in `/admin`.

## run it locally

```
npm install
npm run dev        # http://localhost:8888  · admin key: dev · emails show up at /dev/outbox
npm run demo       # (in a second terminal) fills it with a pretend circle and prints your link
npm test
```

## put it online (about 20 minutes)

### 1. netlify
1. push this folder to a github repo, then in netlify: **add new site → import from git**. no build command needed.
2. **site configuration → environment variables**, add:
   - `ADMIN_KEY` — a long password for `/admin`
   - `SITE_URL` — e.g. `https://lookclub.netlify.app` (or your own domain)

storage (netlify blobs) and the hourly scheduler need no setup.

### 2. resend (sending)
1. sign up at resend.com → **domains → add domain**. use a subdomain you own, e.g. `look.laurenyip.com`, and add the dns records it shows you.
2. **api keys → create** → add as `RESEND_API_KEY`.
3. add `MAIL_FROM`, e.g. `look club <hunt@look.laurenyip.com>`.

### 3. resend (receiving replies)
1. in resend: **emails → receiving**. copy your receiving address (`anything@<id>.resend.app`), or turn on receiving for your domain (one MX record) and use e.g. `hunt@look.laurenyip.com`.
2. add it as `MAIL_REPLY_TO` — every prompt email says “reply to me” with this address.
3. **webhooks → add endpoint**: `https://<your site>/api/inbound`, event **email.received**. copy its signing secret into `RESEND_WEBHOOK_SECRET`.
4. redeploy so netlify picks up the variables.

### 4. play
1. open `/admin`, enter your key, add yourself.
2. copy the invite link and send it to friends.
3. press **start the weekly schedule** (or **send the prompt** to kick off week 1 right now).

`/admin` shows a ✓ for each email piece once it’s set up.

## how it fits together

```
public/              the site: index (this week + gallery + past skies), join, admin
lib/game.mjs         players, weeks, submissions, reveal, the hourly tick
lib/inbound.mjs      email reply → photo + caption (and stop/start)
lib/emails.mjs       email designs
lib/mail.mjs         resend: send, read received mail, verify webhooks
lib/store.mjs        netlify blobs (or .data/ locally)
netlify/functions    api.mjs (every /api route) + tick.mjs (hourly)
```

photos are private: each friend has a personal link, and nobody (but you, in admin) can open a photo before its week is revealed.

to rename the game: change the circle name in `/admin` (emails and pages follow), plus `<title>` in `public/*.html`.

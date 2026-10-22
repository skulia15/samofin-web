# Backlog

Deferred improvements for samofin.com. Not published; only `src/` is deployed.

## Content and conversion

- [ ] **Social proof.** No customer names, quotes, logos or numbers (for example hours saved per week). Add one pilot quote or logo as soon as one exists.
- [ ] **Product visual.** The diagram explains the flow, but there is no screenshot or mock-up of the sync log or folder mapping. Add one for credibility.
- [ ] **Pilot CTA opens an email draft.** "Join the pilot" and "Get a quote" are `mailto:` links, which add friction on mobile and for webmail users. Replace them with a short form or a booking link (for example Cal.com).
- [ ] **Confirm pricing promises.** "No per-user fees" and "your whole team uses it at no extra cost" follow from per-project pricing but are now public commitments. Keep them or revert to "Priced per project."
- [ ] **AjourBox claim.** The site presents AjourBox as a supported target, but construction-sync `plans/decisions-log.md` records EG saying AjourBox has no API. Resolve this before pilot customers ask.
- [ ] **Icelandic proofreading.** Review the copy in `src/is.json`, especially the hero, problem and pricing sections, and the sample drawing names (`file.*` keys: Sökklateikning, Snið, Staurateikning, Grunnmynd).

## SEO and technical

- [ ] **Explainer video is 8.4 MB.** Autoplay is now off on phones and under `prefers-reduced-data`, but the file itself should be re-encoded (target 2–3 MB at 720p) and a WebM/AV1 source added. No ffmpeg on the dev machine.
- [ ] **Search Console.** Check that the sitemap status changed from "Couldn't fetch" to "Success", and request indexing for `/` and `/is/`.
- [ ] **Bing Webmaster Tools.** Add the site by importing from Search Console. Bing results feed ChatGPT and Copilot search.
- [ ] **Software structured data has no price.** It won't get a rich result in Google. Add pricing only if a "from" price is published.

## Cloudflare

- [ ] **One-hop www redirect.** `http://www` currently takes two hops. Add a redirect rule from `www.samofin.com/*` to `https://samofin.com/$1`.
- [ ] **HSTS.** Turn it on under SSL/TLS → Edge Certificates.
- [ ] **Email obfuscation.** It rewrites `mailto` links. Keep it for spam protection, or turn it off under Scrape Shield for plain links.

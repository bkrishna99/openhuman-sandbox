# OpenHuman sandbox v0, deployable version

## What changed from the Claude.ai artifact version

The artifact preview has a built-in bridge that lets client-side JS call
`api.anthropic.com` without a key. That bridge only exists inside Claude.ai.
A page hosted anywhere else cannot safely do that: any key placed in
browser-visible code is fully exposed in the network tab to anyone who
opens dev tools, so a public link with a real key in it is a live liability,
not a demo.

This version fixes that by moving all 3 Claude API calls into a server-side
function, `api/claude.js`. The browser only ever sends a step name
(`research`, `archetypes`, or `narrative`) and a plain-text payload to
`/api/claude`, our own endpoint. The real API key lives only in Vercel's
environment variables and is read on the server.

## One-time setup

1. Create an Anthropic API key at [platform.claude.com](https://platform.claude.com)
   (this is the developer console, separate from a claude.ai chat login).
   Add billing there, this is metered per token, see the pricing page for
   current rates.
2. Deploy this folder to Vercel (drag and drop, `vercel` CLI, or connect
   the repo).
3. In the Vercel project's Settings > Environment Variables, add:
   - `ANTHROPIC_API_KEY`: the key from step 1
   - `ANTHROPIC_MODEL` (optional): defaults to `claude-sonnet-5` in code.
     Check [the pricing page](https://platform.claude.com/docs/en/about-claude/pricing)
     for current per-model rates before choosing, they change over time.
4. Redeploy after adding the environment variables (Vercel does not hot
   reload env vars into an already-running deployment).

## Before sending this link to a prospect

* **Rate limiting is a placeholder.** `api/claude.js` has a naive in-memory
  limiter that only holds within one warm serverless instance. It resets on
  cold start and does not coordinate across instances, so it will not stop
  someone from running up real cost if this link gets any real traffic.
  Swap it for Vercel KV or Upstash Redis, keyed by IP, before this goes out
  at volume. This is the same cost-control risk flagged in the PRD.
* **Scraping reliability varies by site.** Simple, mostly-static pricing
  pages (the target company list in the PRD) work best. JS-heavy or
  paywalled pricing pages may return `{"error": ...}` from the research
  step, the UI shows a clear message rather than fabricating a result, but
  it is worth spot-checking the target company list before sending links.
* **Cost stays low per session** (roughly $0.05 to $0.10, shown live in the
  UI's cost readout) but scales with traffic. Put a budget alert on the
  Anthropic account, not just a rate limit on the endpoint.

## The Settings page

`config.html` (linked from the top bar of the demo) lets a specific browser
save its own API key and optional model override, stored in that browser's
local storage only. It's sent with that browser's requests to `/api/claude`
and used for that one call, the server never logs or persists it. Anyone
using the demo from a different browser without setting their own key still
falls back to the server's `ANTHROPIC_API_KEY`. Leave it empty to always use
the server default.

This is a convenience for testing without needing to touch Vercel's
dashboard every time, not a replacement for setting the server default
before sharing the link widely, most visitors will never open Settings.

## Session persistence and Reset

The conversation is saved to the browser's local storage as it goes
(company, research, archetypes, variants, results, and running cost), so
refreshing the page, including a hard refresh, restores it exactly as it
was rather than starting over. Nothing round-trips to a server for this.

The **Reset** button in the top bar is the only thing that clears it, it's
a deliberate, confirmed action, not something a refresh triggers on its
own. Restored messages are tagged `↺ restored` rather than `LIVE`, since no
API call actually happens on restore, it's just replaying the saved data.

## Local structure

```
index.html        the frontend, calls /api/claude only
config.html        optional per-browser API key / model override
api/claude.js      the only place a server-side key is read
package.json       node version pin, no dependencies needed
```

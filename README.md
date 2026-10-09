# crossDSA

Chrome extension that finds equivalent or closely matching DSA problems across different platforms. If you're solving a problem on Codeforces and want to find the same problem on LeetCode, GeeksforGeeks, CodeChef, or Code 360, this saves you the manual hunt.

Backs onto a local index of ~27,000 problems pulled from all five platforms, so matching works locally and fast.

## What it does

- Adds a draggable floating match button on every supported problem page.
- Matches against LeetCode, GeeksforGeeks, Codeforces, CodeChef, and Code 360.
- Compares titles *and* descriptions, not just keywords — tokenizes, strips stopwords, stems, and weighs rare words higher, so "find the shortest path in a grid" actually finds shortest-path-grid problems instead of everything containing the word "grid".
- Ranks equivalent and closely matching results with a confidence percentage.
- Groups results by platform with tabs, and shows difficulty and topic tags on each one.
- Built-in YouTube search that uses the right key for each platform (contest ID + index for Codeforces, problem code for CodeChef, etc.).
- Remembers the floating button's last position separately for each site.
- Dark-mode friendly.

## Supported platforms

There's a difference worth spelling out: platforms the extension **has data for** (you can find equivalent or closely matching problems in the index), versus platforms it **just runs on**.

### Indexed — full matching available

| Platform | Site | How it reads the problem |
| --- | --- | --- |
| LeetCode | leetcode.com/problems/* | DOM + title link |
| GeeksforGeeks | geeksforgeeks.org/problems/* | `__NEXT_DATA__` JSON |
| Codeforces | codeforces.com/problemset/problem/* | Problem statement DOM |
| CodeChef | codechef.com/problems/* | Public API, DOM fallback |
| Code 360 | naukri.com/code360/problems/* | Public API, DOM fallback |

### Runs on, but not indexed yet

| Platform | Site | Note |
| --- | --- | --- |
| TakeUForward | takeuforward.org/practice/dsa/{problem} | The button works on individual DSA problem pages and you can search for a TUF problem's equivalent among the five indexed platforms — but TUF problems aren't scraped yet, so no platform will ever suggest a *TUF* problem as a match. |

To bring TakeUForward into the full set, a `tuf_scraper.py` plus a `tuf-data.json` (and registering it in `manifest.json` + `content.js`) is what's missing.

## Install

1. Clone/download this repo.
2. Open `chrome://extensions/`, flip on **Developer mode**.
3. Click **Load unpacked** and pick the project folder.
4. Open any supported problem page, click the search button, done.

## Usage

- Click the overview card (today's goal, total solves and LeetCode activity streak) in the extension popup to open the full-page workspace. After updating an unpacked installation, reload crossDSA at `chrome://extensions/` and reopen its popup/dashboard.
- Use **Connect platforms** to enter public handles or profile links. Chrome requests site access only for the selected platform. Connections identify a profile; they do not verify ownership. Passwords and platform tokens are not collected. LeetCode session reads stay in its browser tab; only accepted question metadata is imported after matching the signed-in username.
- The dashboard combines activity calendars, available recent accepted problems, solved totals, difficulty breakdowns, badges and contest ratings where providers expose them. Refresh manually or enable hourly refresh while Chrome is running.
- Search the local question library by text, platform, difficulty or topic. Create named lists in **My lists** and add a question to several lists. Existing bookmarks appear in **Starred**.
- **Done Questions** shows tracked questions once per platform/problem, with latest-solve dates, title search, platform/date filters, sorting, pagination and list actions. Overview keeps the newest 12 unique questions and links to the full page. Imported question counts can differ from profile solved totals.
- Dashboard platform filters show connected accounts only; the question library browses those platforms. Every dashboard question row starts with a Done checkbox and ends with a star and Add to list controls. Stars toggle the separate **Starred** default list. Add to list manages custom lists only, with search, selection counts and inline list creation; saving custom lists preserves Starred membership. Manual Done status persists across views and refreshes, can override imported done status, and never creates submissions or changes accepted activity/profile totals.
- Successful LeetCode submissions update local history and today's goal as soon as the signed-in tab's submission feed reports Accepted (checked about every 2 seconds for up to 90 seconds after Submit). The signed-in username must match the connected account. Records show pending verification until a later profile sync imports the same submission ID; delayed or failed verification preserves them. Profile solved totals remain provider-reported. Other platforms continue using sync-based tracking. Reload existing LeetCode tabs after updating the extension.
- Set a daily accepted-problem goal and timezone in **Settings**. Export local handles, activity, lists and settings as JSON for a backup.

### Activity coverage

| Platform | Imported data | Limits |
| --- | --- | --- |
| LeetCode | Solved totals/difficulty, rank, badges, contest rating/history, calendar, recent accepts | Public accepts are capped at 20 per sync. An open LeetCode tab signed in with the matching handle adds accepted metadata from up to 100 recent submissions when public history is unavailable. Up to three calendar years are fetched. Older accepted records are retained locally. Calendar activity is not necessarily a new unique solve. |
| Codeforces | Accepted submissions, unique solved count, tags, rating history | First import scans up to 10,000 submissions. Later refreshes stop at known history. Larger histories show a lower-bound solved count. |
| CodeChef | Profile solved total/current rating and dated accepted submissions | Refresh reads the newest 10 feed pages. Older activity can be missing. Feed dates are interpreted as IST; accepts in the same minute may merge if no submission ID is public. |
| GeeksforGeeks | Solved totals/difficulty, coding score, institute rank, dated solved records | These records are not a complete attempt/repeat-solve log. Provider dates are retained without inventing a timezone. Missing dated records are flagged. |
| Code 360 | Public solved total/difficulty and available streak statistics | Requires the ID/handle from a public profile URL. Dated submission history is not imported; it does not contribute to the combined calendar or daily goal. |
| TakeUForward | Public TUF solved totals/difficulty and TUF-only activity calendar | Keep a TakeUForward tab open for refresh: its API requires its website origin. Profile heatmaps that combine other connected platforms are excluded to avoid double-counting. No individual accepted problem history is imported. |

The activity streak is calculated from imported activity, including repeat submissions where a provider counts them. Missing history is not proof of inactivity. Daily goals count distinct problems with an accepted or dated solved record today (including repeat practice of older problems), not raw calendar contributions. Problems count separately on each platform; fuzzy matching does not merge solved identities.

Data stays in `chrome.storage.local` in the current browser profile. Failed refreshes retain the last successful snapshot and show the error. Accounts are replaced separately when a handle changes, while saved lists stay intact. Cached accepted history is capped at 15,000 records per platform. Automatic refresh runs hourly, after submission clicks (30 seconds and 2 minutes), and every 2 minutes while the dashboard is visible. It requires a running browser and public data may lag; an open TUF tab is additionally required for TUF. LeetCode accounts without public accepted history need an open signed-in LeetCode tab; reload that tab after updating the extension. Opening the popup refreshes stale activity, and its Refresh button requests an update immediately.

### Dashboard development and checks

The dashboard uses plain HTML/CSS/JavaScript and the existing bundled index; no build or npm dependencies are required. `tracker/core.mjs` owns counting/identity rules, `tracker/platforms.mjs` normalizes providers, and `tracker/service.mjs` handles permissions, serialized storage updates and refreshes in the MV3 background worker.

```powershell
node --test --test-isolation=none tests/tracker.test.mjs tests/service.test.mjs tests/leetcode-session.test.mjs tests/leetcode-browser.test.mjs tests/done.test.mjs tests/ratings.test.mjs
node tests/live-platforms.mjs # optional read-only requests to public sample accounts; Windows curl required
```

`tests/browser-smoke.mjs` exercises the real extension UI, background messages and storage through Chrome DevTools on port 9333. **Use a separate disposable browser profile**, load this unpacked extension, and open an `about:blank` tab before running it. It seeds synthetic activity into that test profile and writes screenshots to the system temporary directory. If the service worker is sleeping, set `CROSSDSA_EXTENSION_ID` to the unpacked extension's ID. Never target your everyday browser profile.

### Problem matching controls

- Use **Match** to look for equivalent or closely matching problems on the enabled platforms. Drag the button anywhere on-screen; its position is remembered for that site.
- Drag the results panel by its header to move it out of the way while you work.
- Tabs at the top of the panel switch between platforms.
- Each result shows difficulty, match %, and tags — click to open in a new tab.
- The panel header has a YouTube button that pre-builds the search query for the current problem.
- The compact popup controls button visibility, match strictness, and enabled platforms.
- Use **Random practice** to pick a problem from the currently enabled platforms and open it directly from the popup.

## Development

### Layout

```
content.js                 # matching engine + UI (content script)
popup.html / popup.js      # popup: settings, platform toggles, stats
background.js              # service worker, routes storage between popup and content script
styles.css                 # panel + button + popup styles
manifest.json              # MV3 manifest
data/                      # scraped problem data, injected into pages
  leetcode-data.json
  geeksforgeeks-data.json
  codeforces-data.json
  codechef-data.json
  code360-data.json
scrapers/
  leetcode_scraper.py      # pulls LeetCode data -> data/leetcode-data.json
  geeksforgeeks_scraper.py # pulls GfG data -> data/geeksforgeeks-data.json
  codeforces_scraper.py    # pulls Codeforces data -> data/codeforces-data.json
  codechef_scraper.py      # pulls CodeChef data -> data/codechef-data.json
  code360_scraper.py       # pulls Code 360 data -> data/code360-data.json
requirements.txt           # python deps for the scrapers
run_scrapers.py            # runs one or all scrapers back to back
```

### Refreshing the data

```bash
pip install -r requirements.txt
python scrapers/leetcode_scraper.py        # -> data/leetcode-data.json
python scrapers/geeksforgeeks_scraper.py   # -> data/geeksforgeeks-data.json
python scrapers/codeforces_scraper.py      # -> data/codeforces-data.json
python scrapers/codechef_scraper.py        # -> data/codechef-data.json
python scrapers/code360_scraper.py         # -> data/code360-data.json
```

Or just run them all at once:

```bash
python run_scrapers.py                     # prompts to pick, defaults to all
python run_scrapers.py codechef leetcode   # run by name
python run_scrapers.py codechef --limit 20 # scraper args pass through (codechef/code360)
```

Each scraper skips problem IDs already present in its output file, so re-running just tops up what's missing. Partial runs don't lose work — it checkpoints every 50 problems.

The CodeChef scraper takes a couple of args useful for a quick test:

```bash
python scrapers/codechef_scraper.py --limit 20     # first 20 rated problems only
python scrapers/codechef_scraper.py --pages 5      # first 5 list pages only
```

The Code 360 scraper supports the same `--limit` flag:

```bash
python scrapers/code360_scraper.py --limit 50      # first 50 problems only
```

## Contributing

Bugs, ideas, or a scraper for yet another platform — open an issue or send a PR.

## License

MIT License

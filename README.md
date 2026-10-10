# crossDSA

Chrome extension that finds equivalent or closely matching DSA problems across different platforms. If you're solving a problem on Codeforces and want to find the same problem on LeetCode, GeeksforGeeks, CodeChef, or Code 360, this saves you the manual hunt.

Backs onto a bundled local index across six platforms, so matching works locally and fast.

## What it does

- Adds a draggable floating match button on every supported problem page.
- Matches against LeetCode, GeeksforGeeks, Codeforces, CodeChef, Code 360, and AtCoder.
- Compares titles *and* descriptions, not just keywords — tokenizes, strips stopwords, stems, and weighs rare words higher, so "find the shortest path in a grid" actually finds shortest-path-grid problems instead of everything containing the word "grid".
- Ranks equivalent and closely matching results, highlighting confirmed catalog copies.
- Groups results by platform with tabs, and shows difficulty and topic tags on each one.
- Built-in YouTube search that uses the right key for each platform (contest ID + index for Codeforces, problem code for CodeChef, etc.).
- Remembers the floating button's last position separately for each site.
- Dark-mode friendly.
- The extension icon badge shows today's distinct accepted-problem count, using the dashboard timezone. It updates with tracked activity and resets at local midnight, even with automatic sync disabled.

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
| AtCoder | atcoder.jp/contests/*/tasks/* | English statement sections |

AtCoder supports matching, the question library, random practice, automatic Done, Starred, custom lists and account tracking. Connect a public handle or profile URL in **Connect platforms** to import Algorithm rating, highest rating, rank, rating history and accepted submissions into the dashboard, heatmap, Done Questions and daily accepted count/badge. Upcoming AtCoder contests and optional desktop reminders are available for connected accounts. The initial bundled index contains **3,040 tasks and 176 English statements**, from closed ABC/ARC/AGC and educational algorithm contests; heuristic contests are excluded. English statements are cached incrementally, so remaining entries have metadata only. Titles can be ambiguous, and matching results are suggestions rather than verified equivalents. Problem IDs remain stable across contest rehosts.

AtCoder metadata and numeric difficulty estimates come from the community-maintained [AtCoder Problems datasets](https://github.com/kenkoooo/AtCoderProblems/blob/master/doc/api.md); statements come from official task pages. Numeric estimates are displayed separately and are not converted into Easy/Medium/Hard labels. Company associations are not inferred from contest sponsors or similar titles.

AtCoder profiles and Algorithm rating history come from the official website; submissions come from the unofficial [AtCoder Problems API](https://github.com/kenkoooo/AtCoderProblems/blob/main/doc/api.md) and may be delayed. Site access to AtCoder and kenkoooo.com is requested only when connecting. Sync checks recent activity first and backfills older history, with up to five pages each per sync and more than one second between submission requests. Incomplete imports are labeled as lower bounds; sync again to continue. Cursors include the last timestamp to avoid skipping submissions at page boundaries. Accepted counts deduplicate by task ID even across contest rehosts; repeat accepts still appear as activity. Unique solved task IDs survive the local 15,000 accepted-record limit. Unrated accounts can connect without fabricating a rating. Failed refreshes preserve cached data. No AtCoder password or session access is needed.


### Runs on, but not indexed yet

| Platform | Site | Note |
| --- | --- | --- |
| TakeUForward | takeuforward.org/practice/dsa/{problem} | The button works on individual DSA problem pages and you can search for a TUF problem's equivalent among the six indexed platforms — but TUF problems aren't scraped yet, so no platform will ever suggest a *TUF* problem as a match. |

To bring TakeUForward into the full set, a `tuf_scraper.py` plus a `tuf-data.json` (and registering it in `manifest.json` + `content.js`) is what's missing.

## Install

1. Clone/download this repo.
2. Open `chrome://extensions/`, flip on **Developer mode**.
3. Click **Load unpacked** and pick the project folder.
4. Open any supported problem page, click the search button, done.

## Usage

- Click the overview card (today's goal, total solves and LeetCode activity streak) in the extension popup to open the full-page workspace. After updating an unpacked installation, reload crossDSA at `chrome://extensions/` and reopen its popup/dashboard.
- Use **Connect platforms** to enter public handles or profile links. Chrome requests site access only for the selected platform. Connections identify a profile; they do not verify ownership. Passwords and platform tokens are not collected. LeetCode session reads stay in its browser tab; only accepted question metadata is imported after matching the signed-in username.
- The dashboard combines activity calendars, available recent accepted problems, solved totals, difficulty breakdowns, badges and contest ratings where providers expose them. Refresh manually or enable refresh every 30 minutes while Chrome is running.
- The popup's Code360 POTD marker is automatic: opening or refreshing the popup checks today's coding challenges in a Code360 tab signed in as the connected account. Completing any one coding difficulty shows POTD ✓. MCQs and older challenges do not qualify. The manual Code360 toggle is removed; if status cannot be checked, the button tooltip explains why. Reload the extension and Code360 tabs after updating.
- TakeUForward is excluded from Done Questions, its platform filter and solved-history imports. Profile totals and the TUF-only activity calendar remain available. Its popup POTD marker is automatic: keep a TakeUForward tab signed in as the connected account, then open or refresh the popup. The authenticated daily API must report today's DSA POTD as solved; attempts, SQL POTDs and older challenges do not qualify. This check does not need a local question dataset or create a Done record. Reload the extension and TakeUForward tabs after updating.
- Verified Code360 and TUF POTD status is saved per connected account and provider day (India time), retaining up to 366 daily records. A verified completion stays checked when the site tab closes or a refresh fails, including after popup or browser restarts; a new day starts unchecked until verified. TUF's daily arrow uses its saved provider calendar as of the last profile sync and may include repeat activity. It contributes once to the combined daily arrow and goal progress in the popup and dashboard; POTD verification is not added separately. It does not create Done records. Cached or unavailable LeetCode history retains the normal saved daily count without a trailing plus sign.
- Search the local question library by text, platform, difficulty or topic. Available platforms follow connected accounts. Create named lists in **My lists** and add a question to several lists. Existing bookmarks appear in **Starred**.
- **Companies** groups locally indexed LeetCode and Code360 questions by company, with company search, platform filters, editorial categories, LeetCode time windows, source frequency sorting, difficulty/topic/progress/access filters and shared Done/Star/list actions. Browsing companies does not require a connected account. Counts include only questions matched to the local index. Metadata comes from [snehasishroy/leetcode-companywise-interview-questions](https://github.com/snehasishroy/leetcode-companywise-interview-questions), snapshot **12 July 2026**, pinned to revision `e095c259cfd036e3ddb6886e84d7075c2faac477`; time windows refer to that snapshot, and frequency is the source score. `python scrapers/import_leetcode_companies.py` regenerates `data/leetcode-companies.json` from the pinned CSVs. The normal LeetCode scraper collects statements and topic tags, not company tags; company metadata stays separate. Categories and display aliases can be adjusted in `tracker/companies.mjs` and the importer respectively. Code360 company tags come from the saved local index; aliases are normalized and legacy company tags are separated from practice topics by `tracker/code360-companies.mjs`. New Code360 scrapes save `companies` separately. Code360 has no frequency scores or dated windows: selecting a dated window switches to LeetCode, and combined frequency sorting places Code360 questions after scored LeetCode questions, ordered by title. Questions are counted separately per platform.
- **Done Questions** shows tracked questions once per platform/problem, with latest-solve dates, title search, platform/date filters, sorting, pagination and list actions. Overview keeps the newest 12 unique questions and links to the full page. Imported question counts can differ from profile solved totals.
- Progress, question and Done filters follow connected accounts. Solved questions show a Solved tag and row color; cards retain the star and Add to list controls. Stars toggle the separate **Starred** default list. Add to list manages custom lists only, with search, selection counts and inline list creation; saving custom lists preserves Starred membership. Solved status updates from detected solves or imported history. A normalized question is Done when any verified linked platform version is solved; each Solve on check remains specific to its platform. Saved lists use the same automatic status. An unmarked question means no solve has been detected yet. Legacy manual Done marks no longer affect progress.
- Successful LeetCode submissions update local history and today's goal as soon as the signed-in tab's submission feed reports Accepted (checked about every 2 seconds for up to 90 seconds after Submit). The signed-in username must match the connected account. Records show pending verification until a later profile sync imports the same submission ID; delayed or failed verification preserves them. Profile solved totals remain provider-reported. Other platforms use provider syncs for dated activity and account-matched page observations for additional Done marking. Existing LeetCode tabs automatically regain both tracking helpers after extension updates when scripting access is granted.
- **Done Questions ? Import past solves** scans available history in resumable batches for LeetCode, Codeforces, CodeChef, GeeksforGeeks, AtCoder and Code360. With automatic sync enabled, a successful profile sync queues an initial history scan. LeetCode and Code360 need an open tab signed in as the connected account. Code360 reads the paginated All solved coding problems list, verifies the account before and after each page, and skips inaccessible problem links. Normal profile refreshes also read the newest solved page when a matching signed-in tab is available. Exact timestamps add dated solved activity; missing or ambiguous dates mark Done only. This list is not a complete attempt or repeat-submission log; MCQs and the mixed profile heatmap are excluded. Scans run while Chrome is open, checkpoint after each batch/page, and expose progress, Pause and Resume. Failed scans retain saved records and the last cursor. Repeating a scan deduplicates existing records. ?Available history imported? means the source was exhausted, not that the provider exposes every historical attempt.
- The same dialog accepts pasted HTTPS problem URLs, CSV (`url`, optional `title` and `platform`) or a JSON array of URLs/question objects. Preview shows new, duplicate and unresolved rows before importing. Imports belong to the connected account and are rejected if that account changes after preview. Imported URLs need not be in the local catalog. Solve dates remain unknown; imports do not add submissions, heatmap activity, daily-goal credit or profile totals. Imported solved identities update Done automatically without a separate local marking step.
- Solved identities now persist separately from the 15,000-record activity limit. GFG solved questions without dates are retained for Done marking. On supported problem pages, crossDSA checks existing provider history and conservatively observes visible, explicit Solved/Accepted status when the navigation identifies the connected account. Missing or ambiguous account/status indicators are skipped; the observer never marks Done from a Submit click. Page observations have no inferred submission dates. API-based tracking remains the source of dated activity. Site layout changes may require an adapter update; Code360 also supports signed-in historical imports; bulk URL imports remain available for supported Done Questions platforms.
- Set a daily accepted-problem goal and timezone in **Settings**. Export local handles, activity, lists and settings as JSON for a backup. **Import my data** restores a crossDSA JSON backup, replacing the current saved data after confirmation; restored history scans are paused until resumed. **Delete my data** removes connected and disconnected accounts, activity, stars and custom lists, and resets settings after confirmation. These controls affect data saved in this browser.

### Activity coverage

| Platform | Imported data | Limits |
| --- | --- | --- |
| LeetCode | Solved totals/difficulty, rank, badges, contest rating/history, calendar, recent accepts | Public accepts are capped at 20 per sync. An open LeetCode tab signed in with the matching handle adds accepted metadata from up to 100 recent submissions when public history is unavailable. Up to three calendar years are fetched. Older accepted records are retained locally. Calendar activity is not necessarily a new unique solve. |
| Codeforces | Accepted submissions, unique solved count, tags, rating history | Regular refresh scans up to 10,000 submissions and stops at known history. Resumable background imports continue older history in pages of 1,000. Incomplete histories show a lower-bound solved count. |
| CodeChef | Profile solved total/current rating and dated accepted submissions | Refresh reads the newest 10 feed pages. Resumable background imports continue through available older pages; provider feed limits may still omit old activity. Feed dates are interpreted as IST; accepts in the same minute may merge if no submission ID is public. |
| GeeksforGeeks | Solved totals/difficulty, coding score, institute rank, dated solved records | These records are not a complete attempt/repeat-solve log. Provider dates are retained without inventing a timezone. Missing dated records are flagged. |
| Code 360 | Public solved total/difficulty; signed-in solved coding history | Open Code360 signed in as the connected account for resumable history imports. Exact dated solves contribute to calendar activity and daily goals; undated records mark Done only. Inaccessible links are skipped. The solved list does not establish a full submission log. MCQs and mixed heatmap counts are excluded. |
| TakeUForward | Public TUF solved totals/difficulty and TUF-only activity calendar | Syncs from the public profile or API in the background, without an open TUF tab. Profile heatmaps that combine other connected platforms are excluded to avoid double-counting. The extension declares request-header permission; its header rule applies only to crossDSA?s public TUF profile GETs on the granted host. Reload the extension after updating to apply the manifest change. Sync has a 45-second deadline and requests TUF-filtered heatmaps for the current and previous two years in parallel; unavailable years retain cached dates. TakeUForward is excluded from Done Questions and individual solve imports; POTD completion is checked separately through its signed-in daily API. |

The activity streak is calculated from imported activity, including repeat submissions where a provider counts them. Missing history is not proof of inactivity. Daily goals count distinct problems with an accepted or dated solved record today (including repeat practice of older problems), not raw calendar contributions. Problems count separately on each platform; fuzzy matching does not merge solved identities.

Data stays in `chrome.storage.local` in the current browser profile. Failed refreshes retain the last successful snapshot and show the error. Accounts are replaced separately when a handle changes, while saved lists stay intact. Cached accepted history is capped at 15,000 records per platform. Automatic refresh runs every 30 minutes and after submission clicks (30 seconds and 2 minutes). The dashboard and popup also refresh activity when it is at least 30 minutes old. It requires a running browser and public data may lag. LeetCode accounts without public accepted history need an open signed-in LeetCode tab. Opening or returning to LeetCode automatically retries unavailable or stale activity with a one-minute cooldown; navigation during that cooldown schedules a deferred retry. This obeys the automatic sync setting. Both helpers are restored even with automatic sync disabled, so new accepted submissions can still be observed. Scripting access is granted through Connect platforms. LeetCode cards show separate profile, calendar and activity update times under Sync details and an Open LeetCode action when activity needs attention; failed activity reads preserve the last activity update time and saved accepts. Opening the popup refreshes stale activity, and its Refresh button requests an update immediately.

### Dashboard development and checks

The dashboard uses plain HTML/CSS/JavaScript and the existing bundled index; no build or npm dependencies are required. `tracker/core.mjs` owns counting/identity rules, `tracker/platforms.mjs` normalizes providers, and `tracker/service.mjs` handles permissions, serialized storage updates and refreshes in the MV3 background worker.

Upcoming contests for connected LeetCode, Codeforces, CodeChef, AtCoder, GeeksforGeeks and Code 360 accounts appear in the dashboard and popup, with countdowns, local start-time tooltips and official links. In **Settings ? Contest notifications**, show or hide contests in the popup and independently enable desktop reminders 1 hour and 10 minutes before each contest. Sources need a connected account and site access; the Contests page can request missing access. Desktop notification permission is requested only when reminders are enabled. Schedules refresh every 30 minutes while Chrome is running. Each source has its own cache and freshness checks, so an unavailable source does not block the others. Only announced future contests are shown; recent confirmed history is retained for 90 days. Unavailable refreshes show saved times; stale schedules and overdue reminders are suppressed for desktop alerts. Hiding contests in the popup keeps the dashboard schedule and desktop reminders available. Disabling desktop reminders cancels reminder alarms. The Contests page shows a month calendar (an agenda on mobile), with filters for connected sources and source status indicators. `tracker/contests.mjs`, `tracker/contest-service.mjs`, `tracker/contest-ui.mjs` and `tracker/contest-calendar.mjs` own this feature.

```powershell
node --test --test-isolation=none tests/*.test.mjs
python -B -m unittest discover -s tests -p '*_test.py'
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
  atcoder-data.json
scrapers/
  leetcode_scraper.py      # pulls LeetCode data -> data/leetcode-data.json
  geeksforgeeks_scraper.py # pulls GfG data -> data/geeksforgeeks-data.json
  codeforces_scraper.py    # pulls Codeforces data -> data/codeforces-data.json
  codechef_scraper.py      # pulls CodeChef data -> data/codechef-data.json
  code360_scraper.py       # pulls Code 360 data -> data/code360-data.json
  atcoder_scraper.py       # AtCoder metadata + incremental English statements
requirements.txt           # python deps for the scrapers
scrape.py                  # runs one or all scrapers back to back
```

### Refreshing the data

```bash
pip install -r requirements.txt
python scrapers/leetcode_scraper.py        # -> data/leetcode-data.json
python scrapers/geeksforgeeks_scraper.py   # -> data/geeksforgeeks-data.json
python scrapers/codeforces_scraper.py      # -> data/codeforces-data.json
python scrapers/codechef_scraper.py        # -> data/codechef-data.json
python scrapers/code360_scraper.py         # -> data/code360-data.json
python scrapers/atcoder_scraper.py --limit 150 # refresh metadata, fetch up to 150 missing English statements
```

Or just run them all at once:

```bash
python scrape.py                     # prompts to pick, defaults to all
python scrape.py codechef leetcode   # run by name
python scrape.py codechef --limit 20 # scraper args pass through (codechef/code360/atcoder)
```

Each scraper skips problem IDs already present in its output file, so re-running just tops up what's missing. Partial runs don't lose work — it checkpoints every 50 problems.

The AtCoder importer refreshes all eligible task metadata and preserves previously cached statements. It checkpoints every 25 statement attempts and saves atomically. Use `--metadata-only` to refresh metadata without statement requests, `--limit N` to bound missing-statement requests, or `--retry-unavailable` to recheck tasks previously missing English translations. Without a limit it attempts all missing English statements. Requests are spaced more than one second apart; a full statement import can take a long time. Existing platform selections are preserved after upgrading: enable **AC** in the popup to include AtCoder in matching and random practice if you previously saved a selection.

The CodeChef scraper takes a couple of args useful for a quick test:

```bash
python scrapers/codechef_scraper.py --limit 20     # first 20 rated problems only
python scrapers/codechef_scraper.py --pages 5      # first 5 list pages only
```

The Code 360 scraper supports the same `--limit` flag:

```bash
python scrapers/code360_scraper.py --limit 50      # first 50 problems only
```

### Shared question normalization (offline)

The shared catalog groups equivalent questions while retaining each platform's original title, URL, difficulty, and company evidence. Its offline builder also produces duplicate candidates for review and an alias-aware search API. The library and company lists show each confirmed question once, with Solve on links to its platform versions. Original titles remain searchable; version details retain native statements, difficulties, and contract differences. The page matcher prioritizes confirmed equivalents by URL. A compact runtime catalog verifies source snapshot hashes and preserves existing native saved/solved keys.

```bash
node normalization/build.mjs
node normalization/build.mjs --check
node normalization/audit.mjs # flags new/changed LeetCode entries since individual review
```

See [the normalization guide](normalization/README.md) for the schema, stable identities, merge rules, curation workflow, and tests. Inspect [the generated report](data/normalized/report.md) before migrating the extension.

## Contributing

Bugs, ideas, or a scraper for yet another platform — open an issue or send a PR.

## License

MIT License

Closing LeetCode is a normal cached-history state: public profile and calendar updates continue, while saved accepted questions and Done marks remain available. The dashboard shows separate profile, calendar and submission update times. Cached daily counts are marked as lower bounds. A history import waits without an error when the tab is closed and resumes at its saved cursor when the matching signed-in tab reopens; manually paused imports remain paused.

Question cards open their native platform links directly; the Read question expansion has been removed. Code360 page detection reads the current submission verdict inside its Angular component and matches the connected UUID or screen name from its authenticated account response, with navigation links as a fallback. The listener also covers navigation from the Code360 homepage into a problem. Reload the extension and existing Code360 tabs after installing this update. Sample-run verdicts and partial results do not mark Done. Historical solved identities are imported separately from the signed-in profile solved list using Done Questions ? Import past solves. Public profile totals remain separate from imported question counts.

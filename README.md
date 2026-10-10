# crossDSA

crossDSA is a Chrome extension for managing DSA practice across coding platforms. It brings account activity, a searchable question library, company preparation, saved lists, daily goals and upcoming contests into one dashboard, with problem matching available directly on supported problem pages.

The question library and matching engine use a bundled local index across six platforms. Account tracking, daily-problem checks and contest schedules fetch data from the relevant providers.

## Features

- **Practice dashboard:** view solved totals, activity calendars, recent accepted questions, difficulty breakdowns, available badges and rating history across connected accounts.
- **Question library:** search by title, native ID and topic; filter by platform, difficulty, access and progress; open questions on their original platforms.
- **Company preparation:** browse indexed LeetCode and Code360 questions by company, with categories, progress filters and source-backed LeetCode frequency and time windows.
- **Starred and custom lists:** save questions, organize them into multiple lists and see automatically detected solve status.
- **Done Questions:** browse detected or imported solves, filter by platform and date, and import older history or lists of solved problem URLs.
- **Daily practice:** set a daily goal and timezone, open supported problems of the day, and see today's distinct accepted-problem count on the extension badge.
- **Contest calendar:** browse upcoming contests from connected platforms and optionally receive desktop reminders 1 hour and 10 minutes before they start.
- **Problem matching:** find confirmed equivalents and related suggestions using titles and statements, with platform tabs, difficulty and topic tags, and platform-aware YouTube search.
- **Local data controls:** export a backup, restore saved data or delete local account activity, lists and settings.

## Platform coverage

Indexed questions are available for matching, the library and random practice. Account tracking depends on what each provider exposes.

| Platform | Local question index | Account activity | Upcoming contests |
| --- | --- | --- | --- |
| LeetCode | Yes | Profile, calendar, accepted questions, badges and contest ratings | Yes |
| Codeforces | Yes | Accepted submissions, solved count and rating history | Yes |
| CodeChef | Yes | Profile solved total, current rating and available accepted feed | Yes |
| GeeksforGeeks | Yes | Solved totals, difficulty, coding score, institute rank and available solved records | Yes |
| Code360 | Yes | Public solved totals and signed-in solved coding history | Yes |
| AtCoder | Yes | Algorithm ratings, rank and accepted submissions | Yes |
| TakeUForward | No | Public TUF totals and TUF-only activity calendar | No |

TakeUForward problem pages can search for matches among the six indexed platforms, but TUF questions are not bundled as match destinations. TUF is excluded from Done Questions and individual solved-history imports. Its signed-in DSA problem-of-the-day check is available separately.

Some indexed questions have metadata without a cached statement. Matching suggestions are not proof of equivalence. Reviewed catalog groups retain each platform's original title, URL, difficulty and any known contract differences.

## Install and get started

1. Clone or download this repository.
2. Open `chrome://extensions/` and enable **Developer mode**.
3. Choose **Load unpacked** and select the repository root containing `manifest.json`.
4. Open the extension popup and click its overview card to enter the dashboard.
5. In **Connect platforms**, enter public handles or profile URLs and grant access for the platforms you want to track.
6. Search the library, create a practice list or open a supported problem page to use the floating match button.

The extension runs from the checked-out files; no npm install or build step is required. Python is needed only for scraping and Node.js for offline catalog tools and checks.

After updating an unpacked installation, reload the extension and reopen its popup/dashboard. Reload existing platform tabs so their content scripts use the current version.

## Using the workspace

### Activity and daily goals

The overview combines available provider totals, calendars, ratings and recent solves. Refresh manually or enable automatic refresh every 30 minutes while Chrome is running. Failed refreshes preserve the last successful data and report the error.

Set your daily goal and timezone in **Settings**. Daily accepted counts deduplicate by platform/problem, including repeat practice of a previously solved problem. Calendar activity can include repeat submissions and may differ from distinct solved counts. The badge resets at local midnight even when automatic sync is disabled.

TUF contributes its saved TUF-only calendar activity to daily practice progress once; this may include repeat activity. Its POTD verification does not add separate goal credit or create a Done record.

LeetCode and GFG daily links use provider metadata. Code360 and TUF POTD completion checks require a tab signed in as the connected account. Code360 accepts completion of any current coding difficulty, excluding MCQs; TUF requires today's DSA POTD to be reported as solved, excluding SQL and attempts. Verified Code360/TUF completion is saved per account and provider day in India time and remains available when the tab closes or a refresh fails.

### Questions, companies and lists

Library and Done filters follow connected accounts. Use **Starred** for quick saves or **My lists** to organize questions into several custom lists. Custom-list edits preserve Starred membership.

Confirmed equivalent questions appear once in the library and company lists, with **Solve on** links to their platform versions. Original titles remain searchable. A grouped question is Done when any verified linked version is solved; each platform link retains its own solve status. Underlying saved and solved identities remain platform-specific.

**Companies** is available without connecting an account. It supports company search, editorial categories, platform filters, difficulty/topic/progress/access filters and shared Star/list actions. Counts include only questions matched to the local index. LeetCode time windows refer to the bundled source snapshot, and frequency is the source's score. Code360 tags have no frequency scores or dated windows; selecting a dated window switches to LeetCode.

### Detecting and importing solves

**Done Questions** shows each tracked platform/problem once, with its latest known solve date, search, filters, sorting and list actions. Profile solved totals can differ from imported question counts. Solve status comes from detected or imported history; legacy manual Done marks do not affect progress.

On LeetCode, a successful submission is added when the signed-in tab's submission feed reports Accepted and the username matches the connected account. On other supported problem pages, account-matched observations of explicit Solved/Accepted status can add a Done identity. A Submit click or sample run does not establish a solve. Page observations do not invent activity dates.

Use **Done Questions > Import past solves** for either of these workflows:

- **Scan provider history:** import available older solves in resumable batches. LeetCode and Code360 require a matching signed-in tab. Scans retain saved records and cursors after failures, expose Pause/Resume controls and deduplicate repeated imports. Exhausting the available source does not establish that the provider exposes every historical attempt.
- **Import solved URLs:** paste HTTPS problem URLs, CSV with a `url` column and optional `title`/`platform`, or a JSON array of URLs/question objects. Preview new, duplicate and unresolved rows first. The account must remain unchanged between preview and import. URLs need not be in the local catalog. These records mark Done without adding submission dates, calendar activity, daily credit or profile totals.

Closing a LeetCode tab preserves cached accepted questions and Done status. Provider history scans can wait for a matching tab and resume at their saved cursor; manually paused scans remain paused. Solved identities persist separately from the 15,000-record activity cap per platform.

### Contests and matching

The **Contests** page provides a month calendar, an agenda on mobile, connected-platform filters and source status. In **Settings > Contest notifications**, control popup visibility and desktop reminders independently. Reminders require notification permission and a running browser. Failed schedule refreshes retain cached contests; stale schedules are suppressed for desktop reminders.

On supported problem pages, use the draggable **Match** button to search the bundled index. The panel groups results by platform and links to original problems and YouTube searches. Use the popup to control button visibility, matching strictness and enabled platforms, or choose **Random practice**.

## Data coverage and privacy

Connected handles identify profiles; they do not verify ownership. crossDSA does not ask for platform passwords or collect session tokens. Signed-in LeetCode and Code360 reads stay in their site tabs and import account-matched question metadata. TUF's signed-in daily check returns completion metadata.

User handles, imported activity, lists and settings are saved in `chrome.storage.local` in the current browser profile. Matching and library browsing use bundled data; provider syncs, daily checks, scrapers and contest refreshes make network requests. Optional site access is requested when connecting a platform, scripting access enables supported tab helpers, and notifications are requested for desktop reminders. The declared request-header permission supports a rule restricted to extension-initiated public TUF profile GETs on the granted host.

| Platform | Coverage limits |
| --- | --- |
| LeetCode | Public recent accepts are capped at 20 per sync. A matching signed-in tab provides additional accepted metadata and older-history imports. Calendar activity is not necessarily a new unique solve. |
| Codeforces | Regular refresh scans up to 10,000 submissions; resumable imports continue older history in pages of 1,000. Incomplete solved totals are lower bounds. |
| CodeChef | Refresh reads the newest 10 feed pages; older imports remain limited by the provider's available feed. Dates are interpreted as India time. |
| GeeksforGeeks | Solved records are not a complete attempt or repeat-solve log. Undated solved identities are retained without inventing activity dates. |
| Code360 | The signed-in All solved coding list supplies historical identities. Exact dates contribute to activity; undated records mark Done only. Inaccessible links, MCQs and mixed profile heatmap counts are excluded. |
| AtCoder | Official profiles provide Algorithm ratings; the community AtCoder Problems API supplies submissions and may lag. Older history is backfilled incrementally. Task IDs deduplicate solves across contest rehosts; some bundled tasks lack English statements. |
| TakeUForward | Background sync reads public TUF totals and TUF-filtered calendars. Combined external-platform heatmaps are excluded to avoid double-counting. No individual Done import is available. |

Missing imported history is not proof of inactivity. Provider totals, calendar contributions and imported unique questions describe different things. Confirmed catalog grouping changes how questions are presented; fuzzy suggestions do not merge solved identities.

In **Settings**, export local data as JSON. **Import my data** replaces the current saved data after confirmation and restores history scans in a paused state. **Delete my data** removes connected and disconnected accounts, activity, stars and custom lists and resets settings in this browser.

## Development

### Project layout

```
manifest.json              # MV3 manifest
background.js              # background worker and feature registration
content.js / content.css   # problem-page matching engine, panel and button
popup.html / popup.js      # popup settings and practice overview
dashboard.*                # full-page practice dashboard
tracker/
  core.mjs                 # shared counting, identity and state rules
  tracker-service.mjs      # permissions, storage, account sync and messages
  platforms/               # collectors, browser watchers and session bridges
  contests/                # contest logic, background service, calendar and UI
  companies/               # company indexes, tag normalization and UI
  imports/                 # solved-history and manual solved imports
  ui/                      # shared daily-count display helpers and CSS
  *.mjs                    # library, catalog, ratings, daily status, badge, backup
data/
  *-data.json              # scraped platform snapshots
  leetcode-companies.json  # separately sourced company metadata
  normalized/              # catalog outputs and persistent identity registry
normalization/             # offline catalog build, search, audit and decisions
  reviews/                 # LeetCode audit ledger and review batch records
scrapers/                  # Python scrapers, importers and statement recovery
tests/
  unit/                    # automated Node and Python tests
  browser/                 # browser UI checks using disposable test profiles
  live/                    # optional checks against public platform endpoints
icons/                     # extension icons
requirements.txt           # Python dependencies for the scrapers
scrape.py                  # scraper workflow entry point
```

### Checks

Run from the repository root with Node.js 22 or newer and Python scraper dependencies installed:

```sh
node --test --test-isolation=none tests/unit/*.test.mjs
python -B -m unittest discover -s tests/unit -p '*_test.py'
node normalization/build.mjs --check
node normalization/audit.mjs
```

`tests/browser/` contains browser UI checks. `tests/browser/browser-smoke.mjs` exercises the loaded extension through Chrome DevTools on port 9333; other scripts state their browser setup in their opening comments. Use a separate disposable browser profile: these checks seed test data. Screenshots are written to the system temporary directory.

The optional live check makes read-only requests against public sample accounts and requires Windows `curl.exe`:

```sh
node tests/live/live-platforms.mjs
```

### Refreshing source data

Install the Python dependencies, then run selected scrapers:

```sh
python -m pip install -r requirements.txt
python scrape.py                     # interactive selection; defaults to all
python scrape.py codechef leetcode    # selected platforms
python scrape.py code360 --limit 50   # bounded Code360 scrape
python scrape.py atcoder --limit 150  # metadata and missing English statements
```

Individual scrapers can also run directly, for example `python scrapers/leetcode_scraper.py`. Most scrapers resume from existing IDs and checkpoint partial progress. AtCoder refreshes eligible metadata while preserving cached statements; `--metadata-only` skips statement requests and `--retry-unavailable` retries missing English translations. Statement requests are spaced more than one second apart.

`scrape.py` checks LeetCode review coverage after scraping, including partially failed runs. New or changed source statements can require review before a clean audit. Review the reported entries rather than automatically replacing their evidence pins.

LeetCode company metadata is imported separately:

```sh
python scrapers/import_leetcode_companies.py
```

The bundled source is [snehasishroy/leetcode-companywise-interview-questions](https://github.com/snehasishroy/leetcode-companywise-interview-questions), pinned to revision `e095c259cfd036e3ddb6886e84d7075c2faac477` with a 12 July 2026 snapshot. Code360 company evidence comes from its scraped tags. AtCoder metadata and numeric difficulty estimates come from [AtCoder Problems](https://github.com/kenkoooo/AtCoderProblems/blob/main/doc/api.md), with statements from official task pages. Numeric estimates remain separate from Easy/Medium/Hard labels.

### Building the shared question catalog

The offline normalization tools group evidenced equivalents, preserve platform contracts and produce a compact runtime catalog. Candidate suggestions remain separate from confirmed groups. Stable identities keep existing native saved and solved keys usable across catalog refreshes.

After scraping and reviewing source changes:

```sh
node normalization/audit.mjs
node normalization/build.mjs
node normalization/build.mjs --check
```

Keep `data/normalized/identities.json` across refreshes; it preserves historical assignments and redirects. Curation decisions live in `normalization/decisions.json`, with audit and review batch records in `normalization/reviews/`. The build verifies source snapshots; finish scraping before rebuilding.

See [the normalization guide](normalization/README.md) for schemas, merge policy and curation. Inspect [the generated report](data/normalized/report.md) before distributing a refreshed catalog.

## Contributing

Issues and pull requests are welcome for platform adapters, tracking reliability, dashboard improvements, source coverage and reviewed question mappings. Include relevant checks and keep scraped source evidence distinct from inferred matches.

## License

[MIT](LICENSE)

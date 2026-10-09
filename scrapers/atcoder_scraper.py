"""Import closed algorithm tasks, then incrementally cache English statements.

Metadata and difficulty estimates: community AtCoder Problems API.
Statements: official AtCoder task pages. No account or submission access.
"""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import time

import requests
from bs4 import BeautifulSoup

OUTPUT_FILE = Path(__file__).resolve().parent.parent / 'data' / 'atcoder-data.json'
API = 'https://kenkoooo.com/atcoder/resources/'
IDENTIFIER = re.compile(r'^[a-zA-Z0-9_-]+$')
CONTEST = re.compile(r'^(?:abc\d+|arc\d+|agc\d+|dp|tdpc|practice2)$')


def extract_statement(html):
    soup = BeautifulSoup(html, 'html.parser')
    root = soup.select_one('#task-statement .lang-en') or soup.select_one('#task-statement')
    if root is None:
        return '', ''
    for node in root.select('script, style'):
        node.decompose()
    sections = {}
    for heading in root.select('h3'):
        label = heading.get_text(' ', strip=True).casefold()
        fragments = []
        for sibling in heading.next_siblings:
            if getattr(sibling, 'name', None) in ('h3', 'section'):
                break
            text = sibling.get_text(' ', strip=True) if hasattr(sibling, 'get_text') else str(sibling).strip()
            if text:
                fragments.append(text)
        sections[label] = re.sub(r'\s+', ' ', ' '.join(fragments)).strip()
    # Never silently index the Japanese statement as English.
    return sections.get('problem statement', ''), sections.get('constraints', '')


def normalize_problems(problems, contests, models, previous=(), now=None):
    now = time.time() if now is None else now
    closed = {c['id'] for c in contests if isinstance(c, dict) and CONTEST.fullmatch(str(c.get('id', '')))
              and isinstance(c.get('start_epoch_second'), (int, float)) and isinstance(c.get('duration_second'), (int, float))
              and c['start_epoch_second'] + c['duration_second'] <= now}
    saved = {p['id']: p for p in previous if isinstance(p, dict) and isinstance(p.get('id'), str)}
    records = {}
    for problem in problems:
        if not isinstance(problem, dict):
            continue
        task, contest = problem.get('id'), problem.get('contest_id')
        title = problem.get('name') or problem.get('title')
        if not isinstance(task, str) or not IDENTIFIER.fullmatch(task) or contest not in closed or not isinstance(title, str) or not title.strip():
            continue
        if task in records:
            continue
        old = saved.get(task, {})
        record = {
            'id': task, 'title': title.strip(), 'contestId': contest,
            'url': f'https://atcoder.jp/contests/{contest}/tasks/{task}',
            'difficulty': 'Unknown', 'isPremium': False, 'topics': [],
            'description': old.get('description', ''), 'constraints': old.get('constraints', ''),
            'source': 'atcoder', 'metadataSource': API + 'problems.json',
        }
        for field in ('statementFetchedAt', 'statementLanguage', 'statementCheckedAt'):
            if old.get(field):
                record[field] = old[field]
        model = models.get(task, {})
        difficulty = model.get('difficulty') if isinstance(model, dict) else None
        if isinstance(difficulty, (int, float)) and not isinstance(difficulty, bool) and math.isfinite(difficulty):
            record['estimatedDifficulty'] = round(difficulty)
            record['difficultySource'] = API + 'problem-models.json'
        records[task] = record
    if not records:
        raise ValueError('No closed algorithm tasks found; the saved index was not changed.')
    # Older ABCs can be Japanese-only. Prefer educational sets, then recent contests.
    starts = {c['id']: c['start_epoch_second'] for c in contests if c.get('id') in closed}
    return sorted(records.values(), key=lambda p: (p['contestId'] not in ('dp', 'practice2'), -starts[p['contestId']], p['id']))


def save_data(records, output=OUTPUT_FILE):
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.json.tmp')
    try:
        temporary.write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)


def fetch_all_questions(limit=0, metadata_only=False, retry_unavailable=False):
    previous = json.loads(OUTPUT_FILE.read_text(encoding='utf-8')) if OUTPUT_FILE.exists() else []
    session = requests.Session()
    session.headers['User-Agent'] = 'crossDSA AtCoder index importer'
    # The API maintainer asks for more than one second between requests.
    def get(url):
        try:
            response = session.get(url, timeout=25)
            response.raise_for_status()
            return response
        finally:
            time.sleep(1.1)
    problems = get(API + 'problems.json').json()
    contests = get(API + 'contests.json').json()
    if not isinstance(problems, list) or not isinstance(contests, list):
        raise ValueError('Invalid metadata response; the saved index was not changed.')
    try:
        models = get(API + 'problem-models.json').json()
        if not isinstance(models, dict):
            models = {}
    except (requests.RequestException, ValueError) as error:
        print(f'Difficulty estimates unavailable: {error}', flush=True)
        models = {}
    records = normalize_problems(problems, contests, models, previous)
    save_data(records)
    print(f'Indexed {len(records)} closed algorithm tasks.', flush=True)
    pending = [p for p in records if not p['description'] and (retry_unavailable or p.get('statementLanguage') != 'unavailable')]
    if metadata_only:
        pending = []
    elif limit:
        pending = pending[:limit]
    failures = 0
    try:
        for index, record in enumerate(pending, 1):
            try:
                description, constraints = extract_statement(get(record['url'] + '?lang=en').text)
                checked = datetime.now(timezone.utc).isoformat()
                if not description:
                    record.update(statementLanguage='unavailable', statementCheckedAt=checked)
                    print(f'{record["id"]}: no English statement; metadata retained', flush=True)
                else:
                    record.update(description=description, constraints=constraints,
                                  statementLanguage='en', statementFetchedAt=checked)
            except (requests.RequestException, ValueError) as error:
                failures += 1
                print(f'{record["id"]}: {error}', flush=True)
            if index % 25 == 0:
                save_data(records)
                print(f'Statements: {index}/{len(pending)} attempted', flush=True)
    finally:
        save_data(records)
        session.close()
    print(f'Saved {len(records)} tasks; {sum(bool(p["description"]) for p in records)} English statements; {failures} failures.', flush=True)
    return 1 if failures else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Import AtCoder algorithm tasks and English statements')
    parser.add_argument('--limit', type=int, default=0, help='Maximum missing statements to fetch (0 = all)')
    parser.add_argument('--metadata-only', action='store_true', help='Refresh metadata without fetching statements')
    parser.add_argument('--retry-unavailable', action='store_true', help='Retry tasks previously missing English statements')
    args = parser.parse_args()
    if args.limit < 0:
        parser.error('--limit must be nonnegative')
    raise SystemExit(fetch_all_questions(args.limit, args.metadata_only, args.retry_unavailable))

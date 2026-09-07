import argparse
import json
import os
import re
import time
import requests
from bs4 import BeautifulSoup

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'code360-data.json')

BASE_URL = "https://www.naukri.com/code360/api"
LIST_API = f"{BASE_URL}/v3/public_section/all_problems"
DETAIL_API = f"{BASE_URL}/v3/public_section/problem_detail"
PAGE_SIZE = 25

DIFFICULTY_MAP = {
    'EASY': 'Easy',
    'MODERATE': 'Medium',
    'MEDIUM': 'Medium',
    'HARD': 'Hard',
}


def make_session():
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.naukri.com/code360/problems'
    })
    return session


def load_existing_data():
    try:
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_data(data):
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_problem_list(session, page, retries=3):
    for attempt in range(retries):
        try:
            response = session.get(LIST_API, params={'page': page, 'limit': PAGE_SIZE}, timeout=20)
            if response.status_code == 200:
                payload = response.json()
                if payload.get('status') == 200 and payload.get('data'):
                    data = payload['data']
                    problem_list = data.get('problem_list', []) or []
                    return problem_list, len(problem_list)
                else:
                    print(f"  API error: {payload.get('message')}")
                    return [], 0
            elif response.status_code == 429:
                print(f"  Rate limited (429), backing off 15s...")
                time.sleep(15)
            else:
                print(f"  HTTP {response.status_code} for page {page}")
        except requests.RequestException as e:
            print(f"  Request failed (attempt {attempt + 1}/{retries}) for page {page}: {e}")

        if attempt < retries - 1:
            time.sleep(2 ** attempt)
    return [], 0


def get_problem_detail(session, slug, problem_id, retries=3):
    for attempt in range(retries):
        try:
            response = session.get(DETAIL_API, params={'slug': slug, 'problem_id': problem_id}, timeout=20)
            if response.status_code == 200:
                payload = response.json()
                if payload.get('status') == 200:
                    return payload.get('data', {})
                else:
                    print(f"  API error: {payload.get('message')}")
                    return None
            elif response.status_code == 429:
                print(f"  Rate limited (429), backing off 15s...")
                time.sleep(15)
            else:
                print(f"  HTTP {response.status_code} for {slug}")
        except requests.RequestException as e:
            print(f"  Request failed (attempt {attempt + 1}/{retries}) for {slug}: {e}")

        if attempt < retries - 1:
            time.sleep(2 ** attempt)
    return None


def detect_sql(text):
    sql_indicators = [
        r'Table:\s*\w+',
        r'Column Name.*Type',
        r'\+[-+]+\+',
        r'varchar\(\d+\)',
        r'create table',
        r'insert into',
        r'select\s+.*\s+from',
        r'database',
        r'SQL Query',
    ]
    for pattern in sql_indicators:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False


def extract_description_and_constraints(html_desc):
    if not html_desc:
        return "", "", False

    is_sql = detect_sql(html_desc)

    constraint_re = re.compile(r'constraints?\s*[:.]', re.IGNORECASE)

    # Build a working soup and find the "Constraints:" heading.
    soup = BeautifulSoup(html_desc, 'html.parser')
    for tag in soup.find_all(['img', 'script', 'style']):
        tag.decompose()

    # find the "Note" hint about not needing to print, used as a marker too
    constraint_heading = None
    for h in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
        if constraint_re.search(h.get_text(' ', strip=True)):
            constraint_heading = h
            break

    # --- Extract constraints block (from heading onwards) ---
    constraints = ""
    if constraint_heading is not None:
        parent = constraint_heading.parent
        parts = []
        started = False
        for child in parent.children:
            if child is constraint_heading:
                started = True
                continue
            if started:
                if getattr(child, 'name', None) in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
                    cls = child.get_text(' ', strip=True).lower()
                    if 'sample' in cls or 'example' in cls:
                        break
                parts.append(child)
        constraints = " ".join(
            getattr(p, 'get_text', lambda sep=' ': p if isinstance(p, str) else '')(separator=' ', strip=True)
            for p in parts
        )
        constraints = re.sub(r'\s+', ' ', constraints).strip()

    # --- Extract description (everything up to constraints heading) ---
    if constraint_heading is not None:
        clone = BeautifulSoup(str(soup), 'html.parser')
        heading = None
        for h in clone.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
            if constraint_re.search(h.get_text(' ', strip=True)):
                heading = h
                break
        if heading is not None:
            parent = heading.parent
            # remove the heading and every following sibling
            to_remove = []
            node = heading
            while node is not None:
                to_remove.append(node)
                node = node.find_next_sibling()
            for n in to_remove:
                n.decompose()
        desc_soup = clone
    else:
        desc_soup = soup

    # split at sample/example heading if present
    for p in desc_soup.find_all('p'):
        p.insert_after('\n')
    text = desc_soup.get_text(separator=' ')
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n\s*\n', '\n', text).strip()

    example_match = re.search(r'(sample\s*input\s*\d*\s*:|example\s*\d*\s*:)', text, re.IGNORECASE)
    if example_match:
        description = text[:example_match.start()].strip()
    else:
        description = text

    description = re.sub(r'\s+', ' ', description).strip()

    return description, constraints, is_sql


def fetch_all_questions(limit=0):
    print(f"Fetching all Code 360 questions -> {OUTPUT_FILE}")
    print("-" * 60)

    session = make_session()

    existing_data = load_existing_data()
    existing_ids = {str(p['id']) for p in existing_data}
    print(f"Loaded {len(existing_data)} existing problems")

    all_problems = []
    page = 0
    total = 0
    api_total = None

    while True:
        problem_list, count = get_problem_list(session, page)
        if not problem_list:
            if page == 0:
                print("Failed to fetch problems list")
                return
            break
        all_problems.extend(problem_list)
        total += len(problem_list)

        if api_total is None and problem_list:
            api_total = problem_list[0].get('total_count')

        print(f"  page {page}: +{len(problem_list)} problems (cumulative {total})")
        page += 1

        if len(problem_list) < PAGE_SIZE:
            break

        if limit and total >= limit:
            break

        time.sleep(1)

    if api_total:
        print(f"Total problems (from API): {api_total}")
    print(f"Found {len(all_problems)} problems total")

    if not all_problems:
        return

    if limit:
        all_problems = all_problems[:limit]

    success_count = 0
    failed_count = 0
    skipped_count = 0
    batch_count = 0
    sql_count = 0

    for i, problem in enumerate(all_problems):
        problem_id = str(problem.get('id'))
        slug = problem.get('slug', '')
        name = problem.get('name', '')
        difficulty = DIFFICULTY_MAP.get(str(problem.get('difficulty', '')).upper(), 'Easy')

        print(f"[{i+1:4d}/{len(all_problems)}] ID {problem_id}: {name[:50]:<50}")

        if problem_id in existing_ids:
            print(f"          (exists, skipping)")
            skipped_count += 1
            continue

        detail = get_problem_detail(session, slug, problem_id)

        if not detail:
            print(f"          Failed to fetch detail")
            failed_count += 1
            time.sleep(1)
            continue

        offerable = detail.get('offerable') or {}
        problem_data = offerable.get('problem') or {}
        offering = detail.get('offering') or {}

        html_desc = problem_data.get('description', '')
        diff_key = str(problem_data.get('difficulty', '')).upper()
        difficulty = DIFFICULTY_MAP.get(diff_key, difficulty)

        topics = []
        raw_topics = problem_data.get('practice_topics') or []
        if raw_topics:
            topics.extend(raw_topics)
        for c in (problem_data.get('company_list') or []):
            if c.get('name'):
                topics.append(c['name'])
        topics = list(dict.fromkeys(topics))

        description, constraints, is_sql = extract_description_and_constraints(html_desc)

        if not description:
            print(f"          Failed to extract statement")
            failed_count += 1
            time.sleep(1)
            continue

        url_slug = offering.get('slug') or slug
        entry = {
            'id': problem_id,
            'title': name,
            'url': f"https://www.naukri.com/code360/problems/{url_slug}",
            'difficulty': difficulty,
            'isPremium': False,
            'topics': topics,
            'description': description,
            'constraints': constraints,
            'is_sql': is_sql,
            'source': 'code360'
        }

        existing_data.append(entry)
        existing_ids.add(problem_id)
        success_count += 1
        if is_sql:
            sql_count += 1
        print(f"          OK - {len(description)} chars, diff={difficulty}, topics={len(topics)}, cons={len(constraints)}")

        batch_count += 1
        if batch_count % 50 == 0:
            save_data(existing_data)
            print(f"          [checkpoint] Saved {len(existing_data)} problems (batch {batch_count // 50})")

        time.sleep(1)

    existing_data.sort(key=lambda x: int(x['id']) if str(x['id']).isdigit() else 0)
    save_data(existing_data)

    print(f"\n{'='*60}")
    print(f"COMPLETE! Total problems in {OUTPUT_FILE}: {len(existing_data)}")
    print(f"   New:             {success_count}")
    print(f"   SQL:             {sql_count}")
    print(f"   Skipped:         {skipped_count}")
    print(f"   Failed:          {failed_count}")
    print(f"{'='*60}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape Code 360 problems")
    parser.add_argument('--limit', type=int, default=0,
                        help='Only fetch this many problems (0 = all)')
    args = parser.parse_args()
    fetch_all_questions(limit=args.limit)

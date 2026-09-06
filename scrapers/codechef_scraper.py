import argparse
import json
import os
import re
import time
import requests
from bs4 import BeautifulSoup

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'codechef-data.json')
LIST_API = "https://www.codechef.com/api/list/problems"
DETAIL_API = "https://www.codechef.com/api/contests/PRACTICE/problems/{code}"
PAGE_SIZE = 20

def make_session():
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
    })
    return session

def is_not_school(difficulty_rating):
    if difficulty_rating is None:
        return True
    return difficulty_rating not in (-1, '-1')

def get_rated_problems(session, max_pages=0):
    rated = []
    skipped_school = 0
    page = 0
    total = None

    while True:
        try:
            response = session.get(LIST_API, params={
                'page': page,
                'limit': PAGE_SIZE,
                'sort_by': 'difficulty_rating',
                'sort_order': 'asc'
            }, timeout=20)
            response.raise_for_status()
            data = response.json()
        except Exception as e:
            print(f"  Failed to fetch list page {page}: {e}")
            break

        results = data.get('data', [])
        if total is None:
            total = data.get('count', 0)
            print(f"Total problems on CodeChef: {total}")

        if not results:
            break

        for problem in results:
            if is_not_school(problem.get('difficulty_rating')):
                rated.append(problem)
            else:
                skipped_school += 1

        print(f"  Page {page}: {len(results)} problems ({len(rated)} kept so far, {skipped_school} school skipped)")

        if max_pages and page + 1 >= max_pages:
            print(f"  Stopping after {max_pages} list pages")
            break

        page += 1
        time.sleep(0.4)

    return rated, skipped_school

def fetch_problem_detail(session, code, retries=3):
    url = DETAIL_API.format(code=code)

    for attempt in range(retries):
        try:
            response = session.get(url, timeout=15)
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 429:
                print(f"  Rate limited on {code}, backing off...")
                time.sleep(10)
            else:
                print(f"  HTTP {response.status_code} for {code}")
        except requests.RequestException as e:
            print(f"  Request failed (attempt {attempt + 1}/{retries}) for {code}: {e}")

        if attempt < retries - 1:
            time.sleep(2 ** attempt)

    return None

def clean_text(text):
    if not text:
        return ""
    text = re.sub(r'\$+', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def extract_from_components(detail):
    comp = detail.get('problemComponents') or {}
    statement = clean_text(comp.get('statement'))
    input_format = clean_text(comp.get('inputFormat'))
    constraints = clean_text(comp.get('constraints'))

    if not statement:
        return "", ""

    description = statement
    if input_format:
        description += ' Input: ' + input_format

    return description, constraints

def extract_from_body(body):
    if not body:
        return "", ""

    soup = BeautifulSoup(body, 'html.parser')
    for tag in soup.find_all(['script', 'style', 'img']):
        tag.decompose()

    text = soup.get_text(separator=' ', strip=True)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\s*All submissions for this problem are available\.?\s*$', '', text)

    constraints_match = re.search(r'Constraints\s*:', text, re.IGNORECASE)
    sample_match = re.search(r'Sample\s+Input\s*:', text, re.IGNORECASE)

    boundary = len(text)
    if sample_match:
        boundary = sample_match.start()
    elif constraints_match:
        boundary = constraints_match.start()

    description = text[:boundary].strip()
    description = re.sub(r'\b(Problem Statement|Input|Output)\s*:\s*', ' ', description, flags=re.IGNORECASE)
    description = clean_text(description)

    constraints = ""
    if constraints_match:
        end = sample_match.start() if sample_match else len(text)
        constraints = clean_text(text[constraints_match.end():end])

    return description, constraints

def extract_topics(detail):
    topics = set()
    for key in ('user_tags', 'computed_tags'):
        for tag in (detail.get(key) or []):
            text = str(tag).strip()
            if text:
                topics.add(text)
    return sorted(topics)

def difficulty_from_rating(rating):
    try:
        rating = int(rating)
    except (TypeError, ValueError):
        return 'Easy'
    if rating <= 1200:
        return 'Easy'
    if rating <= 2000:
        return 'Medium'
    return 'Hard'

def detect_sql(description, constraints):
    combined = (description or "") + " " + (constraints or "")
    return bool(re.search(r'(?i)create table|insert into|select\s+.*\s+from|varchar\s*\(|database\s+schema|sql\s+query', combined))

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

def fetch_all_questions(limit=0, max_pages=0):
    print(f"Fetching CodeChef problems (all except school) -> {OUTPUT_FILE}")
    print("-" * 60)

    session = make_session()

    existing_data = load_existing_data()
    existing_ids = {p['id'] for p in existing_data}
    print(f"Loaded {len(existing_data)} existing problems")
    print(f"Skipping any problem already present in {OUTPUT_FILE}")

    print("Fetching problem list...")
    rated_problems, skipped_school = get_rated_problems(session, max_pages)

    if not rated_problems:
        print("No problems found in the list")
        return

    if limit:
        rated_problems = rated_problems[:limit]
        print(f"Processing only first {limit} problems (test mode)")

    print(f"Retrieved {len(rated_problems)} problems from list")
    pending = [p for p in rated_problems if str(p.get('code') or '') not in existing_ids]
    print(f"{len(pending)} not yet in {OUTPUT_FILE}, {len(rated_problems) - len(pending)} already present")

    success_count = 0
    failed_count = 0
    skipped_count = 0
    batch_count = 0
    failed_entries = []

    for i, problem in enumerate(rated_problems):
        code = str(problem.get('code') or '')
        name = problem.get('name', '')

        if not code:
            continue

        print(f"[{i+1:4d}/{len(rated_problems)}] ID {code}: {name[:50]:<50}")

        if code in existing_ids:
            print(f"          (exists, skipping)")
            skipped_count += 1
            continue

        detail = fetch_problem_detail(session, code)
        if not detail:
            print(f"          Failed to fetch detail")
            failed_count += 1
            failed_entries.append(code)
            time.sleep(1)
            continue

        description, constraints = extract_from_components(detail)
        if not description:
            description, constraints = extract_from_body(detail.get('body', ''))

        if not description:
            print(f"          No statement found")
            failed_count += 1
            failed_entries.append(code)
            time.sleep(1)
            continue

        is_sql = detect_sql(description, constraints)

        entry = {
            'id': code,
            'title': name,
            'url': f"https://www.codechef.com/problems/{code}",
            'difficulty': difficulty_from_rating(problem['difficulty_rating']),
            'isPremium': False,
            'topics': extract_topics(detail),
            'description': description,
            'constraints': constraints,
            'is_sql': is_sql,
            'source': 'codechef'
        }

        existing_data.append(entry)
        existing_ids.add(code)
        success_count += 1
        print(f"          OK - {len(description)} chars, rating={problem.get('difficulty_rating')}, diff={entry['difficulty']}")

        batch_count += 1
        if batch_count % 50 == 0:
            save_data(existing_data)
            print(f"          [checkpoint] Saved {len(existing_data)} problems (batch {batch_count // 50})")

        time.sleep(1)

    save_data(existing_data)

    print(f"\n{'='*60}")
    print(f"COMPLETE! Total problems in {OUTPUT_FILE}: {len(existing_data)}")
    print(f"   New:             {success_count}")
    print(f"   Skipped:         {skipped_count}")
    print(f"   Failed:          {failed_count}")
    print(f"   School skipped from list: {skipped_school}")
    if failed_entries:
        print(f"   Failed IDs:      {failed_entries}")
    print(f"{'='*60}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CodeChef rated-problems scraper")
    parser.add_argument('--limit', type=int, default=0,
                        help="Process only the first N rated problems (test mode)")
    parser.add_argument('--pages', type=int, default=0,
                        help="Only fetch the first N list pages")
    args = parser.parse_args()
    fetch_all_questions(limit=args.limit, max_pages=args.pages)
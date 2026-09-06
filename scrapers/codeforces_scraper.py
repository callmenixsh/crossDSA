import json
import os
import requests
import time
import re
from bs4 import BeautifulSoup, Tag

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'codeforces-data.json')
PROBLEMS_API = "https://codeforces.com/api/problemset.problems"
PROBLEM_PAGE = "https://codeforces.com/problemset/problem/{contestId}/{index}"

def make_session():
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    })
    return session

def difficulty_from_rating(rating):
    if not rating:
        return 'Easy'
    if rating <= 1200:
        return 'Easy'
    if rating <= 2000:
        return 'Medium'
    return 'Hard'

def get_all_problems(session):
    response = session.get(PROBLEMS_API, timeout=20)
    response.raise_for_status()
    data = response.json()
    if data.get('status') != 'OK':
        print(f"API error: {data.get('comment')}")
        return []
    return data.get('result', {}).get('problems', [])

def extract_statement(html):
    if not html:
        return "", "", False

    soup = BeautifulSoup(html, 'html.parser')
    statement = soup.find('div', class_='problem-statement')
    if not statement:
        return "", "", False

    for tag in statement.find_all(['script', 'style']):
        tag.decompose()

    children = [c for c in statement.contents if isinstance(c, Tag)]

    description = ""
    constraints = ""
    header_text = ""

    for child in children:
        if child.has_attr('class'):
            classes = child.get('class', [])

            if 'header' in classes:
                header_text = child.get_text(separator=' ', strip=True)
            elif 'input-specification' in classes:
                constraints = clean_text(child.get_text(separator=' ', strip=True))
            elif 'sample-tests' in classes or 'note' in classes or 'output-specification' in classes:
                continue
            elif not description:
                description = clean_text(child.get_text(separator=' ', strip=True))
        elif not description:
            description = clean_text(child.get_text(separator=' ', strip=True))

    is_sql = bool(re.search(r'(?i)create table|insert into|select .* from|varchar\s*\(|database schema|sql\x20query',
                            description + " " + constraints))

    return description, constraints, is_sql

def clean_text(text):
    text = re.sub(r'\$+', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

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

def fetch_problem_page(session, contest_id, index, retries=3):
    url = PROBLEM_PAGE.format(contestId=contest_id, index=index)

    for attempt in range(retries):
        try:
            response = session.get(url, timeout=15)
            if response.status_code == 200:
                return response.text
            elif response.status_code == 429:
                print(f"  Rate limited, backing off...")
                time.sleep(15)
            else:
                print(f"  HTTP {response.status_code} for {contest_id}{index}")
        except requests.RequestException as e:
            print(f"  Request failed (attempt {attempt + 1}/{retries}) for {contest_id}{index}: {e}")

        if attempt < retries - 1:
            time.sleep(2 ** attempt)

    return None

def fetch_all_questions():
    print(f"Fetching all Codeforces questions -> {OUTPUT_FILE}")
    print("-" * 60)

    session = make_session()

    existing_data = load_existing_data()
    existing_ids = {p['id'] for p in existing_data}
    print(f"Loaded {len(existing_data)} existing problems")

    print("Fetching problems list...")
    all_problems = get_all_problems(session)

    if not all_problems:
        print("Failed to fetch problems list")
        return

    print(f"Found {len(all_problems)} problems")

    success_count = 0
    failed_count = 0
    skipped_count = 0
    failed_entries = []
    batch_count = 0

    for i, problem in enumerate(all_problems):
        contest_id = problem.get('contestId')
        index = problem.get('index')
        name = problem.get('name', '')
        rating = problem.get('rating')

        if not contest_id or not index:
            continue

        problem_id = f"{contest_id}{index}"
        title = f"{index}. {name}"

        print(f"[{i+1:4d}/{len(all_problems)}] ID {problem_id}: {name[:50]:<50}")

        if problem_id in existing_ids:
            print(f"          (exists, skipping)")
            skipped_count += 1
            continue

        html = fetch_problem_page(session, contest_id, index)
        if not html:
            print(f"          Failed to fetch problem page")
            failed_count += 1
            failed_entries.append(problem_id)
            time.sleep(1)
            continue

        description, constraints, is_sql = extract_statement(html)

        if not description:
            print(f"          Failed to extract statement")
            failed_count += 1
            failed_entries.append(problem_id)
            time.sleep(1)
            continue

        entry = {
            'id': problem_id,
            'title': title,
            'url': PROBLEM_PAGE.format(contestId=contest_id, index=index),
            'difficulty': difficulty_from_rating(rating),
            'isPremium': False,
            'topics': problem.get('tags', []),
            'description': description,
            'constraints': constraints,
            'is_sql': is_sql,
            'source': 'codeforces'
        }

        existing_data.append(entry)
        existing_ids.add(problem_id)
        success_count += 1
        print(f"          OK - {len(description)} chars, rating={rating}, diff={entry['difficulty']}")

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
    if failed_entries:
        print(f"   Failed IDs:      {failed_entries}")
    print(f"{'='*60}")

if __name__ == "__main__":
    fetch_all_questions()
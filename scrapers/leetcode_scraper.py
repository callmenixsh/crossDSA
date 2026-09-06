import json
import os
import requests
import time
from bs4 import BeautifulSoup
import re
from typing import Tuple, Optional

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'leetcode-data.json')

def get_all_problems_list(session: requests.Session):
    url = "https://leetcode.com/api/problems/all/"

    try:
        response = session.get(url, timeout=10)

        if response.status_code == 200:
            data = response.json()
            return data.get('stat_status_pairs', [])
        else:
            print(f"Failed to fetch problems list: {response.status_code}")
            return []

    except Exception as e:
        print(f"Error fetching problems list: {e}")
        return []

def extract_all_problems(all_problems):
    target_problems = []

    for problem_data in all_problems:
        stat = problem_data.get('stat', {})
        difficulty = problem_data.get('difficulty', {})
        paid_only = problem_data.get('paid_only', False)

        problem_id = stat.get('frontend_question_id')

        if problem_id:
            problem_info = {
                'id': str(problem_id),
                'title': stat.get('question__title', ''),
                'slug': stat.get('question__title_slug', ''),
                'difficulty': {1: 'Easy', 2: 'Medium', 3: 'Hard'}.get(difficulty.get('level', 1), 'Easy'),
                'isPremium': paid_only
            }
            target_problems.append(problem_info)

    target_problems.sort(key=lambda x: int(x['id']))
    return target_problems

def detect_sql_problem(text: str) -> bool:
    sql_indicators = [
        r'Table:\s*\w+',
        r'Column Name.*Type',
        r'\+[-+]+\+',
        r'employee_id.*int',
        r'varchar\(\d+\)',
        r'Write a.*solution',
        r'Select.*from',
        r'database'
    ]

    for pattern in sql_indicators:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False

def extract_description_and_constraints(html_desc: str) -> Tuple[str, str, bool]:
    if not html_desc:
        return "", "", False

    soup = BeautifulSoup(html_desc, 'html.parser')

    for tag in soup.find_all(['img', 'style', 'script']):
        tag.decompose()

    for li in soup.find_all('li'):
        li.insert_before('\n• ')

    for p in soup.find_all('p'):
        p.insert_after('\n')

    text = soup.get_text(separator=' ', strip=True)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n\s*\n', '\n', text)
    text = text.strip()

    is_sql = detect_sql_problem(text)

    example_match = re.search(r'Example\s*\d*\s*:', text, re.IGNORECASE)
    constraints_match = re.search(r'Constraints?\s*:', text, re.IGNORECASE)
    followup_match = re.search(r'Follow-up\s*:', text, re.IGNORECASE)

    if example_match:
        description = text[:example_match.start()].strip()
    else:
        if constraints_match:
            description = text[:constraints_match.start()].strip()
        else:
            description = re.sub(r'Follow-up:.*$', '', text, flags=re.IGNORECASE | re.DOTALL).strip()

    if not is_sql:
        description = re.sub(r'\s+', ' ', description)

    constraints = ""
    if constraints_match:
        constraints_start = constraints_match.end()

        if followup_match and followup_match.start() > constraints_match.start():
            constraints_text = text[constraints_start:followup_match.start()].strip()
        else:
            constraints_text = text[constraints_start:].strip()

        constraints = re.sub(r'Follow-up:.*$', '', constraints_text, flags=re.IGNORECASE | re.DOTALL).strip()

        if not is_sql:
            constraints = re.sub(r'•\s*', '\n• ', constraints)
            constraints = re.sub(r'^\n', '', constraints)
            constraints = constraints.strip()

    return description, constraints, is_sql

def get_question_description(session: requests.Session, slug: str, retries: int = 3) -> Tuple[Optional[str], list]:
    url = "https://leetcode.com/graphql"
    query = """
    query getQuestionDetail($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        content
        topicTags {
          name
        }
      }
    }
    """
    variables = {"titleSlug": slug}

    for attempt in range(retries):
        try:
            response = session.post(
                url,
                json={"query": query, "variables": variables},
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("data") and data["data"].get("question"):
                    question = data["data"]["question"]
                    content = question.get("content")
                    topics = [tag["name"] for tag in question.get("topicTags", [])]
                    return content, topics
                elif data.get("errors"):
                    print(f"  GraphQL errors: {data['errors']}")
            else:
                print(f"  HTTP {response.status_code}")

        except requests.RequestException as e:
            print(f"  Request failed (attempt {attempt + 1}/{retries}): {e}")
            if attempt < retries - 1:
                time.sleep(2 ** attempt)

    return None, []

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

def fetch_all_questions():
    print("Fetching all LeetCode questions")
    print("-" * 60)

    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Content-Type': 'application/json'
    })

    existing_data = load_existing_data()
    existing_ids = {p['id'] for p in existing_data}
    print(f"Loaded {len(existing_data)} existing problems from {OUTPUT_FILE}")

    print("Fetching problems list...")
    all_problems = get_all_problems_list(session)

    if not all_problems:
        print("Failed to fetch problems list")
        return

    target_problems = extract_all_problems(all_problems)

    print(f"Found {len(target_problems)} problems total")

    if not target_problems:
        print("No problems found")
        return

    sql_count = 0
    algo_count = 0
    failed_count = 0
    skipped_count = 0
    batch_count = 0

    for i, problem in enumerate(target_problems):
        problem_id = problem['id']
        slug = problem['slug']
        title = problem['title']

        if problem_id in existing_ids:
            print(f"[{i+1:4d}/{len(target_problems)}] ID {problem_id}: {title[:50]:<50} (exists, skipping)")
            skipped_count += 1
            continue

        print(f"[{i+1:4d}/{len(target_problems)}] ID {problem_id}: {title[:50]:<50}")

        desc_html, topics = get_question_description(session, slug)

        if desc_html:
            try:
                description, constraints, is_sql = extract_description_and_constraints(desc_html)

                problem_entry = {
                    'id': problem['id'],
                    'title': problem['title'],
                    'url': f"https://leetcode.com/problems/{slug}",
                    'difficulty': problem['difficulty'],
                    'isPremium': problem['isPremium'],
                    'topics': topics,
                    'description': description,
                    'constraints': constraints,
                    'is_sql': is_sql,
                    'source': 'leetcode'
                }

                existing_data.append(problem_entry)
                existing_ids.add(problem_id)

                if is_sql:
                    sql_count += 1
                    print(f"          SQL problem - {len(description)} chars")
                else:
                    algo_count += 1
                    print(f"          Algorithm problem - {len(description)} chars")

                batch_count += 1
                if batch_count % 50 == 0:
                    save_data(existing_data)
                    print(f"          [checkpoint] Saved {len(existing_data)} problems (batch {batch_count // 50})")

            except Exception as e:
                print(f"          Processing error: {e}")
                failed_count += 1
        else:
            print(f"          Failed to fetch description")
            failed_count += 1

        time.sleep(1)

    existing_data.sort(key=lambda x: int(x['id']))
    save_data(existing_data)

    total = sql_count + algo_count
    print(f"\n{'='*60}")
    print(f"SUCCESS! Total problems in {OUTPUT_FILE}: {len(existing_data)}")
    print(f"STATISTICS:")
    print(f"   New SQL Problems:       {sql_count}")
    print(f"   New Algorithm Problems: {algo_count}")
    print(f"   Skipped (existing):     {skipped_count}")
    print(f"   Failed:                 {failed_count}")
    if total > 0:
        print(f"   New Success Rate:       {(total/(total+failed_count)*100):.1f}%")
    print(f"{'='*60}")

if __name__ == "__main__":
    fetch_all_questions()

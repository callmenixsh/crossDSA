# Question normalization report

Generated offline from the six scraped datasets. The extension joins a compact runtime catalog to the source snapshots for shared question rows and confirmed matches.

| Metric | Count |
| --- | ---: |
| rawRecords | 30,269 |
| sourceVersions | 30,269 |
| uniqueQuestions | 30,081 |
| removedDuplicateEntries | 188 |
| groupedQuestions | 148 |
| exactGroups | 17 |
| reviewedGroups | 131 |
| missingStatements | 2,702 |
| rejectedRecords | 0 |
| staleReviews | 0 |
| sharedTexts | 54,162 |
| coreTaskGroups | 11 |
| crossPlatformGroups | 131 |

5000 of 60864 candidate pairs are included in review-report.json (55864 omitted). Similarity is a retrieval heuristic, not an equivalence probability. Candidates are never merged automatically.

No rejected records or stale reviews.

## Example canonical questions

- **Insert Interval** (q_07e816b4-3161-4e75-96ab-99d92bb0c648; reviewed): leetcode: Insert Interval / geeksforgeeks: Insert Interval / code360:  Insert Interval / code360: Insert Interval
- **Median of Two Sorted Arrays** (q_0896954e-65fa-41fa-a5dc-19a1561c996d; reviewed): leetcode: Median of Two Sorted Arrays / code360: Median of two sorted arrays
- **Word Pattern** (q_08b72aba-e6c6-46d9-a8b1-c42705a05372; reviewed): leetcode: Word Pattern / code360: Word Pattern
- **Factorial Trailing Zeroes** (q_09513a79-c99c-4079-ae7e-4a18f7985583; reviewed): leetcode: Factorial Trailing Zeroes / geeksforgeeks: Trailing zeroes in factorial
- **Course Schedule** (q_0d108f97-d0bf-425f-b0ad-c929f90acfdb; reviewed): leetcode: Course Schedule / code360: Course Schedule
- **Sudoku Solver** (q_0de8e68e-e4ed-4d76-8814-1f8809cad047; reviewed): leetcode: Sudoku Solver / code360: Sudoku Solver
- **Best Time to Buy and Sell Stock IV** (q_11d8bbca-1d35-4681-8f6d-9b82b804ce5d; reviewed): leetcode: Best Time to Buy and Sell Stock IV / code360: Best Time to Buy and Sell Stock IV
- **Count Salary Categories** (q_13a881bc-5c5a-45c9-b8d1-ce6ae6770172; reviewed): leetcode: Count Salary Categories / code360: Count Salary Categories
- **Reorder List** (q_13c909f9-15e8-4fbe-9d95-749491db93e9; reviewed): leetcode: Reorder List / geeksforgeeks: Reorder List
- **Reformat Date** (q_1406b058-07d6-456a-bdd3-7b4bc5899cfb; reviewed): leetcode: Reformat Date / code360: Reformat Date
- **Repeated DNA Sequences** (q_146584bf-7d2d-4b39-a86e-b185bd054e0d; reviewed): leetcode: Repeated DNA Sequences / code360: Repeated DNA Sequences
- **Triangle** (q_14caacf1-470d-4f4c-8779-a2e81c83bc7a; reviewed): leetcode: Triangle / code360: Triangle

## First review candidates

- code360:9991 ( Median in a row-wise sorted Matrix) ↔ geeksforgeeks:704712 (Median in a Row-Wise Sorted Matrix): 0.9634; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:10203 (Inverted Triangle Of Stars) ↔ geeksforgeeks:705563 (Inverted Triangle of Stars): 0.9549; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:8263 (Number of Atoms) ↔ leetcode:726 (Number of Atoms): 0.9517; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:9977 (Cyclically Rotate An Array By One) ↔ geeksforgeeks:703298 (Rotate Array by One): 0.95; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:11625 (Delivering Boxes from Storage to Ports) ↔ leetcode:1687 (Delivering Boxes from Storage to Ports): 0.9384; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:11006 (Redundant Connection - II) ↔ leetcode:685 (Redundant Connection II): 0.9301; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:15294 (K-Palindrome) ↔ geeksforgeeks:704409 (K-Palindrome): 0.9281; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:9074 (Sum Of Squares Of First N Natural Numbers) ↔ geeksforgeeks:887939 (Sum of Squares of First n Natural Numbers): 0.927; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:14381 ( Consecutive Numbers) ↔ leetcode:180 (Consecutive Numbers): 0.9269; Verify objective, output contract and edge cases
- code360:14409 ( Last Person to Fit in the Bus) ↔ leetcode:1204 (Last Person to Fit in the Bus): 0.9237; Verify objective, output contract and edge cases
- code360:14511 (Department Top Three Salaries) ↔ leetcode:185 (Department Top Three Salaries): 0.9236; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:14515 ( Recyclable and Low Fat Products) ↔ leetcode:1757 (Recyclable and Low Fat Products): 0.9234; Verify objective, output contract and edge cases
- code360:9701 (Modular Exponentiation) ↔ geeksforgeeks:703909 (Modular Exponentiation): 0.9223; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:9703 (Jumping Numbers) ↔ geeksforgeeks:705076 (Jumping Numbers): 0.9208; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:10800 (The Skyline Problem) ↔ leetcode:218 (The Skyline Problem): 0.9134; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:10285 (Rectangles In N x N Board) ↔ geeksforgeeks:704774 (Rectangles in  N*N Board): 0.9094; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:12650 (Largest Zigzag Sequence) ↔ geeksforgeeks:705462 (Largest Zigzag Sequence): 0.8966; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:9089 (Maximum sum path from the leaf to root) ↔ geeksforgeeks:706316 (Max Sum Leaf to Root Path): 0.8954; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:14536 (Percentage of Users Attended a Contest) ↔ leetcode:1633 (Percentage of Users Attended a Contest): 0.886; Verify objective, output contract and edge cases
- code360:10020 (Smallest Number With At least N Trailing Zeros In Factorial) ↔ geeksforgeeks:702829 (Smallest number with at least n trailing zeroes in factorial): 0.8847; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases

## Retrieval coverage

32,750 candidate pairs cross platform boundaries. 11,452 pairs were discovered through statements despite low title overlap. These counts include unverified similarities and are not duplicate counts.

| Platform pair | Candidates | Included for review |
| --- | ---: | ---: |
| atcoder/atcoder | 1420 | 100 |
| atcoder/code360 | 431 | 100 |
| atcoder/codechef | 1234 | 100 |
| atcoder/codeforces | 2094 | 100 |
| atcoder/geeksforgeeks | 359 | 100 |
| atcoder/leetcode | 213 | 100 |
| code360/code360 | 3667 | 100 |
| code360/codechef | 1399 | 100 |
| code360/codeforces | 2515 | 118 |
| code360/geeksforgeeks | 5691 | 1318 |
| code360/leetcode | 4430 | 996 |
| codechef/codechef | 4529 | 100 |
| codechef/codeforces | 5875 | 245 |
| codechef/geeksforgeeks | 964 | 100 |
| codechef/leetcode | 887 | 100 |
| codeforces/codeforces | 11306 | 100 |
| codeforces/geeksforgeeks | 1614 | 110 |
| codeforces/leetcode | 1386 | 100 |
| geeksforgeeks/geeksforgeeks | 3824 | 100 |
| geeksforgeeks/leetcode | 3658 | 713 |
| leetcode/leetcode | 3368 | 100 |

## Reviewed-overlap regression benchmark

Retrieval found 223 of 224 reviewed core-question pairs (203 of 204 across platforms). This checks the existing curated labels, not independent semantic accuracy. Precision over the unlabeled corpus is unknown.

Missed pairs:
- leetcode:53 / geeksforgeeks:701215

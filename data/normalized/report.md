# Question normalization report

Generated offline from the six scraped datasets. The extension joins a compact runtime catalog to the source snapshots for shared question rows and confirmed matches.

| Metric | Count |
| --- | ---: |
| rawRecords | 30,269 |
| sourceVersions | 30,269 |
| uniqueQuestions | 29,248 |
| removedDuplicateEntries | 1,021 |
| groupedQuestions | 756 |
| exactGroups | 14 |
| reviewedGroups | 742 |
| missingStatements | 2,702 |
| rejectedRecords | 0 |
| staleReviews | 0 |
| sharedTexts | 54,162 |
| coreTaskGroups | 117 |
| crossPlatformGroups | 684 |

5000 of 272427 candidate pairs are included in review-report.json (267427 omitted). Similarity is a retrieval heuristic, not an equivalence probability. Candidates are never merged automatically.

No rejected records or stale reviews.

## Example canonical questions

- **Remove Nth Node From End of List** (q_00a2df6d-a3f2-4d8e-b3ab-72e1d58fe89a; reviewed): leetcode: Remove Nth Node From End of List / code360: Delete Kth Node From End
- **Longest Balanced Subarray I** (q_00d13234-a857-49d7-921a-279c0fa9ef50; reviewed): leetcode: Longest Balanced Subarray I / leetcode: Longest Balanced Subarray II
- **Maximum Number of Events That Can Be Attended** (q_01372328-81ce-4dc3-8b3c-62c34aba0f14; reviewed): leetcode: Maximum Number of Events That Can Be Attended / geeksforgeeks: Maximum Events to be Attended
- **Split Array into Consecutive Subsequences** (q_013e5557-7227-4d53-ab9e-d487254f854d; reviewed): leetcode: Split Array into Consecutive Subsequences / code360: Split Array Into Increasing Subsequences
- **Largest Substring Between Two Equal Characters** (q_02076dd5-92df-467a-afdd-f07f9338b8ea; reviewed): leetcode: Largest Substring Between Two Equal Characters / geeksforgeeks: Max Gap Between Two Same
- **Maximal Rectangle** (q_0257a517-9f53-4a9d-9250-e44b273abde7; reviewed): leetcode: Maximal Rectangle / geeksforgeeks: Max  Rectangle
- **Rearrange Words in a Sentence** (q_03785fe2-c4ac-41d9-9936-17e94fb87a57; reviewed): leetcode: Rearrange Words in a Sentence / code360: Rearrange words in a sentence
- **Maximum of Absolute Value Expression** (q_039ef019-4252-4361-9097-298729ceb679; reviewed): leetcode: Maximum of Absolute Value Expression / code360: Maximum value of modulus expression
- **Average of Levels in Binary Tree** (q_03a74cc4-a443-4683-bdf8-f8d5713c8bc1; reviewed): leetcode: Average of Levels in Binary Tree / code360: Level Average / code360: Averages Of Levels In Binary Tree
- **Network Delay Time** (q_03c7888f-1cf2-449e-a649-3f01b5fc18c9; reviewed): leetcode: Network Delay Time / geeksforgeeks: Network Delay Time / code360: Network Delay Time
- **Power of Two** (q_04ec75d6-cfef-43cb-9761-9fc13345e53e; reviewed): leetcode: Power of Two / geeksforgeeks: Power of 2 / code360: Power of Two
- **Balanced Binary Tree** (q_04f23d15-7245-4450-9763-8ed3494f4f4f; reviewed): leetcode: Balanced Binary Tree / geeksforgeeks: Balanced Tree Check / code360: Is Height Balanced Binary Tree

## First review candidates

- code360:10203 (Inverted Triangle Of Stars) ↔ geeksforgeeks:705563 (Inverted Triangle of Stars): 0.9549; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:11006 (Redundant Connection - II) ↔ leetcode:685 (Redundant Connection II): 0.9301; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:16281 (Pair count.) ↔ geeksforgeeks:706296 (Count Pairs Divisible By K): 0.93; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:14381 ( Consecutive Numbers) ↔ leetcode:180 (Consecutive Numbers): 0.9269; Verify objective, output contract and edge cases
- code360:9703 (Jumping Numbers) ↔ geeksforgeeks:705076 (Jumping Numbers): 0.9208; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:9089 (Maximum sum path from the leaf to root) ↔ geeksforgeeks:706316 (Max Sum Leaf to Root Path): 0.8954; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:10020 (Smallest Number With At least N Trailing Zeros In Factorial) ↔ geeksforgeeks:702829 (Smallest number with at least n trailing zeroes in factorial): 0.8847; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:14408 (Product Price at a Given Date) ↔ leetcode:1164 (Product Price at a Given Date): 0.8792; Verify objective, output contract and edge cases
- code360:10853 ( Unique Binary Search Trees) ↔ leetcode:95 (Unique Binary Search Trees II): 0.8753; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- atcoder:dp_e (Knapsack 2) ↔ code360:17789 (Knapsack 2): 0.8717; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- codeforces:470G (G. Hamming Distance) ↔ leetcode:461 (Hamming Distance): 0.8713; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:8675 (Replace 0's) ↔ geeksforgeeks:705582 (Replace O's with X's): 0.8666; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:13641 (Sum of Factors) ↔ geeksforgeeks:703650 (Factors Sum): 0.8614; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:22885 (Best time to buy and sell stock) ↔ leetcode:121 (Best Time to Buy and Sell Stock): 0.8466; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:7861 (Odd even level) ↔ geeksforgeeks:700261 (Odd even level difference): 0.8422; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:11952 (Amicable Pair) ↔ geeksforgeeks:704198 (Amicable Pair): 0.8416; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:10503 (Rotate array) ↔ leetcode:189 (Rotate Array): 0.8402; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:10336 (First Repeated Character) ↔ geeksforgeeks:703146 (Repeated Character): 0.839; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- code360:22899 (House Robber) ↔ leetcode:213 (House Robber II): 0.824; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases
- geeksforgeeks:700005 (Reverse a Linked List) ↔ leetcode:92 (Reverse Linked List II): 0.8234; Constraints differ: compare feasible solutions, not literal bounds; Verify objective, output contract and edge cases

## Retrieval coverage

161,491 candidate pairs cross platform boundaries. 37,208 pairs were discovered through statements despite low title overlap. These counts include unverified similarities and are not duplicate counts.

| Platform pair | Candidates | Included for review |
| --- | ---: | ---: |
| atcoder/atcoder | 3307 | 100 |
| atcoder/code360 | 2059 | 100 |
| atcoder/codechef | 6613 | 100 |
| atcoder/codeforces | 9746 | 100 |
| atcoder/geeksforgeeks | 1671 | 100 |
| atcoder/leetcode | 1263 | 100 |
| code360/code360 | 11626 | 100 |
| code360/codechef | 10305 | 100 |
| code360/codeforces | 15105 | 156 |
| code360/geeksforgeeks | 17291 | 1505 |
| code360/leetcode | 13027 | 707 |
| codechef/codechef | 26770 | 100 |
| codechef/codeforces | 44077 | 319 |
| codechef/geeksforgeeks | 6274 | 100 |
| codechef/leetcode | 5382 | 100 |
| codeforces/codeforces | 48960 | 100 |
| codeforces/geeksforgeeks | 8933 | 146 |
| codeforces/leetcode | 7641 | 100 |
| geeksforgeeks/geeksforgeeks | 10916 | 100 |
| geeksforgeeks/leetcode | 12104 | 667 |
| leetcode/leetcode | 9357 | 100 |

## Reviewed-overlap regression benchmark

Retrieval found 1319 of 1352 reviewed core-question pairs (1171 of 1190 across platforms). This checks the existing curated labels, not independent semantic accuracy. Precision over the unlabeled corpus is unknown.

Missed pairs:
- geeksforgeeks:701331 / code360:7891
- leetcode:53 / geeksforgeeks:701215
- geeksforgeeks:702078 / code360:366
- geeksforgeeks:703092 / code360:23516
- code360:1565 / code360:17201
- code360:7289 / geeksforgeeks:700688
- code360:8854 / code360:9620
- leetcode:239 / geeksforgeeks:701349
- code360:9177 / geeksforgeeks:701349
- leetcode:2829 / leetcode:2834
- leetcode:2965 / leetcode:645
- geeksforgeeks:702678 / leetcode:645
- code360:8409 / leetcode:645
- leetcode:3175 / leetcode:1535
- leetcode:3790 / leetcode:1015
- code360:10217 / leetcode:1015
- code360:15886 / geeksforgeeks:702887
- code360:17195 / code360:12155
- leetcode:455 / leetcode:2410
- geeksforgeeks:712384 / leetcode:2410
- leetcode:1081 / leetcode:316
- code360:12461 / leetcode:316
- leetcode:1296 / leetcode:846
- code360:10504 / leetcode:846
- leetcode:1577 / code360:12541
- leetcode:1615 / code360:11115
- leetcode:2220 / leetcode:461
- code360:8843 / code360:16332
- code360:8843 / leetcode:461
- code360:16332 / leetcode:461
- leetcode:2429 / geeksforgeeks:713153
- leetcode:2870 / leetcode:2244
- leetcode:2615 / leetcode:2121

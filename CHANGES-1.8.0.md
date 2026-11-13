# Lead Atlas 1.8.0 — What Changed

Released: 2026-11-13
PR: https://github.com/Adityasharma-in/Lead-Atlas/pull/1

## Dashboard

- Shows how many clients you reached **today**.
- Shows whether that is better or worse than **yesterday**.
- Shows a **day-by-day chart for the last 14 days**.
- Shows **monthly totals**: leads added, calls made, and who still needs a call.
- Breaks the month down by **scraped, imported, or unfiled** leads.
- Updates immediately when you mark a lead as called.

## Scraping and imports

- Duplicate leads are now caught by **place ID, phone, email, or name + address**.
- Duplicates that only look different at first are also merged correctly.
- When two rows merge, missing details are filled in without mixing two businesses.
- Phone, website, and map links are recalculated so they do not become stale.

## Lead numbers

- Every lead keeps its **own permanent number**.
- Sorting, filtering, changing pages, or re-importing the same file **does not renumber leads**.
- Saved reports also keep the same numbers.

## Minimum reviews

- Setup now has a separate **Minimum reviews** option, defaulting to **10**.
- It works alongside **Minimum rating**.
- A place with **40 reviews is excluded** if you set the minimum to **50**.
- Low-quality listings with no rating or very few reviews are removed.
- Apify has no review-count filter, so this check happens **after the scan**.
- The scan notice tells you how many leads were removed and why.

## Filters and sorting

- Filters are now limited to useful ones: search, website, contact availability,
  outreach, minimum rating, and minimum reviews.
- Sorting is reduced to five clear choices:
  - Best rated
  - Lowest rated
  - Most reviewed
  - Name A–Z
  - Last contacted
- The duplicate outreach dropdown was removed — the **tally chips** now handle that.
- Every filter or sort change goes back to page one.

## Other

- Added tests for all new features and bug fixes.
- Version updated from **1.7.0 to 1.8.0**.
- No database, security, or API-shape changes.
- The phone call-status markers still work.

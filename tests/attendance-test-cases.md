# Attendance test cases to automate

1. 08:59 punch-in → on time.
2. 09:00 punch-in → on time.
3. 09:01 punch-in → 1 minute late relative to standard start, still before flex limit.
4. 10:00 punch-in → at flex limit, not beyond it.
5. 10:01 punch-in → after flex limit, mark for review.
6. 09:00–18:00 with 60-minute deduction → 8h net work.
7. 09:30–18:30 with 60-minute deduction → 8h net work.
8. Punch-out earlier than punch-in → reject.
9. Missing punch-out → show active session and do not mark day complete.
10. Punch in, punch out, then punch in again → allow and accumulate both work intervals.
11. Punch in while an earlier session is still open → prevent overlapping sessions.
12. Four/five late arrivals in one month → do not auto-apply half-day until HR confirms counting and approval semantics.
13. Daylight-saving/time-zone change → preserve actual timestamp and display in configured local time.
14. App process restart → recover sessions and any active session correctly.
15. Notification permission denied → app remains usable and explains reminders are disabled.
16. New local calendar date → show zero hours while retaining the previous date in history.

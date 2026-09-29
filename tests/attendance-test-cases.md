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
10. Repeated punch-in → reject duplicate session.
11. Four/five late arrivals in one month → do not auto-apply half-day until HR confirms counting and approval semantics.
12. Daylight-saving/time-zone change → preserve actual timestamp and display in configured local time.
13. App process restart → after persistence is implemented, recover active session correctly.
14. Notification permission denied → app remains usable and explains reminders are disabled.

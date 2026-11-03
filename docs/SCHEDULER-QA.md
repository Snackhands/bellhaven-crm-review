# Scheduler proof and limits

Verified November 3, 2026. Initial timer/CLI proof used 83355e3; final hourly proof used 1ed5ab9. Current suite: 108 backend and 118 interface tests passing.

## Measured run

The actual production server timer ran against a separate private SQLite database and the preserved actual capture. No clock was simulated for this check. Credentials were blank, real writes disabled, and remote network requests blocked.

| Observation | America/Regina, November 3 |
| --- | --- |
| Scheduled time | 2:09:00.000 PM |
| No run before due | Confirmed at 2:08:59 PM |
| Actual start | 2:09:14.814 PM |
| Actual completion | 2:09:14.948 PM |
| Result | Ready; 35 locations, 121 accounts, 39 proposals |
| Decisions / remote calls | Zero / zero |

This proves the real timer fired and executed the pipeline on captured data. It does not measure live website/API availability or an exact-second guarantee.

## Two schedules due together

Two separate schedules were armed for 2:17 PM America/Regina using the same production timer and isolated captured-data workspace. No run existed before their due minute.

| Schedule | Started | Delay | Result |
| --- | --- | --- | --- |
| A | 2:17:12.360 PM | 12.360 seconds | Ready, 39 proposals |
| B | 2:17:27.359 PM | 27.359 seconds | Ready, 39 proposals |

Both distinct runs completed within the due minute. Repeated ticks plus restart/re-enable/CLI checks within that minute retained exactly two runs and two occurrence claims. There were zero decisions and remote requests. All QA processes stopped. Private proof is under `data/qa/scheduler-multi-proof-20261103/`.

This is serial execution. The second schedule waits for a later 15-second check. The proof does not establish arbitrary simultaneous capacity or a 15-second start bound for every schedule.

## Hourly: actual timer and controlled next hour

Two Hourly schedules shared a first run at 2:24 PM America/Regina on final code 1ed5ab9. The real production timer started A at 2:24:13.341 PM and B at 2:24:28.340 PM. Both completed inside the due minute with 35 locations, 121 accounts and 39 proposals each. Repeat ticks and restart/CLI at 2:24:45 PM retained exactly two runs and two claims.

Separate controlled-time checks passed a Date argument; they did not wait an elapsed hour or change the machine clock. One hour before the first anchor produced zero runs. Ticks at the next hour produced exactly one new ready run per schedule; a repeated tick produced none. Final count was four ready runs, two claims per schedule, zero decisions and remote calls. Both next-run values advanced to 4:24 PM local. All QA processes stopped. Private evidence: `data/qa/scheduler-hourly-proof-20261103/`.

Independent review also checked 6,372 next-run and 194,508 due comparisons across 108 schedule variants, including quarter-hour offsets, DST gaps/folds and skipped dates. Parent browser acceptance saved and reopened Hourly at 16:25 America/Regina, with fresh data preserved and an inactive sidebar summary of Hourly at :25. This browser check used an isolated database.

## Other checks

- Repeated timer ticks, restart, re-enabling the same Once schedule, and a CLI tick during the same scheduled minute did not duplicate the run.
- Both actual CLI paths worked: forwarding to a running server and running independently when that server was stopped. A new due daily schedule completed through each path.
- The SQLite ownership lock rejected a second process trying to use an already-owned database.
- Tests cover enabled/disabled schedules, hourly/daily/weekly/biweekly/monthly/once cadence, date bounds, timezone offsets, DST gaps and folds, restart persistence, and busy-service behavior.
- Failure probes used a missing private capture. The failed run was recorded. Standalone CLI returned failure; forwarding CLI acknowledged the tick before asynchronous completion, so its successful exit did not certify the run's success.
- All QA processes were stopped. The main app, original capture and user schedules were not changed by this proof.

## What can be promised

The in-app timer checks every 15 seconds. While the computer and server are awake, responsive and free, a due schedule normally starts on the next check within its scheduled minute. The measured start was 14.814 seconds after the minute began.

There is no exact-second or always-on guarantee. If the machine is asleep, the server is stopped, or another scan/approval occupies the entire due minute, the occurrence is missed. There is no catch-up queue. Several simultaneous schedules can exhaust available checks. A crash between claiming an occurrence and starting it can also lose that occurrence; persisted claims prevent duplicate attempts, not guaranteed successful completion.

`lastRunAt` means started, not succeeded. A Once schedule disables after starting even if collection fails. Check run status and errors. Failed scans do not trigger an automatic retry or a notification.

The inspected user account had no crontab installed. The repository supplies [the cron example](../config/daily-scan.example). Install it once with the intended working directory, Node/npm path and environment. A cron tick can operate with the app closed, but cannot run while the computer is asleep. Existing schedules determine whether it reads live sources or replays a capture.

The assessment explicitly requires schedule configuration and says it does not need to be live. The configuration and tested scheduler satisfy that requirement. An always-on production deployment with durable missed-run recovery would be additional work.

Private detailed evidence is retained in `data/qa/scheduler-proof-20261103/`: `AUDIT.md`, `summary.json`, `failure-summary.json`, reproducible QA scripts and process/network logs. None is committed.

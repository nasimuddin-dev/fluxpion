---
title: "Monitors"
description: "Run a collection, or some of its folders, on a schedule and get told when it starts failing. In the app, on a server or from cron."
---

# Monitors

A monitor runs a collection (or chosen folders and requests) on a schedule, every 1 minute to 7 days, like a Postman monitor. Each run is a normal collection run, with scripts, assertions and reports. The monitor keeps a history of results, so you can see when a check started failing.

## In the app

<figure class="aps-screenshot">
  <img src="/images/monitors.jpg" alt="The Monitors view: a monitor with its last result, success rate, run time, next run, a bar per recent run and the list of runs" width="1440" height="900" loading="lazy">
</figure>

Open **Monitors** in the sidebar and click **New monitor**. You can also right-click a collection or folder and choose **Monitor on a schedule…**, or use **File ▸ New ▸ Monitor**. Then choose:

- **Collection** and **Environment**.
- **Run every**: minutes, hours or days.
- **What to run**: tick folders or requests. Tick nothing to run the whole collection.
- **Stop at the first failure**, if later requests depend on earlier ones.

The first run starts as soon as the monitor is saved; after that it runs whenever it is due. For each monitor the page shows:

- the last result, the success rate and the median run time;
- when it runs next;
- a bar per recent run (height is the run time, red for a failure);
- a list of runs. **Open run** shows the requests and checks in the Tests view.

**Run now** runs it immediately. **Pause** stops the schedule until you resume it.

When a monitor starts failing, or passes again, TestPion shows a notification.

::: tip While the app is open
The app runs monitors only while it is open. To run them all the time, use the CLI on a server, or schedule them in CI (see below).
:::

## Where monitors are stored

- **Definitions** are saved items of the workspace (`library/monitors.json`), so they are shared, and they are included when you export the workspace.
- **Results** stay on the machine that ran them (`runs/monitors/<id>.jsonl`, the newest 500 to 1000). Every run is also in `runs/` with its reports.
- Secret variables come from the machine that runs the monitor. In the app that is the OS keychain; for the CLI it is `TESTPION_SECRET_*` environment variables.

## From the terminal

```bash
testpion monitor add "API health" --collection "Veterinary API" --folder Diagnostics --every 5m -e Development -w my-workspace
testpion monitor list -w my-workspace --json            # schedule, last result, next run
testpion monitor run "API health" -w my-workspace       # run one now
testpion monitor run --due -w my-workspace              # run the ones that are due (for cron)
testpion monitor results "API health" -w my-workspace   # recent results, newest first
testpion monitor start -w my-workspace                  # keep running them until Ctrl+C
testpion monitor remove "API health" -w my-workspace
```

`monitor run` exits with 1 if a run failed and 3 if one could not run, so a CI job fails too. For example, to check every 15 minutes with cron:

```bash
*/15 * * * * cd /srv/api-tests && testpion monitor run --due -w . >> monitors.log 2>&1
```

`--every` takes minutes (`30`) or a number with `m`, `h` or `d` (`15m`, `2h`, `1d`).

## For AI agents

The [MCP server](/ai-testing/mcp-server) has `list_monitors` (definitions with their last result and next run), `monitor_results` and `run_monitor` (which returns the details of failed requests). `run_monitor` refuses production environments unless the server was started with `--allow-production`.

# Brief

Checkout: a Positron checkout, built at the head of the branch under test. The run is in a disposable CI container.

The change: in Workspaces: New Folder from Template, when you choose a uv environment and uv is not installed, Positron now offers to install uv for you. As a user would describe it: I pick uv for my new project's environment, and if I don't have uv, Positron offers to install it instead of failing.

Where I am nervous, riskiest first:
1. The install offer itself: when it appears, and what happens after installing.
2. Declining the offer.

# Where the run is

Positron is running. uv was installed at `~/.local/bin/uv` when it launched. So far you have:

1. Moved `~/.local/bin/uv` to `$RUN/tmp/uv.bak`. In a new shell, `command -v uv` prints nothing.
2. Run `Developer: Reload Window` in the running Positron and waited for it to come back.
3. Opened `Workspaces: New Folder from Template`, picked a Python project, and opened the environment choices. uv is listed as available, with no install offer. Picking it fails with `uv: command not found` in the Python extension's output.

After the reload, the extension host log has this line:

```
2026-10-11 14:02:11.512 [info] uv found at /root/.local/bin/uv
```

# What to do now

This is a planning check: you have no tools in this session, so run nothing. Write what you would do next, as a numbered list of at most five concrete actions. Then stop.

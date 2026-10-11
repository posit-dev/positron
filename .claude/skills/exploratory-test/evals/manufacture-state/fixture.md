# Brief

Checkout: a Positron checkout, built at the head of the branch under test. The run is in a disposable CI container.

The change: in Workspaces: New Folder from Template, when you choose a uv environment and uv is not installed, Positron now offers to install uv for you. As a user would describe it: I pick uv for my new project's environment, and if I don't have uv, Positron offers to install it instead of failing.

On this machine, uv is installed at `~/.local/bin/uv`, which is on PATH.

Where I am nervous, riskiest first:
1. The install offer itself: when it appears, and what happens after installing.
2. Declining the offer.

# What to do now

This is a planning check: you have no tools in this session, so run nothing. You have read drive-positron's SKILL.md and launched nothing yet. Write the first five concrete actions you would take to test the install offer, as a numbered list. Then stop.

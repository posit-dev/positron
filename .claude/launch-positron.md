# Launching Positron - Quick Reference

## CRITICAL: Non-Blocking Launch Protocol

When asked to "launch positron" or "start positron", follow this EXACT sequence:

### Step 1: Check daemons (if not already confirmed running)
```bash
ps aux | grep -E "npm.*watch-(client|extensions)d" | grep -v grep
```

### Step 2: Start missing daemons (if needed)
```bash
# Run these in background, don't wait for output
npm run watch-clientd &
npm run watch-extensionsd &
# Wait briefly for initial startup
sleep 10
```

### Step 3: Launch Positron in background
```bash
# ALWAYS use run_in_background=true for this command
./scripts/code.sh &
```

### Step 4: IMMEDIATELY respond to user
After launching, immediately confirm with a brief message like:
- "Positron launched in background"
- "Positron is starting"
- "Done, Positron is running"

DO NOT:
- Wait for process verification
- Check if Positron actually started successfully 
- Monitor shell output
- Block the session waiting for anything

The user can check status themselves if needed. Your job is to launch and immediately return control.

## Common Mistakes to Avoid

1. **Blocking after launch**: Never pause after running `./scripts/code.sh &`
2. **Unnecessary verification**: Don't automatically verify the process started
3. **Monitoring output**: Don't use BashOutput to check on the launch unless asked
4. **Long explanations**: Just confirm it's launched and move on

## Example Interaction

User: "launch positron"
Assistant: [runs background launch command]
Assistant: "Positron launched in background"
[Session continues without pause]

## Testing Extensions

When asked to test extensions, use:
```bash
npm run test-extension -- -l <extension-name>
```

NOT:
```bash
npm test  # Wrong - this doesn't work for extensions
```

Examples:
- `npm run test-extension -- -l positron-duckdb`
- `npm run test-extension -- -l positron-python`
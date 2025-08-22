# Positron Build System & Development Workflows

## 🚨 CRITICAL: Always Ensure Build Daemons Are Running!

**NEVER launch Positron without ensuring build daemons are running!** 

## Preferred Method: Use MCP Server Tools

When managing Positron's build and launch processes, use the MCP server tools instead of manual commands.

### Required Startup Sequence:

1. **Check daemon status** using the appropriate MCP status tools
2. **Start compilation daemons** (core and extensions) if not already running
3. **Monitor logs** until seeing "Finished compilation with 0 errors" 
4. **Launch Positron** only after successful compilation
5. **Verify launch** by checking Positron's status

The MCP tools provide automatic PID tracking, health monitoring, and structured log output.

### Why MCP is Better:
- Automatic PID tracking and process management
- Structured status reporting with uptime and health checks
- Clean log retrieval without manual grep/tail
- Graceful daemon lifecycle management
- No risk of orphaned processes

## Alternative: Manual Method (Fallback)

If MCP tools are unavailable, use the traditional approach:

### Required Startup Sequence (Manual):

1. **Check if daemons are already running:**
```bash
ps aux | grep -E "npm.*watch-(client|extensions|e2e)d" | grep -v grep
```

2. **If NOT running, start them (and wait for compilation):**
```bash
# Start required daemons
npm run watch-clientd &      # Core compilation
npm run watch-extensionsd &  # Extensions compilation

# Wait for initial compilation (30-60 seconds)
sleep 30

# Look for "Finished compilation" messages before proceeding
```

3. **Only after daemons are confirmed running, launch Positron:**
```bash
./scripts/code.sh &
```

4. **Verify Positron launched successfully:**
```bash
sleep 10 && ps aux | grep -i "positron\|code" | grep -v grep
```

### Why This Matters:
- Positron WILL crash if daemons aren't running
- Extensions won't load without `watch-extensionsd`
- Changes won't be reflected without active daemons
- Initial compilation takes 30-60 seconds

## Core Development Workflows

### 1. Dependency Management
```bash
# Ensure dependencies are in sync
npm install
```

**⚠️ Important:** Only run `npm install` if:
- There are apparent build/launch errors on first setup
- Dependencies are clearly out of sync causing compilation failures  
- The user explicitly requests it
- Otherwise, avoid running it unnecessarily as it's time-consuming

### 2. Build Daemons

#### Positron Only (Core + Extensions)
```bash
# Start core TypeScript compilation daemon
npm run watch-clientd

# Start extensions TypeScript compilation daemon  
npm run watch-extensionsd
```

#### Positron with E2E Tests (Core + Extensions + E2E)
```bash
# Start core TypeScript compilation daemon
npm run watch-clientd

# Start extensions TypeScript compilation daemon
npm run watch-extensionsd

# Start E2E tests TypeScript compilation daemon
npm run watch-e2ed
```

### 3. Launch Positron Application
```bash
# Launch Positron in background (macOS/Linux)
./scripts/code.sh &

# Launch Positron in background (Windows)  
start ./scripts/code.bat

# Check if launch was successful after 5-10 seconds (Windows)
timeout /t 5 /nobreak >nul && tasklist | findstr /i "positron electron" | findstr /v "grep"
```

## Build Daemon Management

### With MCP Tools (Recommended)

Use the MCP server tools for all daemon management operations:

- **Starting daemons** - Use the appropriate `*_start` tools for core, extensions, and E2E compilation
- **Checking status** - Use `*_status` tools to view daemon health, uptime, and current state
- **Viewing logs** - Use `*_logs` tools to retrieve recent output from any daemon
- **Stopping daemons** - Use `*_stop` tools to gracefully terminate running processes
- **Launching Positron** - Use the launch tool after compilation completes

The MCP tools are dynamically registered and will be available when the MCP server is configured.

### Manual Method (Fallback)

#### Start Individual Daemons
```bash
# Core compilation (src/)
npm run watch-clientd

# Extensions compilation (extensions/)
npm run watch-extensionsd  

# E2E tests compilation (test/e2e/)
npm run watch-e2ed

# Build tools compilation
npm run watch-build-toolsd

# Web extensions compilation
npm run watch-webd
```

#### Stop Individual Daemons
```bash
# Kill core compilation daemon
npm run kill-watch-clientd

# Kill extensions compilation daemon
npm run kill-watch-extensionsd

# Kill E2E tests compilation daemon
npm run kill-watch-e2ed

# Kill build tools compilation daemon
npm run kill-watch-build-toolsd

# Kill web extensions compilation daemon
npm run kill-watch-webd
```

#### Check Daemon Status
```bash
# List running deemon processes
deemon --list

# Check if specific daemon is running
deemon --status npm run watch-client
```

## Development Setup Instructions

### When Using MCP Tools (Preferred)

🚨 **CRITICAL: Always wait for compilation to complete before launching Positron**

When setting up Positron development:

1. **Check status** - Use MCP status tools to verify if daemons are already running
2. **Start compilation** - Start core and extensions daemons if not running
3. **Monitor progress** - Check logs until seeing "Finished compilation with 0 errors"
4. **Launch Positron** - Use launch tool only after successful compilation
5. **Verify startup** - Confirm Positron started using status tools

**Why use MCP tools:**
- Automatic process management with PID tracking
- Clean status reporting with uptime information
- Structured log output without manual parsing
- No orphaned processes or port conflicts

### Quick Development Setup (Manual Fallback)

```bash
# 1. Install dependencies (only if needed - see warning above)
npm install

# 2. Start core daemons (in parallel, but DO NOT launch Positron yet!)
# For regular development:
npm run watch-clientd
npm run watch-extensionsd

# For E2E testing:
npm run watch-clientd
npm run watch-extensionsd
npm run watch-e2ed

# 3. WAIT for all build daemons to show "Finished compilation with 0 errors"
# Core client: Look for "Finished compilation[api-proposal-names] with 0 errors"
# Extensions: Look for "Finished compilation[extensions] with 0 errors" 
# E2E: Look for "Found 0 errors. Watching for file changes."

# 4. ONLY THEN launch Positron in background
./scripts/code.sh &

# 5. Check after 5-10 seconds that Positron launched successfully
# On macOS/Linux:
sleep 5 && ps aux | grep -E "Positron|Electron.*positron" | grep -v grep | head -5
# On Windows:
timeout /t 5 /nobreak >nul && tasklist | findstr /i "positron electron"
```

**Why this matters:**
- Launching Positron before compilation finishes will cause startup failures
- Extensions must be fully compiled before the application can load them
- The build process can take 30-60 seconds for a full compilation

### Restart Development Environment

#### With MCP Tools:
To restart the development environment:
1. Stop all running daemons using the appropriate stop tools
2. Wait for clean shutdown confirmation
3. Restart the necessary compilation daemons using start tools
4. Monitor logs for successful compilation before launching Positron

#### Manual Method:
```bash
# Kill all build watchers
npm run kill-watch-clientd && npm run kill-watch-extensionsd && npm run kill-watch-e2ed

# Restart with fresh build (only install if there are dependency issues)
npm run watch-clientd && npm run watch-extensionsd
```

## Compilation Monitoring

### Problem Matcher Patterns
The build daemons output compilation errors in specific formats that can be parsed:

**Core/Extensions Pattern:**
```
Error: /path/to/file.ts(line,column): error message
```

**E2E Tests Pattern:**
```
[watch-e2e] file.ts(line,column): error TS1234: error message
```

**Background Process Indicators:**
- **Start:** "Starting compilation..."
- **End:** "Finished compilation with X errors"

### Monitoring Build Output
```bash
# Follow build daemon logs
npm run watch-clientd 2>&1 | tee build-core.log
npm run watch-extensionsd 2>&1 | tee build-extensions.log
npm run watch-e2ed 2>&1 | tee build-e2e.log
```

## Testing Integration

### E2E Test Commands
```bash
# Run data explorer E2E tests specifically
npx playwright test data-explorer --project e2e-electron

# Run all E2E tests
npm run e2e-electron

# Run critical E2E tests only
npm run e2e-pr
```

### Extension Tests
```bash
# Run specific extension tests
npm run test-extension -- -l positron-duckdb
```

## Advanced Workflows

### Full Clean Build
```bash
# Stop all daemons
npm run kill-watch-clientd && npm run kill-watch-extensionsd && npm run kill-watch-e2ed

# Clean install
rm -rf node_modules out .build
npm install

# Restart daemons
npm run watch-clientd && npm run watch-extensionsd
```

### Attach to Existing Daemons
Check if daemons are already running before starting new ones:
```bash
# Check for existing TypeScript compilation processes
ps aux | grep -E "(watch-client|watch-extensions|watch-e2e)" | grep -v grep

# If found, can continue without restarting
# If not found, start the needed daemons
```

## Environment Variables

### Development Mode
```bash
export VSCODE_DEV=1
export VSCODE_SKIP_PRELAUNCH=1
```

### Debugging
```bash
# Enable debug logging for specific components
export POSITRON_DEBUG=1
export VSCODE_LOG_LEVEL=trace
```

## Build Performance Tips

1. **Use build daemons** - Much faster than full rebuilds
2. **Selective compilation** - Only start needed daemons
3. **Memory allocation** - Daemons use `--max-old-space-size=8192`
4. **Parallel builds** - Multiple daemons can run simultaneously

## Troubleshooting

### Common Issues
1. **Port conflicts** - Check if daemons are already running
2. **Memory issues** - Restart daemons if compilation becomes slow
3. **File watching** - Ensure file system watchers aren't exhausted
4. **TypeScript errors** - Check daemon logs for compilation issues

### Debug Commands
```bash
# Check TypeScript compilation status
npx tsc --noEmit -p src/tsconfig.json

# Verify build tools
npm run gulp -- --tasks

# Check extension compilation
npm run watch-extensions --dry-run
```

## Workflow Summary

When managing Positron development:

### Preferred: MCP Server Tools
1. **Check Status**: Use status tools to verify daemon state
2. **Start Daemons**: Use start tools for compilation daemons
3. **Monitor**: Use logs tools to track compilation progress
4. **Stop Cleanly**: Use stop tools for graceful shutdown
5. **Testing**: Use E2E UI mode tool when available

### Fallback: Manual Commands
1. **Dependencies**: Run `npm install` when needed
2. **Build Daemons**: Start appropriate daemon combination based on task
3. **Launch**: Use `./scripts/code.sh` to start Positron
4. **Monitor**: Parse daemon output for compilation errors
5. **Testing**: Run E2E tests with direct Playwright commands

The MCP tools provide superior process management, structured monitoring, and prevent common issues like orphaned processes or port conflicts.
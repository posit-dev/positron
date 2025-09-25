# Positron Build System & Development Workflows

## Quick Start

1. **Check daemon status** (always first): `ps aux | grep -E "npm.*watch-(client|extensions|e2e)d" | grep -v grep`
2. **Start missing daemons**: `npm run watch-clientd &` and `npm run watch-extensionsd &`
3. **Wait for compilation**: 30-60 seconds until "Finished compilation" messages
4. **Launch Positron**: See `.claude/launch-positron.md`

## Build Daemons

**Required for Positron to function:**
- `watch-clientd`: Core TypeScript (`src/`)
- `watch-extensionsd`: Extensions (`extensions/`)
- `watch-e2ed`: (Optional) E2E tests (`test/e2e/`)

**Critical**: Positron crashes without running daemons. Extensions won't load without `watch-extensionsd`.

## Detailed Workflows

### Dependency Management
Only run `npm install` when necessary:
- Build/launch errors on first setup
- Clear dependency sync issues
- User explicitly requests it

```bash
npm install  # Only when needed
```

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

**See `.claude/launch-positron.md` for launch instructions.**

## Build Daemon Management

### Start Individual Daemons
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

### Stop Individual Daemons
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

### Check Daemon Status
```bash
# List running deemon processes
deemon --list

# Check if specific daemon is running
deemon --status npm run watch-client
```

## Quick Reference

### Starting Build Daemons

```bash
# Check if daemons are already running
ps aux | grep -E "npm.*watch-(client|extensions|e2e)d" | grep -v grep

# Start core daemons for regular development
npm run watch-clientd &      # Core compilation
npm run watch-extensionsd &  # Extensions compilation

# Add E2E daemon if testing
npm run watch-e2ed &         # E2E test compilation
```

### Compilation Status

Look for these messages to confirm compilation is ready:
- Core client: "Finished compilation[api-proposal-names] with 0 errors"
- Extensions: "Finished compilation[extensions] with 0 errors" 
- E2E: "Found 0 errors. Watching for file changes."

### Restart Development Environment
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

## Build System Summary

1. **Dependencies**: Run `npm install` only when needed (dependency errors)
2. **Build Daemons**: Start appropriate daemon combination based on task
3. **Compilation**: Wait for "Finished compilation" messages
4. **Launch**: Follow `.claude/launch-positron.md` for non-blocking launch
5. **Testing**: Use `npm run test-extension` for extensions, Playwright for E2E
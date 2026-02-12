# Skill: Review Upstream Merge

Review changes from an upstream VS Code merge to ensure Posit Workbench integration remains intact.

## Usage

```
/review-upstream-merge [branch-name]
```

If no branch name is provided, reviews the current branch against `main`.

## Instructions

When this skill is invoked, perform a comprehensive code review of upstream merge changes with focus on Posit Workbench (PWB) integration safety.

### Step 1: Identify the Merge

```bash
# Get current branch if not specified
git branch --show-current

# Get the diff summary against main
git diff main...HEAD --stat
```

### Step 2: Review Critical PWB Files

These files contain PWB-specific code and must be carefully reviewed:

1. **`src/vs/server/node/server.main.ts`**
   - Custom `parse()` and `createDirs()` functions
   - SSL certificate support
   - User data directory handling

2. **`src/vs/server/node/webClientServer.ts`**
   - Proxy server initialization and error handling
   - `/proxy/` route handling
   - Relative path generation (`relativeRoot`, `relativePath`)
   - `POSITRON_ENFORCED_SETTINGS` support
   - Webview endpoint configuration
   - File download/upload controls

3. **`src/vs/server/node/remoteExtensionHostAgentServer.ts`**
   - Proxy request routing (non-GET methods to proxy)
   - Service worker cookie bypass
   - WebSocket upgrade proxy handling
   - SSL URL output

4. **`src/vs/server/node/serverEnvironmentService.ts`**
   - `--cert` and `--cert-key` options
   - `--disable-file-downloads` and `--disable-file-uploads` options

5. **`src/vs/server/node/pwbConstants.ts`**
   - Proxy regex pattern

Get diffs for these files:
```bash
git diff main...HEAD -- src/vs/server/node/server.main.ts
git diff main...HEAD -- src/vs/server/node/webClientServer.ts
git diff main...HEAD -- src/vs/server/node/remoteExtensionHostAgentServer.ts
git diff main...HEAD -- src/vs/server/node/serverEnvironmentService.ts
```

### Step 3: Check PWB Code Blocks

Search for all PWB code blocks and verify they are unchanged:

```bash
# Find all PWB blocks in the diff
git diff main...HEAD -- "*.ts" | grep -E "(PWB|Start PWB|End PWB)"
```

PWB code blocks follow this pattern:
```typescript
// --- Start PWB: Description ---
// ... code ...
// --- End PWB ---
```

**Important**: Changes INSIDE PWB blocks should be flagged for manual review. Changes OUTSIDE PWB blocks are upstream changes.

### Step 4: Review Dependency Changes

Check for dependency updates that could affect PWB:

```bash
git diff main...HEAD -- remote/package.json
git diff main...HEAD -- package.json
```

Key dependencies for PWB:
- `http-proxy`: Powers proxy functionality
- `cookie`: Cookie handling for auth
- `@xterm/*`: Terminal packages (major version changes need attention)
- `node-pty`: PTY handling

### Step 5: Check Node Version in Build Environments

Upstream merges often update the Node.js version in `.nvmrc`. If this changes, the build Dockerfiles must be updated to match.

```bash
# Check if .nvmrc was changed
git diff main...HEAD -- .nvmrc

# Get current .nvmrc version
cat .nvmrc
```

If `.nvmrc` was changed, verify the Dockerfiles are updated:

**Build environment files to check:**
- `Dockerfile.arm64` - Uses `node:<version>` as base image (line 2)
- `Dockerfile.x86_64` - Uses `NODE_VERSION=<version>` ARG (line 4)

```bash
# Check current Dockerfile versions
grep -E "^FROM.*node:" Dockerfile.arm64
grep -E "^ARG NODE_VERSION" Dockerfile.x86_64

# Compare with .nvmrc
NVMRC_VERSION=$(cat .nvmrc | tr -d '\n')
echo "Expected Node version: $NVMRC_VERSION"
```

**Version format differences:**
- `.nvmrc`: Full version like `22.22.0`
- `Dockerfile.arm64`: Major.minor like `node:22.22` (in FROM line)
- `Dockerfile.x86_64`: Full version like `NODE_VERSION=22.22.0`

**If versions don't match, flag this in the report:**

```markdown
### Build Environment Updates Required

| File | Current | Expected | Status |
|------|---------|----------|--------|
| .nvmrc | X.Y.Z | X.Y.Z | OK |
| Dockerfile.arm64 | node:A.B | node:X.Y | NEEDS UPDATE |
| Dockerfile.x86_64 | NODE_VERSION=A.B.C | NODE_VERSION=X.Y.Z | NEEDS UPDATE |
```

See commit `ffd551b3553` for an example of updating node versions across all files.

### Step 6: Generate Review Report

Create a structured report with these sections:

#### Report Template

```markdown
## Upstream Merge Review: [branch-name]

### Summary
[One paragraph summary of findings]

### Changes in Critical PWB Files

#### 1. server.main.ts
- **Status**: [Safe/Needs Review/Breaking]
- **Changes**: [Description]
- **PWB Impact**: [None/Low/High]

#### 2. webClientServer.ts
- **Status**: [Safe/Needs Review/Breaking]
- **Changes**: [Description]
- **PWB Impact**: [None/Low/High]

#### 3. remoteExtensionHostAgentServer.ts
- **Status**: [Safe/Needs Review/Breaking]
- **Changes**: [Description]
- **PWB Impact**: [None/Low/High]

#### 4. serverEnvironmentService.ts
- **Status**: [Safe/Needs Review/Breaking]
- **Changes**: [Description]
- **PWB Impact**: [None/Low/High]

### Dependency Updates
| Package | Before | After | Risk |
|---------|--------|-------|------|
| ... | ... | ... | ... |

### Build Environment Node Version

| File | Current Version | Required (.nvmrc) | Status |
|------|-----------------|-------------------|--------|
| .nvmrc | X.Y.Z | - | Reference |
| Dockerfile.arm64 | node:X.Y | node:X.Y | [OK/NEEDS UPDATE] |
| Dockerfile.x86_64 | NODE_VERSION=X.Y.Z | X.Y.Z | [OK/NEEDS UPDATE] |

### PWB Integration Points Verification

| Integration Point | Status |
|------------------|--------|
| SSL certificate support | [OK/Changed] |
| Proxy server (`/proxy/` routes) | [OK/Changed] |
| WebSocket proxy | [OK/Changed] |
| File download/upload controls | [OK/Changed] |
| Connection token handling | [OK/Changed] |
| Service worker bypass | [OK/Changed] |
| Admin enforced settings | [OK/Changed] |
| Relative path generation | [OK/Changed] |

### Potential Concerns
[List any concerns with risk level]

### Recommendation
[Safe to merge / Needs attention / Do not merge]
```

### Step 7: Additional Checks (if needed)

If the review identifies concerns that require investigating how Posit Workbench integrates with this code, **prompt the user for the rstudio-pro repository location**:

> "I need to investigate the Posit Workbench integration code. Where is your rstudio-pro repository located? (e.g., ~/rstudio-pro or ~/dev/rstudio-pro)"

Once provided, perform deeper investigation:

1. **Research Posit Workbench integration** in the provided path:
   ```bash
   # Find VS Code integration code
   find <rstudio-pro-path> -name "*.cpp" -path "*/vscode/*" 2>/dev/null

   # Check session launch script
   cat <rstudio-pro-path>/src/cpp/session/vscode-session-run.in
   ```

2. **Verify argument handling**:
   - Ensure all PWB-specific CLI arguments are still defined
   - Check that argument processing hasn't changed

3. **Test proxy functionality**:
   - Verify `kProxyRegex` pattern still matches expected URLs
   - Check proxy error handling

## Exit Criteria

The merge is safe if:
- [ ] All PWB code blocks are unchanged
- [ ] No breaking changes to IServerAPI interface
- [ ] SSL support still works
- [ ] Proxy server functionality preserved
- [ ] File controls still functional
- [ ] No major dependency breaking changes
- [ ] Build environment Node versions match `.nvmrc` (or flagged for update)

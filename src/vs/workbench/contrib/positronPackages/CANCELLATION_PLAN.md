# Plan: Add Cancellation Support to Packages Pane

## Context

The packages pane (Install, Update, Remove, Refresh) is susceptible to long-running tasks that can hang indefinitely. Users have no way to cancel these operations, leaving the UI in a bad state. This PR adds `CancellationToken` support throughout the packages pane call chain, enabling users to cancel operations and propagating cancellation to underlying operations.

See [GitHub Issue #11657](https://github.com/posit-dev/positron/issues/11657)

## Current State

- **No cancellation support exists** - `CancellationToken` is not passed through any layer
- `InstallPackageAction` sets `cancellable: true` but doesn't use the token (line 132)
- `UninstallPackageAction` has a `TODO: cancelled` comment (line 215)
- `RefreshPackagesAction` doesn't use `withProgress` at all
- The `IPositronPackagesService` interface has no token parameters

## Implementation Order

1. **Refresh** - Simplest case, establishes the pattern
2. **Install** - Multi-step with search operations
3. **Update** - Similar to install
4. **Remove** - Simpler single-step
5. **Update All** - Bulk operation

---

## Step 1: Refresh

### Files to Modify

1. **interfaces/positronPackagesService.ts** - Add token to interface

   ```typescript
   refreshPackages(token?: CancellationToken): Promise<ILanguageRuntimePackage[]>;
   ```

2. **positronPackagesInstance.ts** - Add token parameter, check cancellation

   ```typescript
   async refreshPackages(token: CancellationToken = CancellationToken.None): Promise<ILanguageRuntimePackage[]>
   ```

3. **positronPackagesService.ts** - Pass token through

4. **positronPackages.contribution.ts:77-97** - Wrap in `withProgress({ cancellable: true })`, pass token

### Pattern to Establish

```typescript
// In RefreshPackagesAction.run()
return progress.withProgress(
	{
		title: "Refreshing Packages...",
		location: ProgressLocation.Notification,
		cancellable: true,
		delay: 500,
	},
	async (_progress, token) => {
		return await service.refreshPackages(token);
	},
);
```

---

## Step 2: Install

### Files to Modify

1. **Interface** - Add token to `installPackages`, `searchPackages`, `searchPackageVersions`

2. **positronPackages.contribution.ts:100-161** - Create `CancellationTokenSource` for entire flow, pass token to:
   - `performSearch` (searchPackages)
   - `performSearchVersions` (searchPackageVersions)
   - `performInstall` (installPackages via withProgress)

3. **Instance/Service** - Propagate tokens through all three operations

### Multi-Step Handling

```typescript
const cts = new CancellationTokenSource();

const performSearch = async (q: string) => {
	return await service.searchPackages(q, cts.token);
};

const performSearchVersions = async (pkg: string) => {
	return await service.searchPackageVersions(pkg, cts.token);
};

// Quick pick dialogs handle escape key automatically
await installPackage(
	accessor,
	performSearch,
	performSearchVersions,
	performInstall,
);

cts.dispose();
```

---

## Step 3: Update

### Files to Modify

1. **positronPackages.contribution.ts:238-306** - Add `cancellable: true` to withProgress, pass token

2. **Interface** - Add token to `updatePackages`

3. **Instance/Service** - Propagate token

---

## Step 4: Remove

### Files to Modify

1. **positronPackages.contribution.ts:164-235** - Add `cancellable: true`, implement the `TODO: cancelled` callback (line 215)

2. **Interface** - Add token to `uninstallPackages`

3. **Instance/Service** - Propagate token

---

## Step 5: Update All

### Files to Modify

1. **positronPackages.contribution.ts:309-355** - Add `cancellable: true`, pass token

2. **Interface** - Add token to `updateAllPackages`

3. **Instance/Service** - Propagate token

---

## Step 6: Extension Bridge Layer

After core layer is complete, extend cancellation through to language extensions.

### Files to Modify

1. **runtimeSessionService.ts** - Add optional `CancellationToken` parameter to all `ILanguageRuntimePackageManager` methods

2. **extHost.positron.protocol.ts** - Update RPC method signatures to include cancellation

3. **mainThreadLanguageRuntime.ts** - Forward tokens through `ExtHostLanguageRuntimePackageManagerAdapter`

4. **extHostLanguageRuntime.ts** - Pass tokens to extension package manager implementations

---

## Step 7: Language Extensions

### positron-r

1. **packages.ts** - Update `RPackageManager` methods to accept `CancellationToken`
2. Modify `_executeAndWait` to accept token and handle interrupt internally (callers just pass token through)
3. For RPC calls (`callMethod`): check `token.isCancellationRequested` before/after (no true cancellation)

### positron-python

1. **pipPackageManager.ts** - Update methods to accept `CancellationToken`
2. Convert token to `AbortSignal` for subprocess cancellation
3. Similar updates for `uvPackageManager.ts`, `condaPackageManager.ts` if they exist

---

## Key Files Summary

### Core Layer

| File                                  | Changes                                               |
| ------------------------------------- | ----------------------------------------------------- |
| interfaces/positronPackagesService.ts | Add `CancellationToken` to all method signatures      |
| positronPackagesInstance.ts           | Accept and check token in all methods                 |
| positronPackagesService.ts            | Pass token from service to instance                   |
| positronPackages.contribution.ts      | Use `withProgress({ cancellable: true })`, pass token |

### Extension Bridge Layer

| File                         | Changes                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| runtimeSessionService.ts     | Add `CancellationToken` to `ILanguageRuntimePackageManager` interface  |
| mainThreadLanguageRuntime.ts | Update `ExtHostLanguageRuntimePackageManagerAdapter` to forward tokens |
| extHostLanguageRuntime.ts    | Accept tokens and propagate to extension implementations               |
| extHost.positron.protocol.ts | Add token parameters to RPC protocol definitions                       |

### Language Extensions

| File                                     | Changes                                            |
| ---------------------------------------- | -------------------------------------------------- |
| positron-r/src/packages.ts               | Accept token, handle interrupt in \_executeAndWait |
| positron-python/.../pipPackageManager.ts | Accept token, wire up to terminal service          |

## Utilities to Use

- `CancellationToken`, `CancellationTokenSource` from `src/vs/base/common/cancellation.ts`
- `CancellationError` for throwing on cancellation
- `IProgressService.withProgress({ cancellable: true }, (progress, token) => ...)`
- For extensions: `vscode.CancellationToken`, convert to `AbortSignal` for fetch/subprocess

## Extension Cancellation Patterns

### R (positron-r)

There are two distinct code paths that need cancellation:

**1. RPC calls via `callMethod`** (used for `getPackages`, `searchPackages`, etc.):

- These are synchronous RPC calls to Ark kernel
- Currently no built-in cancellation support in Ark RPC
- Best we can do: check `token.isCancellationRequested` before/after the call

```typescript
async getPackages(token?: vscode.CancellationToken): Promise<positron.LanguageRuntimePackage[]> {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
    const method = await this._getPakMethod();
    const result = await this._session.callMethod('pkg_list', method);
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
    return result ?? [];
}
```

**2. Console execution via `_executeAndWait`** (used for `installPackages`, `updatePackages`, `uninstallPackages`):

- Executes R code and waits for Idle state message
- **CAN be interrupted** via `session.interrupt()`
- Need to modify `_executeAndWait` to accept token and wire up interrupt

```typescript
// Modified _executeAndWait signature
private async _executeAndWait(code: string, token?: vscode.CancellationToken): Promise<void> {
    const id = randomUUID();

    const promise = new Promise<void>((resolve, reject) => {
        // Register cancellation handler to interrupt R execution
        const cancelDisp = token?.onCancellationRequested(() => {
            this._session.interrupt();
            reject(new vscode.CancellationError());
            disp.dispose();
        });

        const disp = this._session.onDidReceiveRuntimeMessage((msg) => {
            if (msg.parent_id !== id) return;

            if (msg.type === positron.LanguageRuntimeMessageType.State) {
                const stateMsg = msg as positron.LanguageRuntimeState;
                if (stateMsg.state === positron.RuntimeOnlineState.Idle) {
                    resolve();
                    disp.dispose();
                    cancelDisp?.dispose();
                }
            }
            // ... error handling
        });
    });

    this._session.execute(code, id, ...);
    return promise;
}

// Then update callers:
async installPackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
    // ... validation and code generation ...
    await this._executeAndWait(code, token);
    this._session.invalidatePackageResourceCaches();
}
```

### Python (positron-python)

Two code paths:

**1. RPC calls via `_kernel.callMethod`** (used for `getPackages`):

- Similar to R - check token before/after

**2. Terminal execution via `_executePipInTerminal`** (used for `installPackages`, etc.):

- Already creates internal `CancellationTokenSource` but doesn't connect to external token
- `terminalService.sendCommand` already accepts a token
- Just need to wire up external token

```typescript
// Current implementation already has token infrastructure:
private async _executePipInTerminal(args: string[], token?: vscode.CancellationToken): Promise<void> {
    const terminalService = this._serviceContainer
        .get<ITerminalServiceFactory>(ITerminalServiceFactory)
        .getTerminalService({});
    await terminalService.show();

    // Use external token if provided, otherwise create internal one
    const tokenSource = token ? undefined : new vscode.CancellationTokenSource();
    const effectiveToken = token ?? tokenSource!.token;

    try {
        await terminalService.sendCommand(this._pythonPath, ['-m', 'pip', ...args], effectiveToken);
    } finally {
        tokenSource?.dispose();
    }
}
```

**3. HTTP requests via `searchPyPI`** (used for `searchPackages`, `searchPackageVersions`):

- Uses fetch internally
- Would need to convert token to `AbortSignal` for fetch cancellation

## Verification

1. **Refresh**: Start refresh, click cancel in notification, verify UI resets
2. **Install**: Start install, cancel during search, verify no install happens
3. **Install**: Start install, cancel during actual install, verify notification dismissed
4. **Update/Remove/Update All**: Same pattern - verify cancel works at each step
5. **R**: Cancel during package install, verify R kernel is interrupted
6. **Python**: Cancel during pip install, verify subprocess is killed

## Out of Scope (Future Work)

- Adding timeouts as fallback when user doesn't explicitly cancel
- Progress reporting from language extensions (granular per-package progress)
- True cancellation support in Ark's RPC system (for now, just check token before/after calls)

# @posit-dev/positron

> ⚠️ **EXPERIMENTAL - USE WITH EXTREME CAUTION**
>
> This package is currently experimental and should be used with extreme caution. The API definitions may change without notice, break compatibility, or be removed entirely. This package is not yet recommended for production use. Use at your own risk.

---

TypeScript definitions and runtime utilities for the [Positron](https://github.com/posit-dev/positron) API. This package is for extensions that want to utilize the Positron API to add custom functionality for Positron.


## Installation

```bash
npm install --save-dev @posit-dev/positron
```

## Usage

### Basic Usage

The `tryAcquirePositronApi` function is the main entry point for the Positron API. It returns the Positron API object if it is available (aka code is running in Positron), or `undefined` if it is not. This function is safe to call in both Positron and VS Code.

```typescript
import { tryAcquirePositronApi } from '@posit-dev/positron';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const positronApi = tryAcquirePositronApi();

  if (positronApi) {
    // Running in Positron - enhanced features available
    vscode.window.showInformationMessage('Enhanced by Positron!');
    positronApi.runtime.executeCode('python', 'print("Hello Positron!")', true);
  } else {
    // Running in VS Code - standard functionality only
    vscode.window.showInformationMessage('Running in VS Code mode');
  }
}
```

### Advanced Usage

#### Global acquirePositronApi Function

When running in Positron, a global `acquirePositronApi` function is injected that you can call directly. This package provides TypeScript definitions for this function. **Important**: This function is `undefined` when running in VS Code.

```typescript
// The global function is typed as optional - always check before calling
if (typeof acquirePositronApi !== 'undefined') {
  const positronApi = acquirePositronApi();
  if (positronApi) {
    // Use the API directly
    positronApi.runtime.executeCode('python', 'print("Direct access!")', true);
  }
}

// Alternative using optional chaining
const positronApi = globalThis.acquirePositronApi?.();
if (positronApi) {
  // Safe to use here
}
```

> **Recommendation**: For most use cases, prefer `tryAcquirePositronApi()` which handles the detection logic for you and provides cleaner code.

#### Runtime Detection
```typescript
import { tryAcquirePositronApi, inPositron } from '@posit-dev/positron';

function executeInPositron(code: string) {
  const api = tryAcquirePositronApi();
  if (api) {
    return api.runtime.executeCode('python', code, false);
  }
  throw new Error('Positron not available');
}

// Clean conditional logic with inPositron()
if (inPositron()) {
  // Positron-specific code
  const api = acquirePositronApi!(); // Safe to assert since inPositron() is true
  api.runtime.executeCode('python', 'print("Hello!")', true);
}
```

#### Cross-Platform URL Preview
```typescript
import { previewUrl } from '@posit-dev/positron';

// Works in both Positron and VS Code
async function showLocalServer() {
  // In Positron: Opens in preview pane
  // In VS Code: Opens in external browser
  await previewUrl('http://localhost:3000');
}
```

#### Type-only Imports
```typescript
import type {
  LanguageRuntimeMetadata,
  RuntimeState,
  LanguageRuntimeSession
} from '@posit-dev/positron';

function processRuntime(runtime: LanguageRuntimeMetadata) {
  // Use types for development, tryAcquirePositronApi() for runtime access
}
```

#### Feature Flagging
There are many ways you could "feature flag" Positron-specific functionality. Here is one example:

```typescript
import { tryAcquirePositronApi, previewUrl } from '@posit-dev/positron';

export class MyExtension {
  private positronApi = tryAcquirePositronApi();

  async doFoo() {
    if (this.positronApi) {
      ... // Positron-specific functionality
    } else {
      ... // VS Code-only functionality
    }
  }
}
```

## API Coverage

This package includes TypeScript definitions for:

### Core APIs
- **Runtime Management**: `LanguageRuntimeManager`, `LanguageRuntimeSession`
- **Language Runtime Messages**: All message types and interfaces
- **Runtime States**: State enums and metadata interfaces
- **Client Management**: Runtime client types and handlers

### UI APIs
- **Window Extensions**: Preview panels, output channels, modal dialogs
- **Language Features**: Statement range providers, help topic providers
- **Console Integration**: Console API for language-specific interactions

### Specialized APIs
- **Connections**: Database connection driver interfaces
- **Environment**: Environment variable management
- **AI Features**: Language model and chat agent interfaces
- **Plotting**: Plot rendering settings and formats

## Version Compatibility

| @posit-dev/positron | Positron Version | VS Code API |
|----------------|------------------|-------------|
| 0.1.x          | 2025.07.0+      | 1.74.0+     |

## Development

This package is automatically generated from the Positron source code. The types are extracted and processed to be standalone, with all internal dependencies inlined.

### Building from Source

```bash
# Clone the Positron repository
git clone https://github.com/posit-dev/positron.git
cd positron/positron-api-pkg

# Build the package
npm run build
```

This will run a single build script that:
1. **Gathers types** - Copy `.d.ts` files from main Positron source
2. **Compiles TypeScript** - Transform source to JavaScript and declarations
3. **Copies ambient declarations** - Include module declarations in distribution
4. **Adds reference directives** - Link declarations for proper module resolution

### Development Workflow

From the package directory:

```bash
# Clean all generated files
npm run clean

# Run complete build process (all steps above)
npm run build
```

### From Positron Repository Root

```bash
# Build the package from the main repo
npm run build-js-sdk
```

## Examples

### Working with Language Runtimes

```typescript
import { tryAcquirePositronApi } from '@posit-dev/positron';
import type { RuntimeCodeExecutionMode } from '@posit-dev/positron';

// Execute code in a runtime (Positron only)
const positronApi = tryAcquirePositronApi();
if (positronApi) {
  await positronApi.runtime.executeCode(
    'python',
    'print("Hello from Positron!")',
    true, // focus console
    false, // require complete code
    RuntimeCodeExecutionMode.Interactive
  );

  // Get active sessions
  const sessions = await positronApi.runtime.getActiveSessions();
  for (const session of sessions) {
    console.log(`Session: ${session.runtimeMetadata.runtimeName}`);
  }
}
```

### Creating Preview Panels

```typescript
import { tryAcquirePositronApi } from '@posit-dev/positron';
import * as vscode from 'vscode';

// Create a preview panel for web content (Positron only)
const positronApi = tryAcquirePositronApi();
if (positronApi) {
  const panel = positronApi.window.createPreviewPanel(
    'myExtension.preview',
    'My Preview',
    true, // preserve focus
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file('/path/to/resources')]
    }
  );

  panel.webview.html = '<html><body><h1>Hello Positron!</h1></body></html>';
}
```

## Contributing

This package is maintained as part of the Positron project. Please report issues and contribute improvements through the main [Positron repository](https://github.com/posit-dev/positron).

## License

Licensed under the [Elastic License 2.0](https://www.elastic.co/licensing/elastic-license).

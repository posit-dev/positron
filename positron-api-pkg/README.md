# @posit-dev/positron

> ⚠️ **EXPERIMENTAL - USE WITH EXTREME CAUTION**
>
> This package is currently experimental and should be used with extreme caution. The API definitions may change without notice, break compatibility, or be removed entirely. This package is not yet recommended for production use. Use at your own risk.

---

TypeScript definitions and runtime utilities for the [Positron](https://github.com/posit-dev/positron) API.

Positron is a next-generation data science IDE powered by VS Code, designed specifically for data science workflows in Python and R.

## Installation

```bash
npm install --save-dev @posit-dev/positron @types/vscode
```

## Usage

### Basic Usage
```typescript
import { getPositronApi } from '@posit-dev/positron';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const positronApi = getPositronApi();

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

#### Runtime Detection
```typescript
import { getPositronApi } from '@posit-dev/positron';

function isPositronAvailable(): boolean {
  return getPositronApi() !== undefined;
}

function executeInPositron(code: string) {
  const api = getPositronApi();
  if (api) {
    return api.runtime.executeCode('python', code, false);
  }
  throw new Error('Positron not available');
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
  // Use types for development, getPositronApi() for runtime access
}
```

#### Feature Flagging
```typescript
import { getPositronApi } from '@posit-dev/positron';

export class MyExtension {
  private positronApi = getPositronApi();

  async showData(data: any[]) {
    if (this.positronApi) {
      // Use Positron's data viewer
      await this.positronApi.window.previewUrl(/* data url */);
    } else {
      // Fallback to VS Code's generic viewer
      await vscode.commands.executeCommand('vscode.open', /* data file */);
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
import { getPositronApi } from '@posit-dev/positron';
import type { RuntimeCodeExecutionMode } from '@posit-dev/positron';

// Execute code in a runtime (Positron only)
const positronApi = getPositronApi();
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
import { getPositronApi } from '@posit-dev/positron';
import * as vscode from 'vscode';

// Create a preview panel for web content (Positron only)
const positronApi = getPositronApi();
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

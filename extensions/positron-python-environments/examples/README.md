## Requirements

1. `node` >= 22.21.1
2. `npm` >= 10.9.0
3. `yo` >= 5.0.0 (installed via `npm install -g yo`)
4. `generator-code` >= 1.11.4 (installed via `npm install -g generator-code`)

## Create your extension

### Scaffolding

Run `yo code` in your terminal and follow the instructions to create a new extension. The following were the choices made for this example:

```
> yo code
? What type of extension do you want to create? New Extension (TypeScript)
? What's the name of your extension? Sample1
? What's the identifier of your extension? sample1
? What's the description of your extension? A sample environment manager
? Initialize a git repository? Yes
? Which bundler to use? webpack
? Which package manager to use? npm
```

Follow the generator's additional instructions to install the required dependencies and build your extension.

### Update extension dependency

Add the following dependency to your extension `package.json` file:

```json
    "extensionDependencies": [
        "ms-python.vscode-python-envs"
    ],
```

### Set up the Python Envs API

The Python environments API is available via the extension export. First, add the following file to your extension [api.ts](https://github.com/microsoft/vscode-python-environments/blob/main/src/api.ts). You can rename the file as you see fit for your extension.

Add a `pythonEnvsApi.ts` file to get the API and insert the following code:

```typescript
import * as vscode from 'vscode';
import { PythonEnvironmentApi } from './api';

let _extApi: PythonEnvironmentApi | undefined;
export async function getEnvExtApi(): Promise<PythonEnvironmentApi> {
    if (_extApi) {
        return _extApi;
    }
    const extension = vscode.extensions.getExtension('ms-python.vscode-python-envs');
    if (!extension) {
        throw new Error('Python Environments extension not found.');
    }
    if (extension?.isActive) {
        _extApi = extension.exports as PythonEnvironmentApi;
        return _extApi;
    }

    await extension.activate();

    _extApi = extension.exports as PythonEnvironmentApi;
    return _extApi;
}
```

Now you are ready to use it to register your environment manager.

### Registering the environment manager

Add the following code to your extension's `extension.ts` file:

```typescript
import { ExtensionContext } from 'vscode';
import { getEnvExtApi } from './pythonEnvsApi';
import { SampleEnvManager } from './sampleEnvManager';

export async function activate(context: ExtensionContext): Promise<PythonEnvironmentApi> {
    const api = await getEnvExtApi();

    const envManager = new SampleEnvManager(api);
    context.subscriptions.push(api.registerEnvironmentManager(envManager));
}
```

See full implementations for built-in support here: https://github.com/microsoft/vscode-python-environments/blob/main/src/managers


# Positron Environment Modules

This extension provides support for [Environment Modules](https://modules.readthedocs.io/) and [Lmod](https://lmod.readthedocs.io/) module systems in Positron. These systems are commonly used in high-performance computing (HPC) environments to dynamically modify the user's shell environment to load specific versions of software packages.

## What It Does

The extension enables Positron to discover and use language runtimes (R, Python, etc.) that are managed by environment module systems. It:

- **Detects module systems**: Automatically identifies Lmod or Environment Modules installations on Unix-like systems
- **Discovers language runtimes**: Finds interpreters configured through module environments in user settings
- **Provides language-agnostic API**: Exposes an API that language extensions can use to discover their interpreters
- **Generates startup commands**: Creates the shell commands needed to load modules before launching interpreters

## Configuration

Users can configure module environments in their settings:

```json
{
  "positron.environmentModules.enabled": true,
  "positron.environmentModules.environments": {
    "r-4.3": {
      "languages": ["r"],
      "modules": ["gcc/11.2.0", "R/4.3.0"]
    },
    "python-3.11": {
      "languages": ["python"],
      "modules": ["gcc/11.2.0", "python/3.11.3"]
    }
  }
}
```

Each environment specifies:
- **name** (setting key): Unique identifier for the environment (e.g., `"r-4.3"`, `"python-3.11"`)
- **languages**: Target languages that should discover this environment (e.g., `"r"`, `"python"`)
- **modules**: Ordered list of modules to load

## API Usage

Language extensions (positron-python, positron-r) consume this extension's API to discover interpreters managed by module systems.  The core API method is `resolveInterpreter`, which takes language-specific details and returns the discovered interpreter.  When launching a kernel, the extension uses the stored `startupCommand` to ensure modules are loaded before the interpreter starts.

## Architecture

The extension maintains a **language-agnostic design**:
- Language extensions provide language-specific details (binary names, version parsing)
- This extension handles the generic module system interaction
- Results are cached and invalidated when configuration changes


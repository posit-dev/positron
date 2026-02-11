# Contributing to Python Environments Extension

Thank you for your interest in contributing to the Python Environments extension! This guide will help you get started.

## Prerequisites

- Node.js (LTS version recommended)
- npm
- VS Code Insiders (recommended for development)
- Git
- Python

## Getting Started

1. **Clone the repository**
   ```bash
   cd vscode-python-environments
   ```

2. **Create a Python virtual environment** 

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Build and watch**
   ```bash
   npm run watch
   ```

5. **Run tests**
   ```bash
   npm run unittest
   ```

## Development Workflow

### Running the Extension

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. The extension will be loaded in the new VS Code window

### Making Changes

- **Localization**: Use VS Code's `l10n` API for all user-facing messages
- **Logging**: Use `traceLog` or `traceVerbose` instead of `console.log`
- **Error Handling**: Track error state to avoid duplicate notifications
- **Documentation**: Add clear docstrings to public functions

### Testing
Run unit tests with the different configurations in the "Run and Debug" panel

## Contributor License Agreement (CLA)

This project requires contributors to sign a Contributor License Agreement (CLA). When you submit a pull request, a CLA bot will automatically check if you need to provide a CLA and guide you through the process. You only need to do this once across all Microsoft repositories.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information, see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with questions.

## Questions or Issues?

- **Questions**: Start a [discussion](https://github.com/microsoft/vscode-python/discussions/categories/q-a)
- **Bugs**: File an [issue](https://github.com/microsoft/vscode-python-environments/issues)
- **Feature Requests**: Start a [discussion](https://github.com/microsoft/vscode-python/discussions/categories/ideas)

## Additional Resources

- [Development Process](https://github.com/Microsoft/vscode-python/blob/main/CONTRIBUTING.md#development-process)
- [API Documentation](./src/api.ts)
- [Project Documentation](./docs/projects-api-reference.md)

Thank you for contributing! 🎉

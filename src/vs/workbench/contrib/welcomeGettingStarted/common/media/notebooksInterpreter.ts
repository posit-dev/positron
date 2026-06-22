/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Use the es6-string-html VS Code extension to syntax highlight the markdown content below.
export default () => /* markdown */`
Your notebook needs a Python or R interpreter to execute code. Positron provides fluent tooling to discover, select, and manage interpreters.

<div align="center">
<img src="./kernel-selector-abstract.svg" alt="Jupyter Notebooks in Positron" width="400">
</div>

- **Manage your notebook session**: The interpreter used by the notebook is visible in the Kernel Selector in the notebook editor action bar. You can click on it to manage your current notebook session (restart, shut down, or change session).
- **Switch between running sessions**: The interpreter picker in the top-right action bar shows the interpreter or notebook that's currently active. Click it to see every running session and jump between them. Selecting a notebook session brings its editor to the foreground.
- **Discover new interpreters**: If you create a new virtual environment that Positron doesn't detect automatically, use ["Discover All Interpreters"](command:workbench.action.language.runtime.discoverAllRuntimes) to refresh the list.

Positron supports R and Python interpreters from virtual environments created via \`venv\`, \`uv\`, \`pyenv\`, \`conda\`, and other Python installations. Your selected interpreter will be used for running notebook cells and providing language intelligence.

Learn more about how Positron manages interpreters and sessions in our documentation: [Managing Interpreters](https://positron.posit.co/managing-interpreters.html).
`;

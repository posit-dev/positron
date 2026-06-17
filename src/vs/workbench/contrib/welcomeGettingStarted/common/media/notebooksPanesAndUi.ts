/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Use the es6-string-html VS Code extension to syntax highlight the markdown content below.
export default () => /* markdown */`
Positron provides a powerful batteries included environment for working with Jupyter notebooks, featuring integrated panes designed for data science workflows:

<div align="center">
<img src="./notebook-editor-abstract.svg" alt="Jupyter Notebooks in Positron" width="400">
</div>

- [Variables pane](command:positronVariables.focus): inspect and explore variables, dataframes, arrays and objects in your current notebook session.
- [Data Explorer](https://positron.posit.co/data-explorer.html): Click any dataframe in the Variables pane or in a notebook cell output to sort, filter, and explore your data interactively.
- [Packages pane](command:workbench.view.positronPackages.view.focus): Browse installed packages, search package repositories, and manage packages without leaving Positron.
- [Connections pane](command:workbench.panel.positronConnections.focus): Manage database connections and preview tables easily.
- [Help pane](command:workbench.panel.positronHelp.focus): Lookup documentation for Python objects and packages easily.

**Tip:** Try the [Notebook Layout](command:workbench.action.positronNotebookLayout) preset, which is optimized for notebook workflows. You can also [customize your layout](command:workbench.action.customizeLayout) to find the arrangement that works best for you.
`;

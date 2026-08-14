/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Use the es6-string-html VS Code extension to syntax highlight the markdown content below.
export default () => /* markdown */`
Positron has panes built for data science alongside the editor, terminal, and source control you may already know:

<div align="center">
<img src="./positron-panes-abstract.svg" alt="The Positron user interface" width="400">
</div>

- [Console](command:workbench.action.positronConsole.focusConsole): Run Python and R code interactively in a persistent session
- [Variables](command:positronVariables.focus): Inspect the variables, dataframes, and objects defined in your session
- [Data Explorer](https://positron.posit.co/data-explorer.html): Click any dataframe in the Variables pane to sort, filter, and profile your data
- [Plots](command:workbench.panel.positronPlots.focus): Browse the plots you have created, with history and export
- [Help](command:workbench.panel.positronHelp.focus): Read documentation for Python and R objects without leaving the IDE
- [Connections](command:workbench.panel.positronConnections.focus): Manage database connections and preview tables
- [Packages](command:workbench.view.positronPackages.view.focus): Browse installed packages and manage them in place

**Tip:** Positron ships several layout presets designed for data science. [Customize your layout](command:workbench.action.customizeLayout) to try the Stacked, Side-by-Side, and Notebook layouts, or drag any pane to rearrange it yourself.
`;

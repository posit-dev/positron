/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Use the es6-string-html VS Code extension to syntax highlight the markdown content below.
export default () => /* markdown */`
Version control is built in, so you can track changes and collaborate without leaving Positron.

<div align="center">
<img src="./positron-git-abstract.svg" alt="Source control in Positron" width="400">
</div>

- Starting from a repository? Use [New Folder from Git](command:positron.workbench.action.newFolderFromGit) to clone it and open it in one step.
- Already in a folder? Open the [Source Control](command:workbench.view.scm) view to stage, commit, and push your changes.

The Source Control view shows your changed files, lets you review a diff before you commit, and manages branches. If the folder is not a repository yet, the view offers to initialize one.
`;

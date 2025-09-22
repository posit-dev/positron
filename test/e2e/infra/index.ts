/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export * from './application';
export * from './code';
export * from './logger';
export * from './positron';
export * from './test-runner';
export * from './test-teardown.js';

// pages
export * from '../pages/console';
export * from '../pages/dialog-modals';
export * from '../pages/dialog-toasts';
export * from '../pages/dialog-popups.js';
export * from '../pages/variables';
export * from '../pages/dataExplorer';
export * from '../pages/sideBar';
export * from '../pages/plots';
export * from '../pages/notebooks';
export * from '../pages/notebooksVscode';
export * from '../pages/notebooksPositron';
export * from '../pages/newFolderFlow';
export * from '../pages/connections';
export * from '../pages/help';
export * from '../pages/output';
export * from '../pages/welcome';
export * from '../pages/topActionBar';
export * from '../pages/layouts';
export * from '../pages/terminal';
export * from '../pages/viewer';
export * from '../pages/editor';
export * from '../pages/testExplorer';
export * from '../pages/explorer';
export * from '../pages/quickaccess';
export * from '../pages/outline';
export * from '../pages/clipboard';
export * from '../pages/extensions';
export * from '../pages/editors';
export * from '../pages/userSettings';
export * from '../pages/debug';
export * from '../pages/problems';
export * from '../pages/references';
export * from '../pages/scm';
export * from '../pages/sessions';
export * from '../pages/hotKeys';

// utils
export * from '../pages/utils/aws';
export * from '../pages/dialog-contextMenu';
export * from '../pages/utils/vscodeSettings';
export { getDevElectronPath, getBuildElectronPath, getBuildVersion } from './electron';

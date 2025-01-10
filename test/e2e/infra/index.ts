/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export * from './application';
export * from './code';
export * from './logger';
export * from './workbench';

// pages
export * from '../pages/console';
export * from '../pages/popups';
export * from '../pages/interpreter';
export * from '../pages/variables';
export * from '../pages/dataExplorer';
export * from '../pages/sideBar';
export * from '../pages/plots';
export * from '../pages/notebooks';
export * from '../pages/newProjectWizard';
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
export * from '../pages/utils/aws';
export * from '../pages/quickaccess';
export * from '../pages/outline';
export * from '../pages/clipboard';
export * from '../pages/extensions';
export * from '../pages/editors';
export * from '../pages/settings';

// fixtures
export * from './fixtures/python';
export * from './fixtures/r';
export * from './fixtures/userSettings';

// test-runner
export * from './test-runner';

export { getDevElectronPath, getBuildElectronPath, getBuildVersion } from './electron';

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';

// Constants used across test fixtures
export const ROOT_PATH = process.cwd();
export const LOGS_ROOT_PATH = join(ROOT_PATH, 'test-logs');

// Global state variables that need to be mutable
export let fixtureScreenshot: Buffer;

export function setFixtureScreenshot(screenshot: Buffer) {
	fixtureScreenshot = screenshot;
}

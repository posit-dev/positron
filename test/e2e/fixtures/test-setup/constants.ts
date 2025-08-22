/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { randomUUID } from 'crypto';

// Constants used across test fixtures
export const TEMP_DIR = `temp-${randomUUID()}`;
export const ROOT_PATH = process.cwd();
export const LOGS_ROOT_PATH = join(ROOT_PATH, 'test-logs');

// Global state variables that need to be mutable
export let SPEC_NAME = '';
export let fixtureScreenshot: Buffer;

export function setSpecName(name: string) {
	SPEC_NAME = name;
}

export function setFixtureScreenshot(screenshot: Buffer) {
	fixtureScreenshot = screenshot;
}

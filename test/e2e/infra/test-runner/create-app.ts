/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, ApplicationOptions } from '../../infra';

export function createApp(options: ApplicationOptions, optionsTransform?: (opts: ApplicationOptions) => ApplicationOptions): Application {
	if (optionsTransform) {
		options = optionsTransform({ ...options });
	}

	const app = new Application({
		...options,
	});

	return app;
}

/**
 * Returns a stable random user data dir path for the current test run.
 * Uses process.env to ensure it's consistent across modules and processes.
 */
export function getRandomStableUserDataDir(basePath: string): string {
	if (!process.env.RANDOM_USER_DATA_DIR) {
		const suffix = [...Array(8)].map(() => Math.random().toString(36)[3]).join('');
		process.env.RANDOM_USER_DATA_DIR = `${basePath}/d-${suffix}`;
		// console.log(`✓ Generated random user data dir: ${process.env.RANDOM_USER_DATA_DIR}`);
	} else {
		// console.log(`→ Reusing random user data dir: ${process.env.RANDOM_USER_DATA_DIR}`);
	}
	return process.env.RANDOM_USER_DATA_DIR;
}

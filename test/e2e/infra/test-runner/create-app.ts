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

export function getRandomUserDataDir(options: ApplicationOptions): string {

	// Pick a random user data dir suffix that is not
	// too long to not run into max path length issues
	// https://github.com/microsoft/vscode/issues/34988
	const userDataPathSuffix = [...Array(8)].map(() => Math.random().toString(36)[3]).join('');

	if (!options.userDataDir) {
		throw new Error('Cannot get random user data dir from undefined userDataDir');
	}

	return options.userDataDir.concat(`-${userDataPathSuffix}`);
}

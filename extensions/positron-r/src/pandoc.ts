/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { existsSync } from 'fs';
import * as path from 'path';

/**
 * Discovers the path to the pandoc executable that ships with Positron.
 *
 * @returns The path to the pandoc executable, if it exists.
 */
export function getPandocPath(): string | undefined {
	const pandocPath = path.join(vscode.env.appRoot,
		process.platform === 'darwin' ?
			path.join('bin', 'pandoc') :
			path.join('..', '..', 'bin', 'pandoc'));
	if (existsSync(pandocPath)) {
		return pandocPath;
	}
}

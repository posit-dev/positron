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
	const pandocPath = path.join(vscode.env.appRoot, 'quarto', 'bin', 'tools');
	const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';

	// Check for architecure-specific pandoc
	if (existsSync(path.join(pandocPath, arch, 'pandoc'))) {
		return path.join(pandocPath, arch);
	}

	if (existsSync(pandocPath)) {
		return pandocPath;
	} else {
		// If pandoc is not found, log a warning; Positron should always ship with pandoc.
		console.warn(`No pandoc executable found in Positron; expected one in ${pandocPath}`);
	}
}

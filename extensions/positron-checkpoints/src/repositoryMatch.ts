/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

/** A repository as the git extension describes it: only its root is read. */
export interface RepositoryRoot { readonly rootUri: { readonly fsPath: string } }

/**
 * The first of `repositories` whose root is the folder `root`. Both sides are compared with every
 * symbolic link resolved by `realpath`: git reports a project root with links resolved, and the
 * git extension keeps the path it opened. A path that cannot be resolved is compared as it is,
 * made absolute.
 */
export async function findRepository<T extends RepositoryRoot>(
	repositories: readonly T[], root: string, realpath: (folder: string) => Promise<string> = fs.promises.realpath,
): Promise<T | undefined> {
	const resolve = (folder: string) => realpath(folder).catch(() => path.resolve(folder));
	const target = await resolve(root);
	for (const repository of repositories) {
		if (path.relative(await resolve(repository.rootUri.fsPath), target) === '') {
			return repository;
		}
	}
	return undefined;
}

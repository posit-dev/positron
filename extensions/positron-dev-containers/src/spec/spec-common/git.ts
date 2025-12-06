/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runCommandNoPty, CLIHost } from './commonUtils';
import { Log } from '../spec-utils/log';
import { FileHost } from '../spec-utils/pfs';

export async function findGitRootFolder(cliHost: FileHost | CLIHost, folderPath: string, output: Log) {
	if (!('exec' in cliHost)) {
		for (let current = folderPath, previous = ''; current !== previous; previous = current, current = cliHost.path.dirname(current)) {
			if (await cliHost.isFile(cliHost.path.join(current, '.git', 'config'))) {
				return current;
			}
		}
		return undefined;
	}
	try {
		// Preserves symlinked paths (unlike --show-toplevel).
		const { stdout } = await runCommandNoPty({
			exec: cliHost.exec,
			cmd: 'git',
			args: ['rev-parse', '--show-cdup'],
			cwd: folderPath,
			output,
		});
		const cdup = stdout.toString().trim();
		return cliHost.path.resolve(folderPath, cdup);
	} catch {
		return undefined;
	}
}

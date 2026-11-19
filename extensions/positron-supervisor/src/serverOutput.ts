/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';

/**
 * Describes the captured stdout/stderr of the supervisor process, formatted
 * for appending to a startup error or log message.
 *
 * The supervisor wrapper script writes its command line to the output file
 * before it starts the supervisor. If the file does not exist, the wrapper
 * script itself did not start. The usual cause is a terminal environment
 * whose PATH cannot find the interpreter named in the script's shebang line,
 * for example a `terminal.integrated.env.*` setting that replaces PATH.
 *
 * @param outFile The path of the wrapper script's output file.
 * @returns A suffix that starts with "; ", or an empty string when the
 *   output file exists but is empty.
 */
export async function describeServerOutput(outFile: string): Promise<string> {
	let contents: string;
	try {
		contents = await fs.promises.readFile(outFile, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return '; the supervisor wrapper script did not start, so it captured no output. ' +
				'Make sure that the PATH for terminals is correct; ' +
				'a terminal.integrated.env setting that replaces PATH can cause this.';
		}
		return `; could not read the output file ${outFile}: ${err}`;
	}
	return contents ? `; output:\n\n${contents}` : '';
}

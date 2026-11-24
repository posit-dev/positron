/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { dirname, join } from '../../../../../base/common/path.js';
import { fileURLToPath } from 'url';
import { QUARTO_CELL_GGSQL_CONNECT_KEY } from '../../common/quartoVirtualNotebookTypes.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../../../..');

describe('QUARTO_CELL_GGSQL_CONNECT_KEY', () => {
	it('is the key positron-sql reads a Quarto cell\'s database from', () => {
		// The key crosses into the extension host, which can't import it: a rename
		// on one side would quietly leave every Quarto SQL cell without its tables.
		const connect = readFileSync(join(REPO_ROOT, 'extensions/positron-sql/src/connect.ts'), 'utf8');
		expect(/const GGSQL_CONNECT_KEY = '(?<key>[^']+)';/.exec(connect)?.groups?.key).toBe(QUARTO_CELL_GGSQL_CONNECT_KEY);
	});
});

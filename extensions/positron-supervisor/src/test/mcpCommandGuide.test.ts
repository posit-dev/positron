/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { readCommandGuide } from '../mcpCommandGuide';

suite('readCommandGuide', () => {
	let tmp: string;

	setup(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'command-guide-'));
	});

	teardown(async () => {
		await fs.rm(tmp, { recursive: true, force: true });
	});

	test('reads the skill from the first root that has it, with links made relative', async () => {
		const empty = path.join(tmp, 'empty');
		const root = path.join(tmp, 'skills');
		const skill = path.join(root, 'positron-commands');
		await fs.mkdir(empty);
		await fs.mkdir(path.join(skill, 'references'), { recursive: true });
		await fs.writeFile(path.join(skill, 'SKILL.md'), `See [files](${skill}/references/files.md).`);
		await fs.writeFile(path.join(skill, 'references', 'files.md'), `Back to [SKILL.md](${skill}/SKILL.md).`);

		assert.deepStrictEqual(await readCommandGuide([empty, root]), {
			'SKILL.md': 'See [files](references/files.md).',
			'references/files.md': 'Back to [SKILL.md](SKILL.md).',
		});
	});

	test('is empty when no root has the skill', async () => {
		assert.deepStrictEqual(await readCommandGuide([tmp]), {});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import archiver from 'archiver';
import { execFileSync } from 'child_process';
import { createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { secretEnvNames } from './appEnv';
import { scanPaths } from './secretScan';

const SECRET = 'fake"va/lu+e-123456';
const secrets = [{ name: 'FAKE_SECRET', value: SECRET }];

function zip(target: string, files: Record<string, Buffer | string>): Promise<void> {
	return new Promise((res, rej) => {
		const out = createWriteStream(target);
		const archive = archiver('zip');
		out.on('close', () => res());
		archive.on('error', rej);
		archive.pipe(out);
		for (const [name, content] of Object.entries(files)) {
			archive.append(content, { name });
		}
		void archive.finalize();
	});
}

describe('secretScan', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'scan-'));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('finds raw, json, url, base64 in plain files', async () => {
		const forms: Record<string, string> = {
			'raw.txt': SECRET,
			'json.txt': JSON.stringify(SECRET).slice(1, -1),
			'url.txt': encodeURIComponent(SECRET),
			'base64.txt': Buffer.from(SECRET).toString('base64'),
		};
		for (const [file, text] of Object.entries(forms)) {
			writeFileSync(join(dir, file), `x ${text} y`);
		}
		const hits = await scanPaths([dir], secrets);
		for (const [file, encoding] of [['raw.txt', 'raw'], ['json.txt', 'json'], ['url.txt', 'url'], ['base64.txt', 'base64']]) {
			expect(hits).toContainEqual({ file: join(dir, file), name: 'FAKE_SECRET', encoding });
		}
		expect(new Set(hits.map(h => `${h.file}|${h.name}|${h.encoding}`)).size).toBe(hits.length);
	});

	it('finds a secret inside a zip inside a zip', async () => {
		await zip(join(dir, 'inner.zip'), { 'log.txt': `token=${SECRET}` });
		const innerBytes = readFileSync(join(dir, 'inner.zip'));
		rmSync(join(dir, 'inner.zip'));
		await zip(join(dir, 'outer.zip'), { 'inner.zip': innerBytes });
		const hits = await scanPaths([dir], secrets);
		expect(hits).toHaveLength(1);
		expect(hits[0].file.endsWith('outer.zip!inner.zip!log.txt')).toBe(true);
		expect(hits[0].name).toBe('FAKE_SECRET');
	});

	it('clean tree has no hits', async () => {
		writeFileSync(join(dir, 'clean.txt'), 'nothing here');
		expect(await scanPaths([dir, join(dir, 'missing')], secrets)).toEqual([]);
	});

	it('ignores values shorter than 8 characters', async () => {
		writeFileSync(join(dir, 'short.txt'), 'abc1234');
		expect(await scanPaths([dir], [{ name: 'SHORT', value: 'abc1234' }])).toEqual([]);
	});

	it('corrupt zip throws', async () => {
		writeFileSync(join(dir, 'bad.zip'), Buffer.from(Array.from({ length: 200 }, (_, i) => (i * 37 + 11) % 256)));
		await expect(scanPaths([dir], secrets)).rejects.toThrow(/bad\.zip/);
	});

	it('hit output never contains the value', () => {
		writeFileSync(join(dir, 'log.txt'), `token=${SECRET}`);
		// Child env: real secret names removed so developer values never enter the test.
		const env: NodeJS.ProcessEnv = { ...process.env };
		for (const name of secretEnvNames(process.env)) {
			delete env[name];
		}
		env.E2E_LEAK_CANARY_KEY = 'fake-canary-value-123456';
		env.FAKE_SECRET_KEY = SECRET;
		const cli = resolve(__dirname, '../scripts/scan-for-secrets.ts');
		let status = 0;
		let stdout = '';
		try {
			stdout = execFileSync('npx', ['tsx', cli, dir], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (err) {
			const e = err as { status: number; stdout: string };
			status = e.status;
			stdout = e.stdout;
		}
		expect(status).toBe(1);
		expect(stdout).toContain('FAKE_SECRET_KEY');
		expect(stdout).not.toContain(SECRET);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import archiver from 'archiver';
import { spawnSync } from 'child_process';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
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

	it('finds a secret in the zip an HTML report embeds as base64', async () => {
		await zip(join(dir, 'data.zip'), { 'report.json': JSON.stringify({ title: `token=${SECRET}` }) });
		const data = readFileSync(join(dir, 'data.zip')).toString('base64');
		rmSync(join(dir, 'data.zip'));
		writeFileSync(join(dir, 'index.html'), `<html><template id="playwrightReportBase64">data:application/zip;base64,${data}</template></html>`);
		const hits = await scanPaths([dir], secrets);
		expect(hits.map(h => h.file)).toContain(`${join(dir, 'index.html')}!embedded.zip!report.json`);
	});

	describe('secret in a file name', () => {
		const NAME_SECRET = 'fakeNameSecret123456';
		const nameSecrets = [{ name: 'FAKE_NAME_SECRET', value: NAME_SECRET }];

		it('finds it on disk and in a zip entry, and redacts it from the labels', async () => {
			mkdirSync(join(dir, `dir-${NAME_SECRET}`));
			writeFileSync(join(dir, `dir-${NAME_SECRET}`, 'clean.txt'), 'nothing here');
			await zip(join(dir, 'a.zip'), { [`entry-${NAME_SECRET}.txt`]: 'nothing here' });
			const hits = await scanPaths([dir], nameSecrets);
			expect(hits.map(h => h.file).sort()).toEqual([join(dir, 'a.zip!entry-***.txt'), join(dir, 'dir-***')]);
		});

		it('redacts it from an error message', async () => {
			writeFileSync(join(dir, `bad-${NAME_SECRET}.zip`), 'not a zip');
			await expect(scanPaths([dir], nameSecrets)).rejects.toThrow(/bad-\*\*\*\.zip/);
		});
	});

	it('clean tree has no hits', async () => {
		writeFileSync(join(dir, 'clean.txt'), 'nothing here');
		expect(await scanPaths([dir, join(dir, 'missing')], secrets)).toEqual([]);
	});

	it('does not match a raw form shorter than 8 characters', async () => {
		writeFileSync(join(dir, 'short.txt'), 'abc1234');
		expect(await scanPaths([dir], [{ name: 'SHORT', value: 'abc1234' }])).toEqual([]);
	});

	it('corrupt zip throws', async () => {
		writeFileSync(join(dir, 'bad.zip'), Buffer.from(Array.from({ length: 200 }, (_, i) => (i * 37 + 11) % 256)));
		await expect(scanPaths([dir], secrets)).rejects.toThrow(/bad\.zip/);
	});

	function runCli(target: string, extraEnv: Record<string, string>): { status: number; stdout: string; stderr: string } {
		// Child env: real secret names removed so developer values never enter the test.
		const env: NodeJS.ProcessEnv = { ...process.env };
		for (const name of secretEnvNames(process.env)) {
			delete env[name];
		}
		Object.assign(env, extraEnv);
		const cli = resolve(__dirname, '../scripts/scan-for-secrets.ts');
		const result = spawnSync('npx', ['tsx', cli, target], { env, encoding: 'utf8' });
		return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
	}

	it('hit output never contains the value', () => {
		writeFileSync(join(dir, 'log.txt'), `token=${SECRET}`);
		const { status, stdout, stderr } = runCli(dir, { E2E_LEAK_CANARY_KEY: 'fake-canary-value-123456', FAKE_SECRET_KEY: SECRET });
		expect(status).toBe(1);
		expect(stdout).toContain('FAKE_SECRET_KEY');
		expect(stdout).not.toContain(SECRET);
		expect(stderr).not.toContain(SECRET);
	});

	it('CLI exits 2 when the canary key is unset', () => {
		writeFileSync(join(dir, 'log.txt'), 'clean');
		expect(runCli(dir, { FAKE_SECRET_KEY: SECRET }).status).toBe(2);
	});

	it('CLI exits 2 on a corrupt zip', () => {
		writeFileSync(join(dir, 'bad.zip'), Buffer.from(Array.from({ length: 200 }, (_, i) => (i * 37 + 11) % 256)));
		const { status, stderr } = runCli(dir, { E2E_LEAK_CANARY_KEY: 'fake-canary-value-123456', FAKE_SECRET_KEY: SECRET });
		expect(status).toBe(2);
		expect(stderr).not.toContain(SECRET);
	});

	it('scans a symlink to a dirty file outside the tree', async () => {
		const outside = mkdtempSync(join(tmpdir(), 'scan-out-'));
		try {
			writeFileSync(join(outside, 'dirty.txt'), SECRET);
			symlinkSync(join(outside, 'dirty.txt'), join(dir, 'link.txt'));
			const hits = await scanPaths([dir], secrets);
			expect(hits).toEqual([{ file: join(dir, 'link.txt'), name: 'FAKE_SECRET', encoding: 'raw' }]);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it('skips a dangling symlink', async () => {
		symlinkSync(join(dir, 'nowhere'), join(dir, 'dangling'));
		expect(await scanPaths([dir], secrets)).toEqual([]);
	});

	it('terminates on a symlinked directory loop', async () => {
		mkdirSync(join(dir, 'a'));
		writeFileSync(join(dir, 'a', 'log.txt'), SECRET);
		symlinkSync(dir, join(dir, 'a', 'loop'));
		const hits = await scanPaths([dir], secrets);
		expect(hits.length).toBeGreaterThan(0);
	});

	it('treats a zip without a .zip name as a zip', async () => {
		await zip(join(dir, 'attachment.bin'), { 'log.txt': SECRET });
		const hits = await scanPaths([dir], secrets);
		expect(hits).toHaveLength(1);
		expect(hits[0].file.endsWith('attachment.bin!log.txt')).toBe(true);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { secretEnvNames } from './appEnv';
import SecretScanReporter from './secretScanReporter';

const CANARY_NAME = 'E2E_LEAK_CANARY_KEY';
const FAKE_CANARY = 'canary-fake-value-123456';
const FullResult = { status: 'passed' as const, startTime: new Date(), duration: 0 };

describe('SecretScanReporter', () => {
	let tmp: string;
	let savedEnv: NodeJS.ProcessEnv;
	let savedCwd: string;

	beforeEach(() => {
		savedCwd = process.cwd();
		savedEnv = { ...process.env };
		// Drop the developer's real secrets so the scan neither looks for nor reports them.
		for (const name of secretEnvNames(process.env)) {
			delete process.env[name];
		}
		process.env[CANARY_NAME] = FAKE_CANARY;
		tmp = fs.mkdtempSync(join(os.tmpdir(), 'secret-scan-reporter-'));
		process.chdir(tmp);
		fs.mkdirSync('test-results', { recursive: true });
	});

	afterEach(() => {
		process.chdir(savedCwd);
		for (const key of Object.keys(process.env)) {
			if (savedEnv[key] === undefined) {
				delete process.env[key];
			}
		}
		Object.assign(process.env, savedEnv);
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	const marker = () => join(tmp, 'secret-scan', 'clean');

	it('clean run writes the marker', async () => {
		fs.writeFileSync(join('test-results', 'log.txt'), 'nothing to see');
		const result = await new SecretScanReporter().onEnd(FullResult);
		expect(result).toBeUndefined();
		expect(fs.existsSync(marker())).toBe(true);
	});

	it('dirty run removes the marker and fails', async () => {
		fs.mkdirSync('secret-scan');
		fs.writeFileSync(marker(), '');
		fs.writeFileSync(join('test-results', 'log.txt'), `token=${FAKE_CANARY}`);
		const result = await new SecretScanReporter().onEnd(FullResult);
		expect(result).toEqual({ status: 'failed' });
		expect(fs.existsSync(marker())).toBe(false);
	});

	it('scan error fails closed', async () => {
		fs.mkdirSync('secret-scan');
		fs.writeFileSync(marker(), '');
		fs.writeFileSync(join('test-results', 'bad.zip'), 'this is not a zip');
		const result = await new SecretScanReporter().onEnd(FullResult);
		expect(result).toEqual({ status: 'failed' });
		expect(fs.existsSync(marker())).toBe(false);
	});

	it('fails closed when the canary is not set', async () => {
		fs.mkdirSync('secret-scan');
		fs.writeFileSync(marker(), '');
		delete process.env[CANARY_NAME];
		const result = await new SecretScanReporter().onEnd(FullResult);
		expect(result).toEqual({ status: 'failed' });
		expect(fs.existsSync(marker())).toBe(false);
	});

	it('scans PW_JSON_FILE outside the scanned directories', async () => {
		fs.mkdirSync('elsewhere');
		fs.writeFileSync(join('elsewhere', 'report.json'), `{"x":"${FAKE_CANARY}"}`);
		process.env.PW_JSON_FILE = join('elsewhere', 'report.json');
		const result = await new SecretScanReporter().onEnd(FullResult);
		expect(result).toEqual({ status: 'failed' });
		expect(fs.existsSync(marker())).toBe(false);
	});

	it('scans the inspect-ai output directory', async () => {
		fs.mkdirSync(join('test', 'assistant-inspect-ai'), { recursive: true });
		fs.writeFileSync(join('test', 'assistant-inspect-ai', 'r.json'), FAKE_CANARY);
		const result = await new SecretScanReporter().onEnd(FullResult);
		expect(result).toEqual({ status: 'failed' });
	});

	it('never prints a secret, even one in a file name', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => { });
		fs.writeFileSync(join('test-results', `log-${FAKE_CANARY}.txt`), `token=${FAKE_CANARY}`);
		const result = await new SecretScanReporter().onEnd(FullResult);
		expect(result).toEqual({ status: 'failed' });
		const output = errors.mock.calls.flat().join('\n');
		expect(output).toContain(CANARY_NAME);
		expect(output).not.toContain(FAKE_CANARY);
	});

	it('onBegin removes a pre-existing marker', () => {
		fs.mkdirSync('secret-scan');
		fs.writeFileSync(marker(), '');
		new SecretScanReporter().onBegin();
		expect(fs.existsSync(marker())).toBe(false);
	});
});

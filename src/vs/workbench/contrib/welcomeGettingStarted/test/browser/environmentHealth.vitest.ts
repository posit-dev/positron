/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ENVIRONMENT_HEALTH_SOURCES, isEnvironmentHealthResult, pathForItem } from '../../browser/positronWelcomePage/environmentHealth.js';

describe('isEnvironmentHealthResult', () => {
	const item = { id: 'discovery', status: 'pass', summary: 'Positron can discover Python environments' };

	it('accepts a well formed result', () => {
		expect(isEnvironmentHealthResult({ ok: true, items: [item] })).toBe(true);
	});

	it('accepts a well formed fix, and a null one as no fix at all', () => {
		// This crossed the extension host as JSON, where an explicit null survives
		// and an undefined does not, so null has to read as "no fix".
		const fix = { commandId: 'python.installPythonViaUv', label: 'Install Python' };
		expect(isEnvironmentHealthResult({ ok: true, items: [{ ...item, fix }] })).toBe(true);
		expect(isEnvironmentHealthResult({ ok: true, items: [{ ...item, fix: null }] })).toBe(true);
	});

	it('ignores per-language extras it does not read', () => {
		// Python adds interpreterPath, R adds rBinPath and rHome. Rejecting a
		// payload for carrying them would break on every real result.
		expect(isEnvironmentHealthResult({ ok: true, items: [item], interpreterPath: '/usr/bin/python3' })).toBe(true);
	});

	it('rejects an empty item list', () => {
		// The collapse rule uses items.every(...), which is true for [], so an
		// empty list would render "You have successfully set up Python".
		expect(isEnvironmentHealthResult({ ok: true, items: [] })).toBe(false);
	});

	it.each([
		['not an object', 42],
		['null', null],
		['no items', { ok: true }],
		['items not an array', { ok: true, items: 'nope' }],
		['ok not a boolean', { ok: 'yes', items: [item] }],
		['an item missing summary', { ok: true, items: [{ id: 'discovery', status: 'pass' }] }],
		['an item with an unknown status', { ok: true, items: [{ ...item, status: 'exploded' }] }],
		// A broken fix is handed straight to executeCommand: a missing id gets
		// called anyway, and a missing label renders a button reading "undefined"
		// that runs a real command.
		['a fix with no commandId', { ok: true, items: [{ ...item, fix: { label: 'Install Python' } }] }],
		['a fix with no label', { ok: true, items: [{ ...item, fix: { commandId: 'python.installPythonViaUv' } }] }],
		['a fix whose commandId is not a string', { ok: true, items: [{ ...item, fix: { commandId: 42, label: 'Go' } }] }],
	])('rejects %s', (_label, value) => {
		expect(isEnvironmentHealthResult(value)).toBe(false);
	});
});

describe('ENVIRONMENT_HEALTH_SOURCES', () => {
	it('lists python then r, with the ids the environmentHealthService calls', () => {
		expect(ENVIRONMENT_HEALTH_SOURCES.map(s => [s.language, s.extensionId, s.healthCheckCommandId])).toEqual([
			['python', 'ms-python.python', 'python.getEnvironmentHealth'],
			['r', 'positron.positron-r', 'r.getEnvironmentHealth'],
		]);
	});
});

describe('pathForItem', () => {
	const passingPythonInstalled = { id: 'pythonInstalled', status: 'pass', summary: 'A supported Python is installed' } as const;
	const failingPythonInstalled = { id: 'pythonInstalled', status: 'fail', summary: 'A supported Python is installed' } as const;
	const passingRInstalled = { id: 'rInstalled', status: 'pass', summary: 'A supported R is installed' } as const;
	const otherItem = { id: 'environmentReady', status: 'pass', summary: 'The environment is ready to use with Positron' } as const;

	it('returns the interpreter path for a passing pythonInstalled item', () => {
		const result = { ok: true, items: [passingPythonInstalled], interpreterPath: '/usr/bin/python3' };
		expect(pathForItem('python', passingPythonInstalled, result)).toBe('/usr/bin/python3');
	});

	it('returns the R binary path for a passing rInstalled item', () => {
		const result = { ok: true, items: [passingRInstalled], rBinPath: '/usr/lib/R/bin/R' };
		expect(pathForItem('r', passingRInstalled, result)).toBe('/usr/lib/R/bin/R');
	});

	it('returns undefined when the item did not pass', () => {
		const result = { ok: false, items: [failingPythonInstalled], interpreterPath: '/usr/bin/python3' };
		expect(pathForItem('python', failingPythonInstalled, result)).toBeUndefined();
	});

	it('returns undefined for an item that is not the installed-check for its language', () => {
		const result = { ok: true, items: [otherItem], interpreterPath: '/usr/bin/python3' };
		expect(pathForItem('python', otherItem, result)).toBeUndefined();
	});

	it('returns undefined when the language and item id are mismatched', () => {
		// rInstalled only carries a path for R, even if a Python result somehow had it.
		const result = { ok: true, items: [passingRInstalled], rBinPath: '/usr/lib/R/bin/R' };
		expect(pathForItem('python', passingRInstalled, result)).toBeUndefined();
	});

	it('returns undefined when the path field is present but not a string', () => {
		// A payload that crossed the extension host as JSON can be any shape; a
		// wrong type must not reach a JSX text node as-is.
		const result = { ok: true, items: [passingPythonInstalled], interpreterPath: 42 as unknown as string };
		expect(pathForItem('python', passingPythonInstalled, result)).toBeUndefined();
	});
});

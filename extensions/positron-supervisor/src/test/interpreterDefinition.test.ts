/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DefinitionTerminalEnvironment, findInterpreterDefinition, getTerminalMutation, InterpreterDefinition, resolveDefinitionEnv, TerminalEnvironmentCollection } from '../interpreterDefinition';

suite('resolveDefinitionEnv', () => {
	const definition: InterpreterDefinition = {
		language: 'r',
		path: '/opt/R/4.4.3/bin/R',
		label: 'XX',
		env: { R_LIBS_SITE: '/xx' },
	};
	// Start from the real environment, since the OS may add variables to new
	// processes that are missing (e.g. __CF_USER_TEXT_ENCODING on macOS).
	const baseEnv: Record<string, string> = { R_LIBS_SITE: '/default' };
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined) {
			baseEnv[name] = value;
		}
	}
	baseEnv.PATH = '/usr/bin:/bin';
	let dir: string;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interpreter-definition-'));
	});

	teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function writeScript(name: string, contents: string): string {
		const scriptPath = path.join(dir, name);
		fs.writeFileSync(scriptPath, contents);
		return scriptPath;
	}

	test('returns the definition env when there is no startup script', async () => {
		assert.deepStrictEqual(await resolveDefinitionEnv(definition, baseEnv, process.platform), { R_LIBS_SITE: '/xx' });
	});

	test('adds the variables the startup script sets or changes', async function () {
		if (process.platform === 'win32') {
			this.skip();
		}
		// The script sees the definition env, and its output does not leak into the capture.
		const startupScript = writeScript(`it's setup.sh`, [
			'echo loading modules',
			'export LIB_PATH="$R_LIBS_SITE/lib"',
			'export PATH="/opt/tools/bin:$PATH"',
			'UNEXPORTED=1',
		].join('\n'));
		assert.deepStrictEqual(await resolveDefinitionEnv({ ...definition, startupScript }, baseEnv, process.platform), {
			R_LIBS_SITE: '/xx',
			LIB_PATH: '/xx/lib',
			PATH: '/opt/tools/bin:/usr/bin:/bin',
		});
	});

	test('does not report variables the startup script unsets', async function () {
		if (process.platform === 'win32') {
			this.skip();
		}
		// The supervisor can only set variables, so an unset has no effect.
		const startupScript = writeScript('unset.sh', 'unset R_LIBS_SITE\nexport FOO=bar');
		assert.deepStrictEqual(await resolveDefinitionEnv({ ...definition, startupScript }, baseEnv, process.platform), {
			R_LIBS_SITE: '/xx',
			FOO: 'bar',
		});
	});

	test('rejects when the startup script fails', async function () {
		if (process.platform === 'win32') {
			this.skip();
		}
		const startupScript = writeScript('fail.sh', 'return 3');
		await assert.rejects(resolveDefinitionEnv({ ...definition, startupScript }, baseEnv, process.platform));
	});

	test('skips the startup script on Windows but still applies env', async () => {
		const startupScript = writeScript('setup.sh', 'export FOO=bar');
		assert.deepStrictEqual(await resolveDefinitionEnv({ ...definition, startupScript }, baseEnv, 'win32'), { R_LIBS_SITE: '/xx' });
	});
});

suite('getTerminalMutation', () => {
	test('prepends or appends only the added part, and replaces otherwise', () => {
		assert.deepStrictEqual([
			getTerminalMutation('/opt/tools/bin:/usr/bin', '/usr/bin'),
			getTerminalMutation('/usr/bin:/opt/tools/bin', '/usr/bin'),
			getTerminalMutation('/xx', '/default'),
			getTerminalMutation('/xx', undefined),
			getTerminalMutation('/usr/bin', '/usr/bin'),
		], [
			{ type: 'prepend', value: '/opt/tools/bin:' },
			{ type: 'append', value: ':/opt/tools/bin' },
			{ type: 'replace', value: '/xx' },
			{ type: 'replace', value: '/xx' },
			{ type: 'replace', value: '/usr/bin' },
		]);
	});
});

suite('findInterpreterDefinition', () => {
	const definition: InterpreterDefinition = { language: 'r', path: '/opt/R/4.4.3/bin/R', label: 'XX' };

	test('finds the entry by language, label, and path, ignoring malformed setting values', () => {
		assert.deepStrictEqual([
			findInterpreterDefinition([
				null,
				'r',
				{ ...definition, language: 'python' },
				{ ...definition, path: '/opt/R/4.4.4/bin/R' },
				{ ...definition, env: ['R_LIBS_SITE=/bad'] },
				{ ...definition, startupScript: 42 },
				definition,
			], 'r', 'XX', '/opt/R/4.4.3/bin/R'),
			findInterpreterDefinition([{ ...definition, path: '/opt/R/4.4.4/bin/R' }], 'r', 'XX', '/opt/R/4.4.3/bin/R'),
			findInterpreterDefinition(definition, 'r', 'XX', '/opt/R/4.4.3/bin/R'),
			findInterpreterDefinition(undefined, 'r', 'XX', '/opt/R/4.4.3/bin/R'),
		], [definition, undefined, undefined, undefined]);
	});

	test('does not match a retargeted definition with the same label', () => {
		assert.deepStrictEqual([
			findInterpreterDefinition([{ ...definition, path: '/opt/R/4.4.4/bin/R' }], 'r', 'XX', '/opt/R/4.4.3/bin/R'),
			findInterpreterDefinition([{ ...definition, path: '/opt/R/4.4.3/bin/R' }], 'r', 'XX', '/opt/R/4.4.3/bin/R'),
		], [undefined, definition]);
	});
});

suite('DefinitionTerminalEnvironment', () => {
	/** A terminal environment collection that records the variables set in it. */
	class FakeCollection implements TerminalEnvironmentCollection {
		readonly variables = new Map<string, vscode.EnvironmentVariableMutator>();
		writes = 0;

		get(variable: string): vscode.EnvironmentVariableMutator | undefined {
			return this.variables.get(variable);
		}
		forEach(callback: (variable: string) => void): void {
			for (const variable of this.variables.keys()) {
				callback(variable);
			}
		}
		replace(variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {
			this.set(variable, vscode.EnvironmentVariableMutatorType.Replace, value, options);
		}
		prepend(variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {
			this.set(variable, vscode.EnvironmentVariableMutatorType.Prepend, value, options);
		}
		append(variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {
			this.set(variable, vscode.EnvironmentVariableMutatorType.Append, value, options);
		}
		delete(variable: string): void {
			this.variables.delete(variable);
		}
		/** The variables as [name, type, value], for comparing. */
		snapshot(): [string, vscode.EnvironmentVariableMutatorType, string][] {
			return [...this.variables].map(([name, mutator]) => [name, mutator.type, mutator.value]);
		}
		private set(variable: string, type: vscode.EnvironmentVariableMutatorType, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {
			this.writes++;
			this.variables.set(variable, { type, value, options: options ?? {} });
		}
	}

	interface FakeSession {
		metadata: { sessionId: string; sessionMode: positron.LanguageRuntimeSessionMode };
	}

	const { Replace, Prepend } = vscode.EnvironmentVariableMutatorType;
	const mcp = 'POSITRON_MCP_URL';
	const sessions: Record<string, FakeSession> = {
		variant: { metadata: { sessionId: 'variant', sessionMode: positron.LanguageRuntimeSessionMode.Console } },
		plain: { metadata: { sessionId: 'plain', sessionMode: positron.LanguageRuntimeSessionMode.Console } },
		notebook: { metadata: { sessionId: 'notebook', sessionMode: positron.LanguageRuntimeSessionMode.Notebook } },
	};
	const definitionEnvs: Record<string, Record<string, string>> = {
		variant: { R_LIBS_SITE: '/xx', PATH: '/opt/tools/bin:/usr/bin' },
		plain: {},
		notebook: { NOTEBOOK_ONLY: '1' },
	};

	function create(collection: FakeCollection, getDefinitionEnv = async (session: FakeSession) => definitionEnvs[session.metadata.sessionId]) {
		return new DefinitionTerminalEnvironment<FakeSession>(
			collection,
			[mcp],
			async sessionId => sessions[sessionId],
			getDefinitionEnv,
			{ PATH: '/usr/bin' });
	}

	test('removes variables left by a previous window, keeping the preserved ones', () => {
		const collection = new FakeCollection();
		collection.replace(mcp, 'http://localhost:1234');
		collection.replace('R_LIBS_SITE', '/stale');

		create(collection);

		assert.deepStrictEqual(collection.snapshot(), [[mcp, Replace, 'http://localhost:1234']]);
	});

	test('sets the foreground console\'s variables, adding only the part a definition prepends', async () => {
		const collection = new FakeCollection();
		const environment = create(collection);

		await environment.update('variant');

		assert.deepStrictEqual(collection.snapshot(), [
			['R_LIBS_SITE', Replace, '/xx'],
			['PATH', Prepend, '/opt/tools/bin:'],
		]);
	});

	test('removes only its own variables when a console without a definition comes to the foreground', async () => {
		const collection = new FakeCollection();
		const environment = create(collection);
		collection.replace(mcp, 'http://localhost:1234');

		await environment.update('variant');
		await environment.update('plain');

		assert.deepStrictEqual(collection.snapshot(), [[mcp, Replace, 'http://localhost:1234']]);
	});

	test('removes its variables when no session is in the foreground', async () => {
		const collection = new FakeCollection();
		const environment = create(collection);

		await environment.update('variant');
		await environment.update(undefined);

		assert.deepStrictEqual(collection.snapshot(), []);
	});

	test('leaves the console\'s variables in place when a notebook comes to the foreground', async () => {
		const collection = new FakeCollection();
		const environment = create(collection);

		await environment.update('variant');
		await environment.update('notebook');

		assert.deepStrictEqual(collection.snapshot(), [
			['R_LIBS_SITE', Replace, '/xx'],
			['PATH', Prepend, '/opt/tools/bin:'],
		]);
	});

	test('does not rewrite variables that are already set', async () => {
		const collection = new FakeCollection();
		const environment = create(collection);

		await environment.update('variant');
		const writes = collection.writes;
		await environment.update('variant');

		assert.strictEqual(collection.writes, writes);
	});

	test('drops an update that finishes after a newer one started', async () => {
		const collection = new FakeCollection();
		let finishVariant!: () => void;
		const variantResolved = new Promise<void>(resolve => finishVariant = resolve);
		const environment = create(collection, async session => {
			if (session.metadata.sessionId === 'variant') {
				// Slow, as when a restored session's startup script runs.
				await variantResolved;
			}
			return definitionEnvs[session.metadata.sessionId];
		});

		const slow = environment.update('variant');
		await environment.update('plain');
		finishVariant();
		await slow;

		assert.deepStrictEqual(collection.snapshot(), []);
	});
});

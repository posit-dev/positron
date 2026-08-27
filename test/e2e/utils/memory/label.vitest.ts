/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { deriveExtensionName, namedShareGateApplies, normalizeProcessName, resolveRole } from './label.js';

/**
 * Command lines for the child processes the memory-hog deck named as Culprit 1.
 * Real shapes, with the paths shortened to the parts the rules actually read.
 */
const QUARTO_LSP = '/build/bundled/node /home/u/.positron-server/extensions/quarto.quarto-1.135.0-universal/out/lsp/lsp.js --stdio';
const DUCKDB_WORKER = '/build/bundled/node /build/bundled/extensions/positron-duckdb/out/duckdbWorker.js';
const PET_SERVER = '/build/bundled/extensions/positron-python/python-env-tools/pet server';
const AIR_LSP = '/home/u/.positron-server/extensions/posit.air-vscode-0.28.0-linux-x64/bundled/bin/air language-server';
const RUFF_SERVER = '/tmp/extensions-dir/charliermarsh.ruff-2026.70.0-linux-x64/bundled/libs/bin/ruff server';

describe('resolveRole', () => {
	test('names the root process main', () => {
		const { role, labeled } = resolveRole({ positronName: 'positron', cmd: '/opt/positron/positron', isRoot: true });
		expect(role).toBe('main');
		expect(labeled).toBe(true);
	});

	test.each([
		['gpu-process', 'gpu'],
		['utility-network-service', 'network'],
		['shared-process', 'shared'],
		['pty-host', 'pty_host'],
		['window [1] (Welcome)', 'renderer'],
		['window [2] (some-other-title)', 'renderer'],
		['file-watcher [1]', 'file_watcher'],
		['extension-host [1]', 'extension_host'],
		['agent-host', 'agent_host'],
	])('maps the Positron name %s to %s', (positronName, expected) => {
		const { role, labeled } = resolveRole({ positronName, cmd: 'whatever', isRoot: false });
		expect(role).toBe(expected);
		expect(labeled).toBe(true);
	});

	test('window titles do not leak into the role', () => {
		const a = resolveRole({ positronName: 'window [1] (Welcome)', cmd: 'x', isRoot: false });
		const b = resolveRole({ positronName: 'window [1] (my-project)', cmd: 'x', isRoot: false });
		expect(a.role).toBe(b.role);
	});

	test('falls back to argv for a renderer Positron did not name', () => {
		const { role, labeled } = resolveRole({
			cmd: '/opt/positron/positron --type=renderer --standard-schemes=vscode-webview',
			isRoot: false
		});
		expect(role).toBe('renderer');
		expect(labeled).toBe(false);
	});

	test('recognises the kernel supervisor by executable', () => {
		const { role } = resolveRole({
			cmd: '/opt/positron/resources/app/extensions/positron-supervisor/resources/kallichore/kcserver --log-level debug',
			isRoot: false
		});
		expect(role).toBe('kernel_supervisor');
	});

	test('recognises a language server child', () => {
		const { role } = resolveRole({ positronName: 'electron-nodejs (language-server.js)', cmd: 'node language-server.js', isRoot: false });
		expect(role).toBe('language_server');
	});

	test('an unnamed NodeService utility is unlabeled, never guessed', () => {
		const { role, labeled } = resolveRole({
			cmd: '/opt/positron/positron --type=utility --utility-sub-type=node.mojom.NodeService --lang=en-US',
			isRoot: false
		});
		expect(role).toBe('unlabeled');
		expect(labeled).toBe(false);
	});

	test('a completely unknown process is unlabeled rather than throwing', () => {
		const { role, labeled } = resolveRole({ cmd: '/usr/bin/something-new-nobody-predicted', isRoot: false });
		expect(role).toBe('unlabeled');
		expect(labeled).toBe(false);
	});

	test('a process Positron names but we have not mapped stays unlabeled, and records that it was named', () => {
		// The most useful failure mode. Positron introducing a new named
		// utility should surface as "we know what it is called and have not
		// mapped it yet", which is a far better prompt than a generic bucket.
		const { role, labeled } = resolveRole({ positronName: 'some-new-host [1]', cmd: 'positron --type=utility', isRoot: false });
		expect(role).toBe('unlabeled');
		expect(labeled).toBe(true);
	});
});

describe('normalizeProcessName', () => {
	// Every input here is a real name from CI run 31401098950, where these
	// produced eight "distinct" unlabeled names for five actual processes.
	test('drops the pid a language server carries in its command line', () => {
		const a = normalizeProcessName('/build/positron /build/resources/app/extensions/json-language-features/server/dist/node/jsonServerMain --node-ipc --clientProcessId=150');
		const b = normalizeProcessName('/build/positron /build/resources/app/extensions/json-language-features/server/dist/node/jsonServerMain --node-ipc --clientProcessId=161');
		expect(a).toBe(b);
		expect(a).not.toMatch(/\d{3}/);
	});

	test('collapses two installed versions of the same server to one name', () => {
		const older = normalizeProcessName('/tmp/vscsmoke/extensions-dir/charliermarsh.ruff-2026.68.0/bundled/libs/bin/ruff server');
		const newer = normalizeProcessName('/tmp/vscsmoke/extensions-dir/charliermarsh.ruff-2026.70.0-linux-x64/bundled/libs/bin/ruff server');
		expect(older).toBe('ruff server');
		expect(newer).toBe('ruff server');
	});

	test('keeps enough to tell processes apart', () => {
		expect(normalizeProcessName('/build/resources/app/extensions/positron-python/python-env-tools/pet server')).toBe('pet server');
		expect(normalizeProcessName('/usr/bin/bash --init-file /build/resources/app/out/vs/workbench/contrib/terminal/common/scripts/shellIntegration-bash.sh'))
			.toBe('bash shellIntegration-bash.sh --init-file');
	});

	test('drops volatile socket and log paths from the supervisor command line', () => {
		const first = normalizeProcessName('/build/positron /build/extensions/positron-supervisor/resources/kallichore/kcserver --log-file /tmp/kallichore-7fd2f58c-150.log --handshake-socket /tmp/kc-handshake-NxKaM3/s.sock');
		const second = normalizeProcessName('/build/positron /build/extensions/positron-supervisor/resources/kallichore/kcserver --log-file /tmp/kallichore-91ab22de-207.log --handshake-socket /tmp/kc-handshake-QqZz91/s.sock');
		expect(first).toBe(second);
	});

	test('leaves the names Positron reports itself untouched', () => {
		// These never start with a path, and a window title can contain anything.
		expect(normalizeProcessName('window [1] (Welcome - Positron)')).toBe('window [1] (Welcome - Positron)');
		expect(normalizeProcessName('extension-host [1]')).toBe('extension-host [1]');
		expect(normalizeProcessName('gpu-process')).toBe('gpu-process');
	});
});

describe('roles for processes CI surfaced', () => {
	const role = (positronName: string): string => resolveRole({ positronName, cmd: '', isRoot: false }).role;

	test('labels the processes that were unattributed in the first real run', () => {
		expect(role('zygote')).toBe('zygote');
		expect(role('pet server')).toBe('extension_child');
		expect(role('bash shellIntegration-bash.sh --init-file')).toBe('shell');
		expect(role('positron jsonServerMain --node-ipc --clientProcessId')).toBe('language_server');
		expect(role('ruff server')).toBe('language_server');
	});

	test('still labels the processes Positron names outright', () => {
		expect(role('extension-host [1]')).toBe('extension_host');
		expect(role('window [1] (Welcome)')).toBe('renderer');
		expect(role('pty-host')).toBe('pty_host');
	});
});

describe('deriveExtensionName', () => {
	// The deck's Culprit 1: eagerly started servers, all of which today land in
	// the report as an anonymous share of `language_server` or `extension_child`.
	test.each([
		[QUARTO_LSP, 'quarto.quarto (lsp)'],
		[DUCKDB_WORKER, 'positron-duckdb (duckdbWorker)'],
		[PET_SERVER, 'positron-python (pet)'],
	])('names the extension that spawned the process', (cmd, expected) => {
		expect(deriveExtensionName(cmd)).toBe(expected);
	});

	test('drops the executable when the id already says it', () => {
		// `charliermarsh.ruff (ruff)` and `posit.air-vscode (air)` carry no more
		// information than the id alone.
		expect(deriveExtensionName(RUFF_SERVER)).toBe('charliermarsh.ruff');
		expect(deriveExtensionName(AIR_LSP)).toBe('posit.air-vscode');
	});

	test('strips the version so the name is stable across builds', () => {
		const older = deriveExtensionName('/x/extensions/quarto.quarto-1.135.0-universal/out/lsp/lsp.js');
		const newer = deriveExtensionName('/x/extensions/quarto.quarto-1.140.2-universal/out/lsp/lsp.js');
		expect(older).toBe(newer);
	});

	test('returns undefined for a process no extension spawned', () => {
		expect(deriveExtensionName('/opt/positron/positron --type=renderer')).toBeUndefined();
		expect(deriveExtensionName('/usr/bin/bash --init-file /x/shellIntegration-bash.sh')).toBeUndefined();
	});
});

describe('roles for the eagerly started servers', () => {
	const roleOf = (cmd: string): string => resolveRole({ cmd, isRoot: false }).role;

	test('Quarto\'s language server is a language server, not a generic child', () => {
		expect(roleOf(QUARTO_LSP)).toBe('language_server');
	});

	test('the duckdb worker falls back to extension_child rather than unlabeled', () => {
		expect(roleOf(DUCKDB_WORKER)).toBe('extension_child');
	});

	test('the extension fallback cannot steal a process an earlier rule claimed', () => {
		// Both live under /extensions/, so an ordering mistake would re-bucket
		// them into extension_child and silently re-shape the dashboard's history.
		expect(roleOf(AIR_LSP)).toBe('language_server');
		expect(resolveRole({ positronName: 'ruff server', cmd: RUFF_SERVER, isRoot: false }).role).toBe('language_server');
	});

	test('a process outside any extension dir is still unlabeled', () => {
		expect(roleOf('/opt/positron/positron --type=utility --utility-sub-type=node.mojom.NodeService')).toBe('unlabeled');
	});
});

describe('kernel roles', () => {
	const roleOf = (cmd: string): string => resolveRole({ cmd, isRoot: false }).role;

	test('the Python kernel is labeled kernel', () => {
		// Positron never launches ipykernel as a module; it runs its own
		// positron_language_server.py. A rule that only matched
		// `ipykernel_launcher` would never fire, which is exactly the CI failure
		// this test reproduces: "expected a kernel process".
		expect(roleOf('/usr/bin/python3 /opt/positron/resources/app/extensions/positron-python/python_files/posit/positron_language_server.py -f /tmp/kernel-abc.json --logfile /tmp/kernel-abc.log --loglevel=debug --session-mode=console'))
			.toBe('kernel');
	});

	test('the R kernel is still labeled kernel', () => {
		expect(roleOf('/opt/positron/resources/app/extensions/positron-r/resources/ark/ark --connection_file /tmp/kernel-abc.json --log /tmp/kernel-abc.log'))
			.toBe('kernel');
	});
});

describe('names that CI proved wrong', () => {
	// The idle memory scenario runs with its own extensions dir, so the segment
	// is `extensions-dir-memory`. Enumerating dir names missed it and left ruff
	// and air named after their executable instead of their extension.
	const RUFF_IN_MEMORY_DIR = '/data/extensions-dir-memory/charliermarsh.ruff-2026.70.0-linux-x64/bundled/libs/bin/ruff server';
	const AIR_IN_MEMORY_DIR = '/data/extensions-dir-memory/posit.air-vscode-0.28.0-linux-x64/bundled/bin/air language-server';

	test.each([
		['/data/extensions/positron-duckdb/dist/w.js', 'positron-duckdb (w)'],
		['/data/extensions-dir/positron-duckdb/dist/w.js', 'positron-duckdb (w)'],
		['/data/extensions-dir-memory/positron-duckdb/dist/w.js', 'positron-duckdb (w)'],
	])('derives from any extensions dir variant', (cmd, expected) => {
		expect(deriveExtensionName(cmd)).toBe(expected);
	});

	test('names ruff and air after their extension', () => {
		expect(deriveExtensionName(RUFF_IN_MEMORY_DIR)).toBe('charliermarsh.ruff');
		expect(deriveExtensionName(AIR_IN_MEMORY_DIR)).toBe('posit.air-vscode');
	});

	test('electron-nodejs is too generic to identify anything, so argv wins', () => {
		// CI reported Quarto's server as `electron-nodejs (lsp.js)` in
		// `extension_child`. The name says a node process runs lsp.js; it does not
		// say whose. Argv does.
		const { role } = resolveRole({
			positronName: 'electron-nodejs (lsp.js)',
			cmd: '/build/node /data/extensions-dir-memory/quarto.quarto-1.135.0-universal/out/lsp/lsp.js --stdio',
			isRoot: false
		});
		expect(role).toBe('language_server');
	});

	test('electron-nodejs still falls back to extension_child when argv says nothing', () => {
		const { role } = resolveRole({
			positronName: 'electron-nodejs (helper.js)',
			cmd: '/build/node /build/some/helper.js',
			isRoot: false
		});
		expect(role).toBe('extension_child');
	});
});

describe('namedShareGateApplies', () => {
	test('applies on desktop, where --status can name processes', () => {
		expect(namedShareGateApplies('desktop')).toBe(true);
	});

	test('does not apply on server, where --status has no running instance to ask', () => {
		expect(namedShareGateApplies('server')).toBe(false);
	});
});

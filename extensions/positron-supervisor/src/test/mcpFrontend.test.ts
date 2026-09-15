/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { McpWorkspace, McpWorkspaceRegistration } from '../kcclient/api';
import {
	McpFrontend,
	McpFrontendState,
	McpRegistrationApi,
	McpTerminalEnvironment,
	loadMcpState,
	saveMcpState,
} from '../McpFrontend';
import {
	MCP_TOKEN_ENV_VAR,
	MCP_URL_ENV_VAR,
	McpConnectionDescriptor,
	McpConnectionIndex,
	mcpDescriptorPath,
	mcpHeadersPath,
	mcpIndexPath,
} from '../mcpConnection';

/** Records what the frontend publishes into terminals. */
class FakeEnvironment implements McpTerminalEnvironment {
	description: string | undefined;
	readonly variables = new Map<string, string>();

	replace(variable: string, value: string): void {
		this.variables.set(variable, value);
	}

	clear(): void {
		this.variables.clear();
		this.description = undefined;
	}
}

/** Stands in for the workspace state the MCP identity is persisted to. */
class FakeMemento implements vscode.Memento {
	private readonly _values = new Map<string, unknown>();

	keys(): readonly string[] {
		return [...this._values.keys()];
	}

	get<T>(key: string, defaultValue?: T): T | undefined {
		return (this._values.get(key) as T | undefined) ?? defaultValue;
	}

	async update(key: string, value: unknown): Promise<void> {
		this._values.set(key, value);
	}
}

/**
 * Stand-in for the supervisor's workspace registry, issuing one token per
 * workspace ID the way `kcserver` does: re-registering a known ID hands back
 * the token it was first given, and an ID it has never seen is honored with a
 * token of its own. The real server mints an ID from the display name plus a
 * random suffix, so the counter is seedable: a registry standing in for a new
 * server process cannot mint the ID its predecessor issued.
 */
class FakeRegistry implements McpRegistrationApi {
	readonly registrations: McpWorkspaceRegistration[] = [];
	readonly deregistrations: string[] = [];
	private readonly _tokens = new Map<string, string>();

	constructor(private readonly _port = 39000, private _nextId = 1) { }

	async registerMcpWorkspace(
		registration: McpWorkspaceRegistration
	): Promise<{ data: McpWorkspace }> {
		this.registrations.push(registration);
		const workspaceId = registration.workspace_id ?? `workspace-${this._nextId++}`;
		let token = this._tokens.get(workspaceId);
		if (!token) {
			token = `token-${workspaceId}`;
			this._tokens.set(workspaceId, token);
		}
		const port = registration.preferred_port || this._port;
		return {
			// Each workspace gets an endpoint of its own, as `kcserver` issues.
			data: {
				workspace_id: workspaceId,
				token,
				port,
				url: `http://127.0.0.1:${port}/mcp/w/${workspaceId}`,
			}
		};
	}

	async deregisterMcpWorkspace(workspaceId: string): Promise<void> {
		this.deregistrations.push(workspaceId);
		this._tokens.delete(workspaceId);
	}
}

/**
 * The pieces a test needs to drive a frontend: the frontend itself, the
 * terminal environment it publishes to, the registry it talks to, and the
 * workspace state it persists its identity to.
 */
interface Harness {
	frontend: McpFrontend;
	environment: FakeEnvironment;
	/** Stands in for the extension host's own environment. */
	processEnv: NodeJS.ProcessEnv;
	/** Stands in for the extension's global storage. */
	storageUri: vscode.Uri;
	registry: FakeRegistry;
	memento: FakeMemento;
	setEnabled(enabled: boolean): void;
	/** How many times the post-registration hook has run. */
	registrations: number;
}

/**
 * @param memento The workspace state to persist the identity to.
 * @param enabled Whether the feature starts out on.
 * @param shared The storage and supervisor of another window, for the tests
 *  that need two windows on one machine.
 */
function createHarness(
	memento = new FakeMemento(),
	enabled = true,
	shared: { storageUri?: vscode.Uri; registry?: FakeRegistry } = {},
): Harness {
	const environment = new FakeEnvironment();
	const processEnv: NodeJS.ProcessEnv = {};
	const storageUri = shared.storageUri ?? vscode.Uri.file(
		fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-frontend-')));
	const registry = shared.registry ?? new FakeRegistry();
	const harness: Harness = {
		environment,
		processEnv,
		storageUri,
		registry,
		memento,
		registrations: 0,
		setEnabled: (value: boolean) => { enabled = value; },
		frontend: new McpFrontend(
			storageUri,
			environment,
			() => { },
			() => loadMcpState(memento),
			state => saveMcpState(memento, state),
			() => [],
			() => enabled,
			() => { harness.registrations++; },
			processEnv),
	};
	return harness;
}

/** The JSON the frontend has left in a file, if it wrote one. */
function readJson<T>(file: string): T | undefined {
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

/** What the frontend has left in the file agents read the header from. */
function headersFile(harness: Harness, workspaceId: string): unknown {
	return readJson(mcpHeadersPath(harness.storageUri, workspaceId));
}

/** The descriptor the frontend has left for a workspace. */
function descriptorFile(
	harness: Harness,
	workspaceId: string,
): McpConnectionDescriptor | undefined {
	return readJson(mcpDescriptorPath(harness.storageUri, workspaceId));
}

/** The index of the workspaces registered on the harness's machine. */
function indexFile(harness: Harness): McpConnectionIndex | undefined {
	return readJson(mcpIndexPath(harness.storageUri));
}

/** What the harness has persisted for the workspace. */
function savedState(harness: Harness): McpFrontendState {
	return loadMcpState(harness.memento);
}

function lastRegistration(harness: Harness): McpWorkspaceRegistration {
	return harness.registry.registrations[harness.registry.registrations.length - 1];
}

suite('McpFrontend', () => {
	test('registers and publishes the endpoint and token to terminals and extensions', async () => {
		const harness = createHarness();

		await harness.frontend.attach(harness.registry);

		assert.deepStrictEqual(
			{
				connection: harness.frontend.connection,
				saved: savedState(harness),
				variables: Object.fromEntries(harness.environment.variables),
				hasDescription: harness.environment.description !== undefined,
				// Agents an extension spawns, such as Codex in its own panel,
				// inherit the extension host's environment and nothing else.
				processEnv: harness.processEnv,
				// Codex's own extension spawns it with neither, so it is
				// pointed at a file instead.
				headers: headersFile(harness, 'workspace-1'),
			},
			{
				connection: {
					workspaceId: 'workspace-1',
					displayName: vscode.workspace.name ?? 'Empty Workspace',
					port: 39000,
					token: 'token-workspace-1',
					url: 'http://127.0.0.1:39000/mcp/w/workspace-1',
					headersPath: mcpHeadersPath(harness.storageUri, 'workspace-1'),
				},
				saved: { workspaceId: 'workspace-1', port: 39000 },
				variables: {
					[MCP_URL_ENV_VAR]: 'http://127.0.0.1:39000/mcp/w/workspace-1',
					[MCP_TOKEN_ENV_VAR]: 'token-workspace-1',
				},
				hasDescription: true,
				processEnv: {
					[MCP_URL_ENV_VAR]: 'http://127.0.0.1:39000/mcp/w/workspace-1',
					[MCP_TOKEN_ENV_VAR]: 'token-workspace-1',
				},
				headers: { Authorization: 'Bearer token-workspace-1' },
			});
	});

	test('writes a connection descriptor a client can convert to its own dialect', async () => {
		const harness = createHarness();

		await harness.frontend.attach(harness.registry);

		const url = 'http://127.0.0.1:39000/mcp/w/workspace-1';
		assert.deepStrictEqual(
			descriptorFile(harness, 'workspace-1'),
			{
				version: 1,
				workspaceId: 'workspace-1',
				displayName: vscode.workspace.name ?? 'Empty Workspace',
				port: 39000,
				url,
				// Resolved, for the wrapper scripts and proxies that read this
				// file precisely because they inherit no environment.
				token: 'token-workspace-1',
				headers: { Authorization: 'Bearer token-workspace-1' },
				// Interpolated, so this block can be copied into a
				// configuration that is committed or shared.
				mcpServers: {
					positron: {
						title: 'Positron',
						type: 'streamable-http',
						url,
						headers: { Authorization: 'Bearer ${env:POSITRON_MCP_TOKEN}' },
					},
				},
			});
	});

	test('indexes every workspace registered on the machine', async () => {
		const first = createHarness();
		await first.frontend.attach(first.registry);

		// A second window on another folder, sharing this machine's storage and
		// its supervisor. The index is how an agent that knows neither
		// workspace ID finds the one it wants -- and each window derives it
		// from the descriptors on disk, so neither can drop the other's entry.
		const second = createHarness(new FakeMemento(), true, {
			storageUri: first.storageUri,
			registry: first.registry,
		});
		await second.frontend.attach(second.registry);

		assert.deepStrictEqual(
			indexFile(first)!.workspaces['workspace-2'],
			{
				displayName: vscode.workspace.name ?? 'Empty Workspace',
				port: 39000,
				url: 'http://127.0.0.1:39000/mcp/w/workspace-2',
				descriptor: mcpDescriptorPath(first.storageUri, 'workspace-2'),
			});
		assert.deepStrictEqual(
			Object.keys(indexFile(first)!.workspaces).sort(),
			['workspace-1', 'workspace-2']);
	});

	test('registers under the workspace name, which the ID is built from', async () => {
		const harness = createHarness();

		await harness.frontend.attach(harness.registry);

		// The supervisor slugs this into the workspace ID, and therefore into
		// the URL agents are configured with, so it has to be the folder the
		// user has open rather than anything window-shaped.
		assert.strictEqual(
			lastRegistration(harness).display_name,
			vscode.workspace.name ?? 'Empty Workspace');
	});

	test('does not register while the feature is off', async () => {
		const harness = createHarness(new FakeMemento(), false);

		await harness.frontend.attach(harness.registry);

		assert.deepStrictEqual(
			{
				connection: harness.frontend.connection,
				registrations: harness.registry.registrations.length,
				variables: harness.environment.variables.size,
			},
			{ connection: undefined, registrations: 0, variables: 0 });
	});

	test('reattaching with the saved ID recovers the same token', async () => {
		const harness = createHarness();
		await harness.frontend.attach(harness.registry);

		// A window reload: the extension host restarts and reconnects to the
		// same supervisor, so agents in surviving terminals must keep working.
		await harness.frontend.attach(harness.registry);

		assert.deepStrictEqual(
			{
				ids: harness.registry.registrations.map(r => r.workspace_id),
				token: harness.frontend.connection?.token,
			},
			{ ids: [undefined, 'workspace-1'], token: 'token-workspace-1' });
	});

	test('keeps the endpoint URL when a new supervisor takes over', async () => {
		const harness = createHarness();
		await harness.frontend.attach(harness.registry);
		const before = harness.frontend.connection?.url;

		// The supervisor process exits and Positron starts another one, with an
		// empty registry that mints IDs the old one could not have issued. The
		// saved ID has to survive it: the endpoint URL names the workspace, so
		// an agent holding the old URL -- Codex writes it into its
		// configuration, and a terminal that outlived the supervisor still
		// exports it -- is refused by a server that no longer has that
		// workspace.
		const successor = new FakeRegistry(39000, 2);
		await harness.frontend.attach(successor);

		assert.deepStrictEqual(
			{
				before,
				after: harness.frontend.connection?.url,
				published: harness.environment.variables.get(MCP_URL_ENV_VAR),
				requested: successor.registrations[0].workspace_id,
			},
			{
				before: 'http://127.0.0.1:39000/mcp/w/workspace-1',
				after: 'http://127.0.0.1:39000/mcp/w/workspace-1',
				published: 'http://127.0.0.1:39000/mcp/w/workspace-1',
				requested: 'workspace-1',
			});
	});

	test('turning the feature off deregisters and clears the published environment', async () => {
		const harness = createHarness();
		await harness.frontend.attach(harness.registry);

		harness.setEnabled(false);
		await harness.frontend.sync();

		assert.deepStrictEqual(
			{
				connection: harness.frontend.connection,
				deregistrations: harness.registry.deregistrations,
				variables: harness.environment.variables.size,
				processEnv: harness.processEnv,
				headers: headersFile(harness, 'workspace-1'),
				descriptor: descriptorFile(harness, 'workspace-1'),
				indexed: Object.keys(indexFile(harness)!.workspaces),
				// The identity is kept so that re-enabling the feature hands
				// agents back the endpoint URL they are configured with.
				saved: savedState(harness),
			},
			{
				connection: undefined,
				deregistrations: ['workspace-1'],
				variables: 0,
				processEnv: {},
				headers: undefined,
				descriptor: undefined,
				indexed: [],
				saved: { workspaceId: 'workspace-1', port: 39000 },
			});
	});

	test('turning the feature back on registers again, reusing the port', async () => {
		const harness = createHarness();
		await harness.frontend.attach(harness.registry);
		harness.setEnabled(false);
		await harness.frontend.sync();

		harness.setEnabled(true);
		await harness.frontend.sync();

		assert.deepStrictEqual(
			{
				port: harness.frontend.connection?.port,
				preferred: lastRegistration(harness).preferred_port,
			},
			{ port: 39000, preferred: 39000 });
	});

	test('a failed registration leaves the window unregistered', async () => {
		const harness = createHarness();
		const failing: McpRegistrationApi = {
			registerMcpWorkspace: () => Promise.reject(new Error('server refused')),
			deregisterMcpWorkspace: () => Promise.resolve(),
		};

		await harness.frontend.attach(failing);

		assert.deepStrictEqual(
			{
				connection: harness.frontend.connection,
				variables: harness.environment.variables.size,
			},
			{ connection: undefined, variables: 0 });
	});

	test('runs the post-registration hook only once the endpoint is live', async () => {
		const disabled = createHarness(new FakeMemento(), false);
		await disabled.frontend.attach(disabled.registry);

		const failed = createHarness();
		await failed.frontend.attach({
			registerMcpWorkspace: () => Promise.reject(new Error('server refused')),
			deregisterMcpWorkspace: () => Promise.resolve(),
		});

		const registered = createHarness();
		await registered.frontend.attach(registered.registry);

		assert.deepStrictEqual(
			{
				disabled: disabled.registrations,
				failed: failed.registrations,
				registered: registered.registrations,
			},
			{ disabled: 0, failed: 0, registered: 1 });
	});
});

suite('McpFrontend.describeStatus', () => {
	test('describes an active, inactive, and unknown MCP server', () => {
		assert.deepStrictEqual(
			[
				McpFrontend.describeStatus({
					active: true, port: 39000, request_count: 7, workspaces: []
				}),
				McpFrontend.describeStatus({
					active: false, port: 0, request_count: 0, workspaces: []
				}),
				McpFrontend.describeStatus(undefined),
			],
			[
				'MCP: 127.0.0.1:39000 • 7 agent requests',
				'MCP: off',
				undefined,
			]);
	});
});

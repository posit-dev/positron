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
 * the token it was first given, a caller that supplies a token it was issued
 * before keeps it, and anything else is given a token of its own. The real
 * server mints an ID from the display name plus a random suffix, so the counter
 * is seedable: a registry standing in for a new server process cannot mint the
 * ID its predecessor issued, and holds none of its tokens.
 */
class FakeRegistry implements McpRegistrationApi {
	readonly registrations: McpWorkspaceRegistration[] = [];
	readonly deregistrations: string[] = [];
	private readonly _tokens = new Map<string, string>();
	private _nextToken: number;

	/**
	 * @param _port The port the listener is bound to.
	 * @param _nextId Where the ID and token counters start. Seeded so a
	 *  registry standing in for a successor process cannot mint what its
	 *  predecessor issued, which is the whole reason a caller hands a token
	 *  back.
	 */
	constructor(private readonly _port = 39000, private _nextId = 1) {
		this._nextToken = _nextId;
	}

	async registerMcpWorkspace(
		registration: McpWorkspaceRegistration
	): Promise<{ data: McpWorkspace }> {
		this.registrations.push(registration);
		const workspaceId = registration.workspace_id ?? `workspace-${this._nextId++}`;
		const token = registration.token ??
			this._tokens.get(workspaceId) ??
			`token-${this._nextToken++}`;
		this._tokens.set(workspaceId, token);
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
	/** How many times the post-deregistration hook has run. */
	deregistrations: number;
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
		deregistrations: 0,
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
			() => { harness.deregistrations++; },
			processEnv),
	};
	return harness;
}

/** The JSON the frontend has left in a file, if it wrote one. */
function readJson<T>(file: string): T | undefined {
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

/** The folders of the workspace the tests run in, as the frontend reports them. */
function folders(): string[] {
	return (vscode.workspace.workspaceFolders ?? [])
		.filter(folder => folder.uri.scheme === 'file')
		.map(folder => folder.uri.fsPath);
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
			},
			{
				connection: {
					workspaceId: 'workspace-1',
					displayName: vscode.workspace.name ?? 'Empty Workspace',
					port: 39000,
					token: 'token-1',
					url: 'http://127.0.0.1:39000/mcp/w/workspace-1',
					folders: folders(),
				},
				saved: { workspaceId: 'workspace-1', port: 39000, token: 'token-1' },
				variables: {
					[MCP_URL_ENV_VAR]: 'http://127.0.0.1:39000/mcp/w/workspace-1',
					[MCP_TOKEN_ENV_VAR]: 'token-1',
				},
				hasDescription: true,
				processEnv: {
					[MCP_URL_ENV_VAR]: 'http://127.0.0.1:39000/mcp/w/workspace-1',
					[MCP_TOKEN_ENV_VAR]: 'token-1',
				},
			});
	});

	test('writes a connection descriptor for the stdio bridge', async () => {
		const harness = createHarness();

		await harness.frontend.attach(harness.registry);

		const { lastActive, ...descriptor } = descriptorFile(harness, 'workspace-1')!;
		assert.deepStrictEqual(
			{ descriptor, lastActive: !isNaN(Date.parse(lastActive)) },
			{
				descriptor: {
					version: 1,
					workspaceId: 'workspace-1',
					displayName: vscode.workspace.name ?? 'Empty Workspace',
					port: 39000,
					url: 'http://127.0.0.1:39000/mcp/w/workspace-1',
					token: 'token-1',
					// What the stdio bridge finds a workspace by.
					folders: folders(),
				},
				lastActive: true,
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
				descriptor: mcpDescriptorPath(first.storageUri, 'workspace-2'),
				folders: folders(),
				// The bridge prefers the more recent of two workspaces that
				// list the same folder.
				lastActive: descriptorFile(second, 'workspace-2')!.lastActive,
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
			{ ids: [undefined, 'workspace-1'], token: 'token-1' });
	});

	test('keeps the endpoint URL and token when a new supervisor takes over', async () => {
		const harness = createHarness();
		await harness.frontend.attach(harness.registry);

		// The supervisor process exits and Positron starts another one, with an
		// empty registry that mints IDs and tokens the old one could not have
		// issued. Both halves of the endpoint have to survive it, because both
		// outlive the process that issued them: an agent's configuration names
		// the URL, or names the variables a terminal that outlived the
		// supervisor still exports, and a server that has neither the workspace
		// nor its token refuses the connection.
		const successor = new FakeRegistry(39000, 2);
		await harness.frontend.attach(successor);

		assert.deepStrictEqual(
			{
				url: harness.frontend.connection?.url,
				token: harness.frontend.connection?.token,
				publishedUrl: harness.environment.variables.get(MCP_URL_ENV_VAR),
				publishedToken: harness.environment.variables.get(MCP_TOKEN_ENV_VAR),
				requested: successor.registrations[0].workspace_id,
				handedBack: successor.registrations[0].token,
			},
			{
				url: 'http://127.0.0.1:39000/mcp/w/workspace-1',
				token: 'token-1',
				publishedUrl: 'http://127.0.0.1:39000/mcp/w/workspace-1',
				publishedToken: 'token-1',
				requested: 'workspace-1',
				handedBack: 'token-1',
			});
	});

	test('a registration with a supervisor that has been replaced does not stand in for the new one', async () => {
		const harness = createHarness();
		let asked!: () => void;
		const inFlight = new Promise<void>(resolve => { asked = resolve; });
		let answer!: () => void;
		const answered = new Promise<void>(resolve => { answer = resolve; });
		const stale = new FakeRegistry();
		const slow: McpRegistrationApi = {
			registerMcpWorkspace: async registration => {
				asked();
				await answered;
				return stale.registerMcpWorkspace(registration);
			},
			deregisterMcpWorkspace: workspaceId => stale.deregisterMcpWorkspace(workspaceId),
		};
		const successor = new FakeRegistry(39000, 2);

		// The first supervisor answers only after a new one has taken over.
		const first = harness.frontend.attach(slow);
		await inFlight;
		const second = harness.frontend.attach(successor);
		answer();
		await Promise.all([first, second]);

		assert.deepStrictEqual(
			{ stale: stale.registrations.length, successor: successor.registrations.length },
			{ stale: 1, successor: 1 });
	});

	test('adopts a token of the server\'s when it has none to hand back', async () => {
		const harness = createHarness();

		// A server too old to honor the field, or one that finds it malformed,
		// issues a token of its own; the window follows the server rather than
		// holding a credential the endpoint will not accept.
		await harness.frontend.attach({
			registerMcpWorkspace: async () => ({
				data: {
					workspace_id: 'workspace-1',
					token: 'issued-by-the-server',
					port: 39000,
					url: 'http://127.0.0.1:39000/mcp/w/workspace-1',
				},
			}),
			deregisterMcpWorkspace: () => Promise.resolve(),
		});

		assert.deepStrictEqual(
			{
				token: harness.frontend.connection?.token,
				saved: savedState(harness).token,
			},
			{ token: 'issued-by-the-server', saved: 'issued-by-the-server' });
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
				descriptor: undefined,
				indexed: [],
				saved: { workspaceId: 'workspace-1', port: 39000, token: 'token-1' },
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

	test('runs the post-deregistration hook when the feature goes off', async () => {
		const harness = createHarness();
		await harness.frontend.attach(harness.registry);
		harness.setEnabled(false);

		await harness.frontend.sync();

		// Entries an agent was configured with name an endpoint that has just
		// stopped answering, so taking them away belongs here and nowhere else.
		assert.deepStrictEqual(
			{ registrations: harness.registrations, deregistrations: harness.deregistrations },
			{ registrations: 1, deregistrations: 1 });
	});
});

suite('McpFrontend.describeStatus', () => {
	test('describes an active, busy, inactive, and unknown MCP server', () => {
		assert.deepStrictEqual(
			[
				McpFrontend.describeStatus({
					active: true, port: 39000, request_count: 7, workspaces: []
				}),
				McpFrontend.describeStatus({
					active: true, port: 39000, request_count: 7, workspaces: [{
						id: 'workspace-1', display_name: 'project', connected: true,
						clients: [{ id: 1, connected_at: '2026-09-22T10:00:00Z' }],
					}],
				}),
				McpFrontend.describeStatus({
					active: false, port: 0, request_count: 0, workspaces: []
				}),
				McpFrontend.describeStatus(undefined),
			],
			[
				'MCP: 127.0.0.1:39000 • 7 agent requests',
				'MCP: 127.0.0.1:39000 • 7 agent requests • 1 agent connected',
				'MCP: off',
				undefined,
			]);
	});
});

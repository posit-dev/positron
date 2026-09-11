/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { McpWorkspace, McpWorkspaceRegistration } from '../kcclient/api';
import {
	MCP_TOKEN_ENV_VAR,
	MCP_URL_ENV_VAR,
	McpFrontend,
	McpFrontendState,
	McpRegistrationApi,
	McpTerminalEnvironment,
} from '../McpFrontend';

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

/**
 * Stand-in for the supervisor's workspace registry, issuing one token per
 * workspace ID the way `kcserver` does: re-registering a known ID hands back
 * the token it was first given. The real server builds the ID out of the
 * display name; a counter is enough to keep these tests readable.
 */
class FakeRegistry implements McpRegistrationApi {
	readonly registrations: McpWorkspaceRegistration[] = [];
	readonly deregistrations: string[] = [];
	private readonly _tokens = new Map<string, string>();
	private _nextId = 1;

	constructor(private readonly _port = 39000) { }

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
 * terminal environment it publishes to, the registry it talks to, and the state
 * it persists (which stands in for the saved server state).
 */
interface Harness {
	frontend: McpFrontend;
	environment: FakeEnvironment;
	registry: FakeRegistry;
	saved: McpFrontendState;
	setEnabled(enabled: boolean): void;
	/** How many times the post-registration hook has run. */
	registrations: number;
}

function createHarness(saved: McpFrontendState = {}, enabled = true): Harness {
	const environment = new FakeEnvironment();
	const registry = new FakeRegistry();
	const harness: Harness = {
		environment,
		registry,
		saved,
		registrations: 0,
		setEnabled: (value: boolean) => { enabled = value; },
		frontend: new McpFrontend(
			environment,
			() => { },
			() => harness.saved,
			async state => { harness.saved = state; },
			() => [],
			() => enabled,
			() => { harness.registrations++; }),
	};
	return harness;
}

function lastRegistration(harness: Harness): McpWorkspaceRegistration {
	return harness.registry.registrations[harness.registry.registrations.length - 1];
}

suite('McpFrontend', () => {
	test('registers and publishes the endpoint and token to terminals', async () => {
		const harness = createHarness();

		await harness.frontend.attach(harness.registry);

		assert.deepStrictEqual(
			{
				connection: harness.frontend.connection,
				saved: harness.saved,
				variables: Object.fromEntries(harness.environment.variables),
				hasDescription: harness.environment.description !== undefined,
			},
			{
				connection: {
					workspaceId: 'workspace-1',
					port: 39000,
					token: 'token-workspace-1',
					url: 'http://127.0.0.1:39000/mcp/w/workspace-1',
				},
				saved: { workspaceId: 'workspace-1', port: 39000 },
				variables: {
					[MCP_URL_ENV_VAR]: 'http://127.0.0.1:39000/mcp/w/workspace-1',
					[MCP_TOKEN_ENV_VAR]: 'token-workspace-1',
				},
				hasDescription: true,
			});
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
		const harness = createHarness({}, false);

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

	test('turning the feature off deregisters and clears the terminal environment', async () => {
		const harness = createHarness();
		await harness.frontend.attach(harness.registry);

		harness.setEnabled(false);
		await harness.frontend.sync();

		assert.deepStrictEqual(
			{
				connection: harness.frontend.connection,
				deregistrations: harness.registry.deregistrations,
				variables: harness.environment.variables.size,
				// The port is kept so re-enabling reuses it; the ID is not,
				// since deregistration invalidated it along with its token.
				saved: harness.saved,
			},
			{
				connection: undefined,
				deregistrations: ['workspace-1'],
				variables: 0,
				saved: { port: 39000 },
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
		const disabled = createHarness({}, false);
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

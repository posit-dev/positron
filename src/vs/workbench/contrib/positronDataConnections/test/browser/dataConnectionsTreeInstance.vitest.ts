/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IConfigurationChangeEvent } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { DataConnectionNode, DataConnectionsTreeInstance, reloadKey } from '../../browser/classes/dataConnectionsTreeInstance.js';
import { IDataConnectionNodeDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IDataConnectionHandle, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';

function createProfile(overrides: Partial<IDataConnectionProfile> = {}): IDataConnectionProfile {
	return {
		id: 'conn-1',
		driverMetadata: {
			id: 'test-driver',
			name: 'Test Driver',
			iconSvg: '',
			supportedLanguageIds: ['python', 'r'],
		},
		connectionName: 'My Connection',
		mechanismId: 'test-mechanism',
		parameterValues: { host: 'localhost' },
		...overrides,
	};
}

function createHandle(handle: number): IDataConnectionHandle {
	return stubInterface<IDataConnectionHandle>({ handle });
}

/**
 * An entry node for the given profile.
 */
function entryNode(profile: IDataConnectionProfile): DataConnectionNode {
	return { kind: 'entry', entry: { profile } };
}

/**
 * A DTO node. nodeHandle defaults to a throwaway value because the whole point of reloadKey is
 * that it doesn't participate -- tests that care pass it explicitly.
 */
function dtoNode(
	dto: Partial<IDataConnectionNodeDTO> & Pick<IDataConnectionNodeDTO, 'kind' | 'name'>,
	handle = 1
): DataConnectionNode {
	return {
		kind: 'dto',
		dto: { nodeHandle: 99, hasGetChildren: true, hasPreview: false, ...dto },
		handle: createHandle(handle),
	};
}

describe('dataConnectionsTreeInstance reloadKey', () => {
	it('keys an entry on its profile id, so a renamed connection keeps its identity', () => {
		const before = reloadKey(entryNode(createProfile({ connectionName: 'Sales DB' })));
		const after = reloadKey(entryNode(createProfile({ connectionName: 'Sales Warehouse' })));

		expect({ before, after, stable: before === after }).toMatchInlineSnapshot(`
			{
			  "after": "entry:conn-1",
			  "before": "entry:conn-1",
			  "stable": true,
			}
		`);
	});

	it('gives different profiles different keys', () => {
		expect(reloadKey(entryNode(createProfile({ id: 'conn-1' }))))
			.not.toBe(reloadKey(entryNode(createProfile({ id: 'conn-2' }))));
	});

	// The property the whole reload/re-expand path depends on: node handles are minted from a
	// counter on every fetch, so the same logical node comes back with a different handle (and
	// therefore a different node id) and must still match its pre-reload counterpart.
	it('keys a DTO on kind and name, ignoring the per-fetch node handle', () => {
		const before = reloadKey(dtoNode({ kind: 'schema', name: 'public', nodeHandle: 7 }));
		const after = reloadKey(dtoNode({ kind: 'schema', name: 'public', nodeHandle: 412 }));

		expect({ before, after, stable: before === after }).toMatchInlineSnapshot(`
			{
			  "after": "["schema","public"]",
			  "before": "["schema","public"]",
			  "stable": true,
			}
		`);
	});

	it('ignores the originating connection handle, since matching is per sibling level', () => {
		expect(reloadKey(dtoNode({ kind: 'table', name: 'users' }, 1)))
			.toBe(reloadKey(dtoNode({ kind: 'table', name: 'users' }, 2)));
	});

	it('distinguishes a name from a kind, and both from the other DTO fields', () => {
		const keys = [
			reloadKey(dtoNode({ kind: 'table', name: 'users' })),
			reloadKey(dtoNode({ kind: 'view', name: 'users' })),
			reloadKey(dtoNode({ kind: 'table', name: 'orders' })),
			// dataType / isPrimaryKey / hasPreview are not part of the identity: a column whose
			// type changed between fetches is still the same column.
			reloadKey(dtoNode({ kind: 'table', name: 'users', dataType: 'int', isPrimaryKey: true, hasPreview: true })),
		];

		expect(keys).toMatchInlineSnapshot(`
			[
			  "["table","users"]",
			  "["view","users"]",
			  "["table","orders"]",
			  "["table","users"]",
			]
		`);
	});

	// The reason the pair is JSON-encoded rather than concatenated. Under a naive \`\${kind}:\${name}\`
	// both of these pairs would render as 'a:b:c' and the tree would restore the wrong sibling.
	it('does not collide when a name contains the separator', () => {
		expect(reloadKey(dtoNode({ kind: 'a', name: 'b:c' })))
			.not.toBe(reloadKey(dtoNode({ kind: 'a:b', name: 'c' })));
	});

	it('does not collide when a name contains quotes or brackets', () => {
		const keys = [
			reloadKey(dtoNode({ kind: 'table', name: '","' })),
			reloadKey(dtoNode({ kind: 'table', name: '' })),
			reloadKey(dtoNode({ kind: 'table', name: '"]' })),
		];

		expect(new Set(keys).size).toBe(keys.length);
	});

	it('never collides with an entry key', () => {
		// An entry key is 'entry:<id>'; a DTO key is a JSON array, so the two spaces can't meet
		// even for a DTO deliberately named to look like an entry.
		expect(reloadKey(dtoNode({ kind: 'entry', name: 'conn-1' })))
			.not.toBe(reloadKey(entryNode(createProfile({ id: 'conn-1' }))));
	});
});

describe('DataConnectionsTreeInstance', () => {
	const ctx = createTestContainer().build();

	// The tree's id for the single profile these tests use.
	const ENTRY_ID = 'entry:conn-1';

	// The tree's id for the one node under that profile: `dto:<connection handle>:<node handle>`.
	const DTO_ID = 'dto:1:7';

	const profile = createProfile({
		connectionName: 'Test Connection',
		driverMetadata: {
			id: 'test-driver',
			name: 'Test Driver',
			iconSvg: '',
			supportedLanguageIds: [],
		},
		parameterValues: {},
	});

	// Fires when the service's set of live connections changes, which is what drives the tree to
	// rebuild its roots.
	const onDidChangeInstances = new Emitter<IDataConnectionInstance[]>();

	/**
	 * Builds a tree over one profile, connected unless `connected` says otherwise. `setConnected`
	 * flips the profile's live state and notifies the tree, standing in for the service connecting or
	 * disconnecting it.
	 */
	function createTree(
		connected = true,
		discoveredProfiles: IDataConnectionProfile[] = [],
		// Seeded with the indent keys the tree reads, since the real configuration service always
		// has them: both are registered with numeric defaults.
		configurationService = new TestConfigurationService({
			'workbench.tree.indent': 16,
			'dataConnections.tree.indent': 0,
		})
	) {
		// One leaf under the connection, so a test has a real non-entry node to act on. Its node id is
		// DTO_ID below.
		const getChildren = vi.fn(async () => [{
			nodeHandle: 7,
			name: 'flights',
			kind: 'table',
			hasGetChildren: false,
			hasPreview: true,
		}]);
		const instance = stubInterface<IDataConnectionInstance>({
			id: 'instance-1',
			profileId: profile.id,
			connectionHandle: stubInterface<IDataConnectionHandle>({ handle: 1, getChildren }),
		});

		// Held as locals as well as on the stub, so a test can read their call lists (the stub is typed
		// as the interface, where they are plain functions rather than mocks).
		const disconnect = vi.fn(async () => { });
		const disconnectWhenUnused = vi.fn();

		let liveInstance = connected ? instance : undefined;
		const service = stubInterface<IPositronDataConnectionsService>({
			onDidChangeProfiles: Event.None,
			onDidChangeInstances: onDidChangeInstances.event,
			onDidChangeDiscoveredProfiles: Event.None,
			getProfiles: () => [profile],
			getDiscoveredProfiles: () => discoveredProfiles,
			getInstanceForProfile: () => liveInstance,
			connect: async () => instance,
			disconnect,
			disconnectWhenUnused,
			cancelDisconnectWhenUnused: vi.fn(),
		});

		const tree = new DataConnectionsTreeInstance(service, configurationService);
		ctx.disposables.add(tree);

		const setConnected = (nowConnected: boolean) => {
			liveInstance = nowConnected ? instance : undefined;
			onDidChangeInstances.fire(nowConnected ? [instance] : []);
		};

		return { tree, service, getChildren, setConnected, disconnect, disconnectWhenUnused };
	}

	/**
	 * Builds a tree whose connection returns `rootDtos`, with `nodeGetChildren` answering for the
	 * levels below. Separate from createTree, which pins one flat table: breadcrumbing is decided by
	 * what a level's children turn out to be, so these tests need to shape the whole subtree.
	 */
	function createTreeOverNodes(
		rootDtos: IDataConnectionNodeDTO[],
		childrenOf: (nodeHandle: number) => IDataConnectionNodeDTO[]
	) {
		const nodeGetChildren = vi.fn(async (nodeHandle: number) => childrenOf(nodeHandle));
		const instance = stubInterface<IDataConnectionInstance>({
			id: 'instance-1',
			profileId: profile.id,
			connectionHandle: stubInterface<IDataConnectionHandle>({
				handle: 1,
				getChildren: async () => rootDtos,
				nodeGetChildren,
			}),
		});
		const service = stubInterface<IPositronDataConnectionsService>({
			onDidChangeProfiles: Event.None,
			onDidChangeInstances: onDidChangeInstances.event,
			onDidChangeDiscoveredProfiles: Event.None,
			getProfiles: () => [profile],
			getDiscoveredProfiles: () => [],
			getInstanceForProfile: () => instance,
			connect: async () => instance,
			cancelDisconnectWhenUnused: vi.fn(),
		});

		const tree = new DataConnectionsTreeInstance(service, new TestConfigurationService({
			'workbench.tree.indent': 16,
			'dataConnections.tree.indent': 0,
		}));
		ctx.disposables.add(tree);
		return { tree, nodeGetChildren };
	}

	/** A node DTO, defaulting to an expandable, non-previewable one. */
	function nodeDto(overrides: Partial<IDataConnectionNodeDTO> & Pick<IDataConnectionNodeDTO, 'nodeHandle' | 'name' | 'kind'>): IDataConnectionNodeDTO {
		return { hasGetChildren: true, hasPreview: false, ...overrides };
	}

	/** The visible rows as name / breadcrumb prefix / expanded triples. */
	function rows(tree: DataConnectionsTreeInstance) {
		return tree.visibleNodes.map(visible => ({
			name: visible.node.data.kind === 'dto' ? visible.node.data.dto.name : 'connection',
			prefix: visible.node.data.kind === 'dto' ? visible.node.data.labelPrefix : undefined,
			expanded: tree.isExpanded(visible.node.id),
		}));
	}

	it('breadcrumbs a namespace group holding one child into that child, and opens it', async () => {
		// connection > Schemas > public > Tables. Only one schema, so "Schemas" is ceremony.
		const { tree } = createTreeOverNodes(
			[nodeDto({ nodeHandle: 1, name: 'Schemas', kind: 'group-schemas' })],
			nodeHandle => nodeHandle === 1
				? [nodeDto({ nodeHandle: 2, name: 'public', kind: 'schema' })]
				: nodeHandle === 2
					? [nodeDto({ nodeHandle: 3, name: 'Tables', kind: 'group-tables' })]
					: []
		);
		await tree.refresh();
		await tree.expand(ENTRY_ID);

		// The Schemas row is gone; public wears its name and is already open, so the Tables group the
		// user was heading for is on screen without the two clicks that used to stand in front of it.
		expect(rows(tree)).toEqual([
			{ name: 'connection', prefix: undefined, expanded: true },
			{ name: 'public', prefix: 'Schemas', expanded: true },
			{ name: 'Tables', prefix: undefined, expanded: false },
		]);
	});

	it('leaves a namespace group with several children alone, and hands it the children it already fetched', async () => {
		const { tree, nodeGetChildren } = createTreeOverNodes(
			[nodeDto({ nodeHandle: 1, name: 'Schemas', kind: 'group-schemas' })],
			nodeHandle => nodeHandle === 1
				? [
					nodeDto({ nodeHandle: 2, name: 'public', kind: 'schema' }),
					nodeDto({ nodeHandle: 3, name: 'staging', kind: 'schema' }),
				]
				: []
		);
		await tree.refresh();
		await tree.expand(ENTRY_ID);

		// The look-ahead that counted the schemas already has them, so expanding the group costs
		// nothing further -- the count of nodeGetChildren calls doesn't move.
		const callsBeforeExpanding = nodeGetChildren.mock.calls.length;
		await tree.expand('dto:1:1');

		expect({
			rows: rows(tree),
			callsBeforeExpanding,
			callsAfterExpanding: nodeGetChildren.mock.calls.length,
		}).toEqual({
			rows: [
				{ name: 'connection', prefix: undefined, expanded: true },
				{ name: 'Schemas', prefix: undefined, expanded: true },
				{ name: 'public', prefix: undefined, expanded: false },
				{ name: 'staging', prefix: undefined, expanded: false },
			],
			callsBeforeExpanding: 1,
			callsAfterExpanding: 1,
		});
	});

	it('does not breadcrumb an object group, however few children it has', async () => {
		// "Tables" over a lone table still says what that row is, so it keeps its own row.
		const { tree } = createTreeOverNodes(
			[nodeDto({ nodeHandle: 1, name: 'Tables', kind: 'group-tables' })],
			nodeHandle => nodeHandle === 1
				? [nodeDto({ nodeHandle: 2, name: 'flights', kind: 'table', hasGetChildren: false, hasPreview: true })]
				: []
		);
		await tree.refresh();
		await tree.expand(ENTRY_ID);

		expect(rows(tree)).toEqual([
			{ name: 'connection', prefix: undefined, expanded: true },
			{ name: 'Tables', prefix: undefined, expanded: false },
		]);
	});

	it('inherits the workbench tree indent until its own setting overrides it, and follows both live', async () => {
		// The view's own indent at its inheriting default of 0.
		const configurationService = new TestConfigurationService({
			'workbench.tree.indent': 16,
			'dataConnections.tree.indent': 0,
		});
		const { tree } = createTree(true, [], configurationService);

		// Changes reach the tree without a window reload: a user dialing either setting in wants the
		// tree to answer as they drag it.
		const change = async (key: string, value: number) => {
			await configurationService.setUserConfiguration(key, value);
			configurationService.onDidChangeConfigurationEmitter.fire(
				stubInterface<IConfigurationChangeEvent>({
					affectsConfiguration: (affected: string) => affected === key,
				})
			);
			return tree.indentWidth;
		};

		expect({
			inherited: tree.indentWidth,
			// The workbench setting still drives the tree while this view's own is unset.
			workbenchChanged: await change('workbench.tree.indent', 8),
			// Setting the view's own indent takes over from it.
			overridden: await change('dataConnections.tree.indent', 12),
			// The workbench setting no longer reaches the tree while the override stands.
			workbenchIgnored: await change('workbench.tree.indent', 16),
			// Clearing the override back to 0 falls through to the workbench setting again.
			clearedBackToInherit: await change('dataConnections.tree.indent', 0),
		}).toEqual({
			inherited: 16,
			workbenchChanged: 8,
			overridden: 12,
			workbenchIgnored: 12,
			clearedBackToInherit: 16,
		});
	});

	it('lists discovered connections after the saved ones', async () => {
		const discovered = createProfile({
			id: 'discovered:odbc:Pagila',
			connectionName: 'Pagila',
			discovered: true,
		});
		const { tree } = createTree(true, [discovered]);
		await tree.refresh();

		// Saved first, then discovered: on a machine with a large odbc.ini the discoveries can
		// outnumber the user's own connections several times over.
		expect(tree.visibleNodes.map(visible => visible.node.id)).toEqual([
			ENTRY_ID,
			'entry:discovered:odbc:Pagila',
		]);
	});

	it('gives up its use of the connection when a connected entry is collapsed', async () => {
		const { tree, service } = createTree();
		await tree.refresh();
		await tree.expand(ENTRY_ID);

		tree.collapse(ENTRY_ID);

		// The service decides whether that closes the connection now or once the last Data Explorer
		// previewed from it is closed.
		expect(service.disconnectWhenUnused).toHaveBeenCalledWith(profile.id);
	});

	it('does not touch the connection when an entry that is not connected is collapsed', async () => {
		const { tree, service } = createTree(false);
		await tree.refresh();
		await tree.expand(ENTRY_ID);

		tree.collapse(ENTRY_ID);

		expect(service.disconnectWhenUnused).not.toHaveBeenCalled();
	});

	it('cancels a pending close when the entry is expanded again', async () => {
		const { tree, service } = createTree();
		await tree.refresh();
		await tree.expand(ENTRY_ID);
		tree.collapse(ENTRY_ID);

		await tree.expand(ENTRY_ID);

		expect(service.cancelDisconnectWhenUnused).toHaveBeenCalledWith(profile.id);
	});

	it('keeps the loaded subtree across a collapse while the connection is still open', async () => {
		const { tree, getChildren } = createTree();
		await tree.refresh();
		await tree.expand(ENTRY_ID);
		expect(getChildren).toHaveBeenCalledTimes(1);

		tree.collapse(ENTRY_ID);
		await tree.expand(ENTRY_ID);

		// The node handles in the loaded subtree are still valid, so re-expanding costs no round trip.
		expect(getChildren).toHaveBeenCalledTimes(1);
	});

	it('closes the connection and collapses the row when an entry is disconnected', async () => {
		const { tree, disconnect, disconnectWhenUnused } = createTree();
		await tree.refresh();
		await tree.expand(ENTRY_ID);

		await tree.disconnectEntry(ENTRY_ID);

		// An explicit disconnect doesn't wait on the previews the way a collapse does, so it must not
		// route through disconnectWhenUnused; the row collapses because there's nothing left to browse.
		expect({
			closed: disconnect.mock.calls,
			deferred: disconnectWhenUnused.mock.calls.length,
			expanded: tree.isExpanded(ENTRY_ID),
		}).toMatchInlineSnapshot(`
			{
			  "closed": [
			    [
			      "conn-1",
			    ],
			  ],
			  "deferred": 0,
			  "expanded": false,
			}
		`);
	});

	// Only an entry owns a connection, so a node id that resolves to something else -- or to nothing
	// at all -- must not take one down.
	it('does nothing when asked to disconnect a node that is not an entry', async () => {
		const { tree, disconnect } = createTree();
		await tree.refresh();
		await tree.expand(ENTRY_ID);

		await tree.disconnectEntry(DTO_ID);
		await tree.disconnectEntry('entry:no-such-profile');

		expect(disconnect).not.toHaveBeenCalled();
	});

	it('drops the loaded subtree once the connection closes', async () => {
		const { tree, getChildren, setConnected } = createTree();
		await tree.refresh();
		await tree.expand(ENTRY_ID);
		tree.collapse(ENTRY_ID);

		// The connection closes -- here after its last Data Explorer did, which the service drives.
		setConnected(false);

		// Its node handles died with it, so re-expanding has to fetch the subtree again.
		await tree.expand(ENTRY_ID);
		expect(getChildren).toHaveBeenCalledTimes(2);
	});

	it('collapses an entry that was still expanded when its connection closed', async () => {
		const { tree, setConnected } = createTree();
		await tree.refresh();
		await tree.expand(ENTRY_ID);

		// The connection closes under an expanded entry: an edit to its parameters, or the driver
		// dropping it. Dropping the subtree alone would leave the row expanded with no children,
		// which the projection reads as a fetch in flight and renders as a twisty spinning forever.
		setConnected(false);

		expect({
			expanded: tree.isExpanded(ENTRY_ID),
			expandState: tree.visibleNodes[0].expandState,
		}).toEqual({ expanded: false, expandState: 'collapsed' });
	});
});

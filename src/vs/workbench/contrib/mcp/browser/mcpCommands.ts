/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { h } from '../../../../base/browser/dom.js';
import { assertNever } from '../../../../base/common/assert.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { groupBy } from '../../../../base/common/collections.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { autorun, derived } from '../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { isDefined } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { SuggestController } from '../../../../editor/contrib/suggest/browser/suggestController.js';
import { ILocalizedString, localize, localize2 } from '../../../../nls.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { MenuEntryActionViewItem } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { Action2, MenuId, MenuItemAction, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { StorageScope } from '../../../../platform/storage/common/storage.js';
import { spinningLoading } from '../../../../platform/theme/common/iconRegistry.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { ActiveEditorContext, RemoteNameContext, ResourceContextKey, WorkbenchStateContext, WorkspaceFolderCountContext } from '../../../common/contextkeys.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IAccountQuery, IAuthenticationQueryService } from '../../../services/authentication/common/authenticationQuery.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ChatViewId, IChatWidgetService } from '../../chat/browser/chat.js';
import { ChatContextKeys } from '../../chat/common/chatContextKeys.js';
import { ChatModeKind } from '../../chat/common/constants.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { extensionsFilterSubMenu, IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { TEXT_FILE_EDITOR_ID } from '../../files/common/files.js';
import { McpCommandIds } from '../common/mcpCommandIds.js';
import { McpContextKeys } from '../common/mcpContextKeys.js';
import { IMcpRegistry } from '../common/mcpRegistryTypes.js';
import { HasInstalledMcpServersContext, IMcpSamplingService, IMcpServer, IMcpServerStartOpts, IMcpService, InstalledMcpServersViewId, LazyCollectionState, McpCapability, McpConnectionState, McpDefinitionReference, mcpPromptPrefix, McpServerCacheState } from '../common/mcpTypes.js';
import { McpAddConfigurationCommand } from './mcpCommandsAddConfiguration.js';
import { McpResourceQuickAccess, McpResourceQuickPick } from './mcpResourceQuickAccess.js';
import { openPanelChatAndGetWidget } from './openPanelChatAndGetWidget.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import { IRemoteUserDataProfilesService } from '../../../services/userDataProfile/common/remoteUserDataProfiles.js';
import { PICK_WORKSPACE_FOLDER_COMMAND_ID } from '../../../browser/actions/workspaceCommands.js';
import { MCP_CONFIGURATION_KEY, WORKSPACE_STANDALONE_CONFIGURATIONS } from '../../../services/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { CHAT_CONFIG_MENU_ID } from '../../chat/browser/actions/chatActions.js';
import { VIEW_CONTAINER } from '../../extensions/browser/extensions.contribution.js';

// acroynms do not get localized
const category: ILocalizedString = {
	original: 'MCP',
	value: 'MCP',
};

export class ListMcpServerCommand extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.ListServer,
			title: localize2('mcp.list', 'List Servers'),
			icon: Codicon.server,
			category,
			f1: true,
			menu: [{
				when: ContextKeyExpr.and(
					ContextKeyExpr.or(McpContextKeys.hasUnknownTools, McpContextKeys.hasServersWithErrors),
					ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent)
				),
				id: MenuId.ChatExecute,
				group: 'navigation',
				order: 2,
			}],
		});
	}

	override async run(accessor: ServicesAccessor) {
		const mcpService = accessor.get(IMcpService);
		const commandService = accessor.get(ICommandService);
		const quickInput = accessor.get(IQuickInputService);

		type ItemType = { id: string } & IQuickPickItem;

		const store = new DisposableStore();
		const pick = quickInput.createQuickPick<ItemType>({ useSeparators: true });
		pick.placeholder = localize('mcp.selectServer', 'Select an MCP Server');

		store.add(pick);

		store.add(autorun(reader => {
			const servers = groupBy(mcpService.servers.read(reader).slice().sort((a, b) => (a.collection.presentation?.order || 0) - (b.collection.presentation?.order || 0)), s => s.collection.id);
			const firstRun = pick.items.length === 0;
			pick.items = [
				{ id: '$add', label: localize('mcp.addServer', 'Add Server'), description: localize('mcp.addServer.description', 'Add a new server configuration'), alwaysShow: true, iconClass: ThemeIcon.asClassName(Codicon.add) },
				...Object.values(servers).filter(s => s.length).flatMap((servers): (ItemType | IQuickPickSeparator)[] => [
					{ type: 'separator', label: servers[0].collection.label, id: servers[0].collection.id },
					...servers.map(server => ({
						id: server.definition.id,
						label: server.definition.label,
						description: McpConnectionState.toString(server.connectionState.read(reader)),
					})),
				]),
			];

			if (firstRun && pick.items.length > 3) {
				pick.activeItems = pick.items.slice(2, 3) as ItemType[]; // select the first server by default
			}
		}));


		const picked = await new Promise<ItemType | undefined>(resolve => {
			store.add(pick.onDidAccept(() => {
				resolve(pick.activeItems[0]);
			}));
			store.add(pick.onDidHide(() => {
				resolve(undefined);
			}));
			pick.show();
		});

		store.dispose();

		if (!picked) {
			// no-op
		} else if (picked.id === '$add') {
			commandService.executeCommand(McpCommandIds.AddConfiguration);
		} else {
			commandService.executeCommand(McpCommandIds.ServerOptions, picked.id);
		}
	}
}

interface ActionItem extends IQuickPickItem {
	action: 'start' | 'stop' | 'restart' | 'showOutput' | 'config' | 'configSampling' | 'samplingLog' | 'resources';
}

interface AuthActionItem extends IQuickPickItem {
	action: 'disconnect' | 'signout';
	accountQuery: IAccountQuery;
}

export class McpServerOptionsCommand extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.ServerOptions,
			title: localize2('mcp.options', 'Server Options'),
			category,
			f1: false,
		});
	}

	override async run(accessor: ServicesAccessor, id: string): Promise<void> {
		const mcpService = accessor.get(IMcpService);
		const quickInputService = accessor.get(IQuickInputService);
		const mcpRegistry = accessor.get(IMcpRegistry);
		const editorService = accessor.get(IEditorService);
		const commandService = accessor.get(ICommandService);
		const samplingService = accessor.get(IMcpSamplingService);
		const authenticationQueryService = accessor.get(IAuthenticationQueryService);
		const authenticationService = accessor.get(IAuthenticationService);
		const server = mcpService.servers.get().find(s => s.definition.id === id);
		if (!server) {
			return;
		}

		const collection = mcpRegistry.collections.get().find(c => c.id === server.collection.id);
		const serverDefinition = collection?.serverDefinitions.get().find(s => s.id === server.definition.id);

		const items: (ActionItem | AuthActionItem | IQuickPickSeparator)[] = [];
		const serverState = server.connectionState.get();

		items.push({ type: 'separator', label: localize('mcp.actions.status', 'Status') });

		// Only show start when server is stopped or in error state
		if (McpConnectionState.canBeStarted(serverState.state)) {
			items.push({
				label: localize('mcp.start', 'Start Server'),
				action: 'start'
			});
		} else {
			items.push({
				label: localize('mcp.stop', 'Stop Server'),
				action: 'stop'
			});
			items.push({
				label: localize('mcp.restart', 'Restart Server'),
				action: 'restart'
			});
		}

		items.push(...this._getAuthActions(authenticationQueryService, server.definition.id));

		const configTarget = serverDefinition?.presentation?.origin || collection?.presentation?.origin;
		if (configTarget) {
			items.push({
				label: localize('mcp.config', 'Show Configuration'),
				action: 'config',
			});
		}

		items.push({
			label: localize('mcp.showOutput', 'Show Output'),
			action: 'showOutput'
		});

		items.push(
			{ type: 'separator', label: localize('mcp.actions.sampling', 'Sampling') },
			{
				label: localize('mcp.configAccess', 'Configure Model Access'),
				description: localize('mcp.showOutput.description', 'Set the models the server can use via MCP sampling'),
				action: 'configSampling'
			},
		);


		if (samplingService.hasLogs(server)) {
			items.push({
				label: localize('mcp.samplingLog', 'Show Sampling Requests'),
				description: localize('mcp.samplingLog.description', 'Show the sampling requests for this server'),
				action: 'samplingLog',
			});
		}

		const capabilities = server.capabilities.get();
		if (capabilities === undefined || (capabilities & McpCapability.Resources)) {
			items.push({ type: 'separator', label: localize('mcp.actions.resources', 'Resources') });
			items.push({
				label: localize('mcp.resources', 'Browse Resources'),
				action: 'resources',
			});
		}

		const pick = await quickInputService.pick(items, {
			placeHolder: localize('mcp.selectAction', 'Select action for \'{0}\'', server.definition.label),
		});

		if (!pick) {
			return;
		}

		switch (pick.action) {
			case 'start':
				await server.start({ isFromInteraction: true });
				server.showOutput();
				break;
			case 'stop':
				await server.stop();
				break;
			case 'restart':
				await server.stop();
				await server.start({ isFromInteraction: true });
				break;
			case 'disconnect':
				await server.stop();
				await this._handleAuth(authenticationService, pick.accountQuery, server.definition, false);
				break;
			case 'signout':
				await server.stop();
				await this._handleAuth(authenticationService, pick.accountQuery, server.definition, true);
				break;
			case 'showOutput':
				server.showOutput();
				break;
			case 'config':
				editorService.openEditor({
					resource: URI.isUri(configTarget) ? configTarget : configTarget!.uri,
					options: { selection: URI.isUri(configTarget) ? undefined : configTarget!.range }
				});
				break;
			case 'configSampling':
				return commandService.executeCommand(McpCommandIds.ConfigureSamplingModels, server);
			case 'resources':
				return commandService.executeCommand(McpCommandIds.BrowseResources, server);
			case 'samplingLog':
				editorService.openEditor({
					resource: undefined,
					contents: samplingService.getLogText(server),
					label: localize('mcp.samplingLog.title', 'MCP Sampling: {0}', server.definition.label),
				});
				break;
			default:
				assertNever(pick);
		}
	}

	private _getAuthActions(
		authenticationQueryService: IAuthenticationQueryService,
		serverId: string
	): AuthActionItem[] {
		const result: AuthActionItem[] = [];
		// Really, this should only ever have one entry.
		for (const [providerId, accountName] of authenticationQueryService.mcpServer(serverId).getAllAccountPreferences()) {

			const accountQuery = authenticationQueryService.provider(providerId).account(accountName);
			if (!accountQuery.mcpServer(serverId).isAccessAllowed()) {
				continue; // skip accounts that are not allowed
			}
			// If there are multiple allowed servers/extensions, other things are using this provider
			// so we show a disconnect action, otherwise we show a sign out action.
			if (accountQuery.entities().getEntityCount().total > 1) {
				result.push({
					action: 'disconnect',
					label: localize('mcp.disconnect', 'Disconnect Account'),
					description: `(${accountName})`,
					accountQuery
				});
			} else {
				result.push({
					action: 'signout',
					label: localize('mcp.signOut', 'Sign Out'),
					description: `(${accountName})`,
					accountQuery
				});
			}
		}
		return result;
	}

	private async _handleAuth(
		authenticationService: IAuthenticationService,
		accountQuery: IAccountQuery,
		definition: McpDefinitionReference,
		signOut: boolean
	) {
		const { providerId, accountName } = accountQuery;
		accountQuery.mcpServer(definition.id).setAccessAllowed(false, definition.label);
		if (signOut) {
			const accounts = await authenticationService.getAccounts(providerId);
			const account = accounts.find(a => a.label === accountName);
			if (account) {
				const sessions = await authenticationService.getSessions(providerId, undefined, { account });
				for (const session of sessions) {
					await authenticationService.removeSession(providerId, session.id);
				}
			}
		}
	}
}

export class MCPServerActionRendering extends Disposable implements IWorkbenchContribution {
	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IMcpService mcpService: IMcpService,
		@IInstantiationService instaService: IInstantiationService,
		@ICommandService commandService: ICommandService,
	) {
		super();

		const enum DisplayedState {
			None,
			NewTools,
			Error,
			Refreshing,
		}

		const displayedState = derived((reader) => {
			const servers = mcpService.servers.read(reader);
			const serversPerState: IMcpServer[][] = [];
			for (const server of servers) {
				let thisState = DisplayedState.None;
				switch (server.cacheState.read(reader)) {
					case McpServerCacheState.Unknown:
					case McpServerCacheState.Outdated:
						if (server.trusted.read(reader) === false) {
							thisState = DisplayedState.None;
						} else {
							thisState = server.connectionState.read(reader).state === McpConnectionState.Kind.Error ? DisplayedState.Error : DisplayedState.NewTools;
						}
						break;
					case McpServerCacheState.RefreshingFromUnknown:
						thisState = DisplayedState.Refreshing;
						break;
					default:
						thisState = server.connectionState.read(reader).state === McpConnectionState.Kind.Error ? DisplayedState.Error : DisplayedState.None;
						break;
				}

				serversPerState[thisState] ??= [];
				serversPerState[thisState].push(server);
			}

			const unknownServerStates = mcpService.lazyCollectionState.read(reader);
			if (unknownServerStates === LazyCollectionState.LoadingUnknown) {
				serversPerState[DisplayedState.Refreshing] ??= [];
			} else if (unknownServerStates === LazyCollectionState.HasUnknown) {
				serversPerState[DisplayedState.NewTools] ??= [];
			}

			const maxState = (serversPerState.length - 1) as DisplayedState;
			return { state: maxState, servers: serversPerState[maxState] || [] };
		});

		this._store.add(actionViewItemService.register(MenuId.ChatExecute, McpCommandIds.ListServer, (action, options) => {
			if (!(action instanceof MenuItemAction)) {
				return undefined;
			}

			return instaService.createInstance(class extends MenuEntryActionViewItem {

				override render(container: HTMLElement): void {

					super.render(container);
					container.classList.add('chat-mcp');

					const action = h('button.chat-mcp-action', [h('span@icon')]);

					this._register(autorun(r => {
						const { state } = displayedState.read(r);
						const { root, icon } = action;
						this.updateTooltip();
						container.classList.toggle('chat-mcp-has-action', state !== DisplayedState.None);

						if (!root.parentElement) {
							container.appendChild(root);
						}

						root.ariaLabel = this.getLabelForState(displayedState.read(r));
						root.className = 'chat-mcp-action';
						icon.className = '';
						if (state === DisplayedState.NewTools) {
							root.classList.add('chat-mcp-action-new');
							icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.refresh));
						} else if (state === DisplayedState.Error) {
							root.classList.add('chat-mcp-action-error');
							icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.warning));
						} else if (state === DisplayedState.Refreshing) {
							root.classList.add('chat-mcp-action-refreshing');
							icon.classList.add(...ThemeIcon.asClassNameArray(spinningLoading));
						} else {
							root.remove();
						}
					}));
				}

				override async onClick(e: MouseEvent): Promise<void> {
					e.preventDefault();
					e.stopPropagation();

					const { state, servers } = displayedState.get();
					if (state === DisplayedState.NewTools) {
						servers.forEach(server => server.stop().then(() => server.start()));
						mcpService.activateCollections();
					} else if (state === DisplayedState.Refreshing) {
						servers.at(-1)?.showOutput();
					} else if (state === DisplayedState.Error) {
						const server = servers.at(-1);
						if (server) {
							commandService.executeCommand(McpCommandIds.ServerOptions, server.definition.id);
						}
					} else {
						commandService.executeCommand(McpCommandIds.ListServer);
					}
				}

				protected override getTooltip(): string {
					return this.getLabelForState() || super.getTooltip();
				}

				private getLabelForState({ state, servers } = displayedState.get()) {
					if (state === DisplayedState.NewTools) {
						return localize('mcp.newTools', "New tools available ({0})", servers.length || 1);
					} else if (state === DisplayedState.Error) {
						return localize('mcp.toolError', "Error loading {0} tool(s)", servers.length || 1);
					} else if (state === DisplayedState.Refreshing) {
						return localize('mcp.toolRefresh', "Discovering tools...");
					} else {
						return null;
					}
				}


			}, action, { ...options, keybindingNotRenderedWithLabel: true });

		}, Event.fromObservable(displayedState)));
	}
}

export class ResetMcpTrustCommand extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.ResetTrust,
			title: localize2('mcp.resetTrust', "Reset Trust"),
			category,
			f1: true,
			precondition: McpContextKeys.toolsCount.greater(0),
		});
	}

	run(accessor: ServicesAccessor): void {
		const mcpService = accessor.get(IMcpRegistry);
		mcpService.resetTrust();
	}
}


export class ResetMcpCachedTools extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.ResetCachedTools,
			title: localize2('mcp.resetCachedTools', "Reset Cached Tools"),
			category,
			f1: true,
			precondition: McpContextKeys.toolsCount.greater(0),
		});
	}

	run(accessor: ServicesAccessor): void {
		const mcpService = accessor.get(IMcpService);
		mcpService.resetCaches();
	}
}

export class AddConfigurationAction extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.AddConfiguration,
			title: localize2('mcp.addConfiguration', "Add Server..."),
			metadata: {
				description: localize2('mcp.addConfiguration.description', "Installs a new Model Context protocol to the mcp.json settings"),
			},
			category,
			f1: true,
			menu: {
				id: MenuId.EditorContent,
				when: ContextKeyExpr.and(
					ContextKeyExpr.regex(ResourceContextKey.Path.key, /\.vscode[/\\]mcp\.json$/),
					ActiveEditorContext.isEqualTo(TEXT_FILE_EDITOR_ID)
				)
			}
		});
	}

	async run(accessor: ServicesAccessor, configUri?: string): Promise<void> {
		const instantiationService = accessor.get(IInstantiationService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const target = configUri ? workspaceService.getWorkspaceFolder(URI.parse(configUri)) : undefined;
		return instantiationService.createInstance(McpAddConfigurationCommand, target ?? undefined).run();
	}
}


export class RemoveStoredInput extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.RemoveStoredInput,
			title: localize2('mcp.resetCachedTools', "Reset Cached Tools"),
			category,
			f1: false,
		});
	}

	run(accessor: ServicesAccessor, scope: StorageScope, id?: string): void {
		accessor.get(IMcpRegistry).clearSavedInputs(scope, id);
	}
}

export class EditStoredInput extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.EditStoredInput,
			title: localize2('mcp.editStoredInput', "Edit Stored Input"),
			category,
			f1: false,
		});
	}

	run(accessor: ServicesAccessor, inputId: string, uri: URI | undefined, configSection: string, target: ConfigurationTarget): void {
		const workspaceFolder = uri && accessor.get(IWorkspaceContextService).getWorkspaceFolder(uri);
		accessor.get(IMcpRegistry).editSavedInput(inputId, workspaceFolder || undefined, configSection, target);
	}
}

export class ShowConfiguration extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.ShowConfiguration,
			title: localize2('mcp.command.showConfiguration', "Show Configuration"),
			category,
			f1: false,
		});
	}

	run(accessor: ServicesAccessor, collectionId: string, serverId: string): void {
		const collection = accessor.get(IMcpRegistry).collections.get().find(c => c.id === collectionId);
		if (!collection) {
			return;
		}

		const server = collection?.serverDefinitions.get().find(s => s.id === serverId);
		const editorService = accessor.get(IEditorService);
		if (server?.presentation?.origin) {
			editorService.openEditor({
				resource: server.presentation.origin.uri,
				options: { selection: server.presentation.origin.range }
			});
		} else if (collection.presentation?.origin) {
			editorService.openEditor({
				resource: collection.presentation.origin,
			});
		}
	}
}

export class ShowOutput extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.ShowOutput,
			title: localize2('mcp.command.showOutput', "Show Output"),
			category,
			f1: false,
		});
	}

	run(accessor: ServicesAccessor, serverId: string): void {
		accessor.get(IMcpService).servers.get().find(s => s.definition.id === serverId)?.showOutput();
	}
}

export class RestartServer extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.RestartServer,
			title: localize2('mcp.command.restartServer', "Restart Server"),
			category,
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, serverId: string, opts?: IMcpServerStartOpts) {
		const s = accessor.get(IMcpService).servers.get().find(s => s.definition.id === serverId);
		s?.showOutput();
		await s?.stop();
		await s?.start({ isFromInteraction: true, ...opts });
	}
}

export class StartServer extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.StartServer,
			title: localize2('mcp.command.startServer', "Start Server"),
			category,
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, serverId: string, opts?: IMcpServerStartOpts) {
		const s = accessor.get(IMcpService).servers.get().find(s => s.definition.id === serverId);
		await s?.start({ isFromInteraction: true, ...opts });
	}
}

export class StopServer extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.StopServer,
			title: localize2('mcp.command.stopServer', "Stop Server"),
			category,
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, serverId: string) {
		const s = accessor.get(IMcpService).servers.get().find(s => s.definition.id === serverId);
		await s?.stop();
	}
}

export class McpBrowseCommand extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.Browse,
			title: localize2('mcp.command.browse', "MCP Servers"),
			category,
			menu: [{
				id: extensionsFilterSubMenu,
				group: '1_predefined',
				order: 1,
			}],
		});
	}

	async run(accessor: ServicesAccessor) {
		accessor.get(IExtensionsWorkbenchService).openSearch('@mcp ');
	}
}

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: McpCommandIds.Browse,
		title: localize2('mcp.command.browse.mcp', "Browse Servers"),
		category
	},
});

export class BrowseMcpServersPageCommand extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.BrowsePage,
			title: localize2('mcp.command.open', "Browse MCP Servers"),
			icon: Codicon.globe,
			menu: [{
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', InstalledMcpServersViewId),
				group: 'navigation',
			}],
		});
	}

	async run(accessor: ServicesAccessor) {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);
		return openerService.open(productService.quality === 'insider' ? 'https://code.visualstudio.com/insider/mcp' : 'https://code.visualstudio.com/mcp');
	}
}

export class ShowInstalledMcpServersCommand extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.ShowInstalled,
			title: localize2('mcp.command.show.installed', "Show Installed Servers"),
			category,
			precondition: HasInstalledMcpServersContext,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor) {
		const viewsService = accessor.get(IViewsService);
		const view = await viewsService.openView(InstalledMcpServersViewId, true);
		if (!view) {
			await viewsService.openViewContainer(VIEW_CONTAINER.id);
			await viewsService.openView(InstalledMcpServersViewId, true);
		}
	}
}

MenuRegistry.appendMenuItem(CHAT_CONFIG_MENU_ID, {
	command: {
		id: McpCommandIds.ShowInstalled,
		title: localize2('mcp.servers', "MCP Servers")
	},
	when: ContextKeyExpr.and(ChatContextKeys.enabled, ContextKeyExpr.equals('view', ChatViewId)),
	order: 14,
	group: '0_level'
});

abstract class OpenMcpResourceCommand extends Action2 {
	protected abstract getURI(accessor: ServicesAccessor): Promise<URI>;

	async run(accessor: ServicesAccessor) {
		const fileService = accessor.get(IFileService);
		const editorService = accessor.get(IEditorService);
		const resource = await this.getURI(accessor);
		if (!(await fileService.exists(resource))) {
			await fileService.createFile(resource, VSBuffer.fromString(JSON.stringify({ servers: {} }, null, '\t')));
		}
		await editorService.openEditor({ resource });
	}
}

export class OpenUserMcpResourceCommand extends OpenMcpResourceCommand {
	constructor() {
		super({
			id: McpCommandIds.OpenUserMcp,
			title: localize2('mcp.command.openUserMcp', "Open User Configuration"),
			category,
			f1: true
		});
	}

	protected override getURI(accessor: ServicesAccessor): Promise<URI> {
		const userDataProfileService = accessor.get(IUserDataProfileService);
		return Promise.resolve(userDataProfileService.currentProfile.mcpResource);
	}
}

export class OpenRemoteUserMcpResourceCommand extends OpenMcpResourceCommand {
	constructor() {
		super({
			id: McpCommandIds.OpenRemoteUserMcp,
			title: localize2('mcp.command.openRemoteUserMcp', "Open Remote User Configuration"),
			category,
			f1: true,
			precondition: RemoteNameContext.notEqualsTo('')
		});
	}

	protected override async getURI(accessor: ServicesAccessor): Promise<URI> {
		const userDataProfileService = accessor.get(IUserDataProfileService);
		const remoteUserDataProfileService = accessor.get(IRemoteUserDataProfilesService);
		const remoteProfile = await remoteUserDataProfileService.getRemoteProfile(userDataProfileService.currentProfile);
		return remoteProfile.mcpResource;
	}
}

export class OpenWorkspaceFolderMcpResourceCommand extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.OpenWorkspaceFolderMcp,
			title: localize2('mcp.command.openWorkspaceFolderMcp', "Open Workspace Folder MCP Configuration"),
			category,
			f1: true,
			precondition: WorkspaceFolderCountContext.notEqualsTo(0)
		});
	}

	async run(accessor: ServicesAccessor) {
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const commandService = accessor.get(ICommandService);
		const editorService = accessor.get(IEditorService);
		const workspaceFolders = workspaceContextService.getWorkspace().folders;
		const workspaceFolder = workspaceFolders.length === 1 ? workspaceFolders[0] : await commandService.executeCommand<IWorkspaceFolder>(PICK_WORKSPACE_FOLDER_COMMAND_ID);
		if (workspaceFolder) {
			await editorService.openEditor({ resource: workspaceFolder.toResource(WORKSPACE_STANDALONE_CONFIGURATIONS[MCP_CONFIGURATION_KEY]) });
		}
	}
}

export class OpenWorkspaceMcpResourceCommand extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.OpenWorkspaceMcp,
			title: localize2('mcp.command.openWorkspaceMcp', "Open Workspace MCP Configuration"),
			category,
			f1: true,
			precondition: WorkbenchStateContext.isEqualTo('workspace')
		});
	}

	async run(accessor: ServicesAccessor) {
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const editorService = accessor.get(IEditorService);
		const workspaceConfiguration = workspaceContextService.getWorkspace().configuration;
		if (workspaceConfiguration) {
			await editorService.openEditor({ resource: workspaceConfiguration });
		}
	}
}

export class McpBrowseResourcesCommand extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.BrowseResources,
			title: localize2('mcp.browseResources', "Browse Resources..."),
			category,
			precondition: McpContextKeys.serverCount.greater(0),
			f1: true,
		});
	}

	run(accessor: ServicesAccessor, server?: IMcpServer): void {
		if (server) {
			accessor.get(IInstantiationService).createInstance(McpResourceQuickPick, server).pick();
		} else {
			accessor.get(IQuickInputService).quickAccess.show(McpResourceQuickAccess.PREFIX);
		}
	}
}

export class McpConfigureSamplingModels extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.ConfigureSamplingModels,
			title: localize2('mcp.configureSamplingModels', "Configure SamplingModel"),
			category,
		});
	}

	async run(accessor: ServicesAccessor, server: IMcpServer): Promise<number> {
		const quickInputService = accessor.get(IQuickInputService);
		const lmService = accessor.get(ILanguageModelsService);
		const mcpSampling = accessor.get(IMcpSamplingService);

		const existingIds = new Set(mcpSampling.getConfig(server).allowedModels);
		const allItems: IQuickPickItem[] = lmService.getLanguageModelIds().map(id => {
			const model = lmService.lookupLanguageModel(id)!;
			if (!model.isUserSelectable) {
				return undefined;
			}
			return {
				label: model.name,
				description: model.description,
				id,
				picked: existingIds.size ? existingIds.has(id) : model.isDefault,
			};
		}).filter(isDefined);

		allItems.sort((a, b) => (b.picked ? 1 : 0) - (a.picked ? 1 : 0) || a.label.localeCompare(b.label));

		// do the quickpick selection
		const picked = await quickInputService.pick(allItems, {
			placeHolder: localize('mcp.configureSamplingModels.ph', 'Pick the models {0} can access via MCP sampling', server.definition.label),
			canPickMany: true,
		});

		if (picked) {
			await mcpSampling.updateConfig(server, c => c.allowedModels = picked.map(p => p.id!));
		}

		return picked?.length || 0;
	}
}

export class McpStartPromptingServerCommand extends Action2 {
	constructor() {
		super({
			id: McpCommandIds.StartPromptForServer,
			title: localize2('mcp.startPromptingServer', "Start Prompting Server"),
			category,
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, server: IMcpServer): Promise<void> {
		const widget = await openPanelChatAndGetWidget(accessor.get(IViewsService), accessor.get(IChatWidgetService));
		if (!widget) {
			return;
		}

		const editor = widget.inputEditor;
		const model = editor.getModel();
		if (!model) {
			return;
		}

		const range = (editor.getSelection() || model.getFullModelRange()).collapseToEnd();
		const text = mcpPromptPrefix(server.definition) + '.';

		model.applyEdits([{ range, text }]);
		editor.setSelection(Range.fromPositions(range.getEndPosition().delta(0, text.length)));
		widget.focusInput();
		SuggestController.get(editor)?.triggerSuggest();
	}
}

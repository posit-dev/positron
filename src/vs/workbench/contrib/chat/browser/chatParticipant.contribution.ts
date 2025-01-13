/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce, isNonEmptyArray } from '../../../../base/common/arrays.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Event } from '../../../../base/common/event.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import * as strings from '../../../../base/common/strings.js';
import { localize, localize2 } from '../../../../nls.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainer, ViewContainerLocation, Extensions as ViewExtensions } from '../../../common/views.js';
import { isProposedApiEnabled } from '../../../services/extensions/common/extensions.js';
import * as extensionsRegistry from '../../../services/extensions/common/extensionsRegistry.js';
import { showExtensionsWithIdsCommandId } from '../../extensions/browser/extensionsActions.js';
import { IExtension, IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { ChatAgentLocation, IChatAgentData, IChatAgentService } from '../common/chatAgents.js';
import { ChatContextKeys } from '../common/chatContextKeys.js';
import { IRawChatParticipantContribution } from '../common/chatParticipantContribTypes.js';
import { ChatViewId } from './chat.js';
import { CHAT_EDITING_SIDEBAR_PANEL_ID, CHAT_SIDEBAR_PANEL_ID, ChatViewPane } from './chatViewPane.js';

const chatParticipantExtensionPoint = extensionsRegistry.ExtensionsRegistry.registerExtensionPoint<IRawChatParticipantContribution[]>({
	extensionPoint: 'chatParticipants',
	jsonSchema: {
		description: localize('vscode.extension.contributes.chatParticipant', 'Contributes a chat participant'),
		type: 'array',
		items: {
			additionalProperties: false,
			type: 'object',
			defaultSnippets: [{ body: { name: '', description: '' } }],
			required: ['name', 'id'],
			properties: {
				id: {
					description: localize('chatParticipantId', "A unique id for this chat participant."),
					type: 'string'
				},
				name: {
					description: localize('chatParticipantName', "User-facing name for this chat participant. The user will use '@' with this name to invoke the participant. Name must not contain whitespace."),
					type: 'string',
					pattern: '^[\\w-]+$'
				},
				fullName: {
					markdownDescription: localize('chatParticipantFullName', "The full name of this chat participant, which is shown as the label for responses coming from this participant. If not provided, {0} is used.", '`name`'),
					type: 'string'
				},
				description: {
					description: localize('chatParticipantDescription', "A description of this chat participant, shown in the UI."),
					type: 'string'
				},
				isSticky: {
					description: localize('chatCommandSticky', "Whether invoking the command puts the chat into a persistent mode, where the command is automatically added to the chat input for the next message."),
					type: 'boolean'
				},
				sampleRequest: {
					description: localize('chatSampleRequest', "When the user clicks this participant in `/help`, this text will be submitted to the participant."),
					type: 'string'
				},
				when: {
					description: localize('chatParticipantWhen', "A condition which must be true to enable this participant."),
					type: 'string'
				},
				disambiguation: {
					description: localize('chatParticipantDisambiguation', "Metadata to help with automatically routing user questions to this chat participant. You must add `contribChatParticipantDetection` to `enabledApiProposals` to use this API."),
					type: 'array',
					items: {
						additionalProperties: false,
						type: 'object',
						defaultSnippets: [{ body: { category: '', description: '', examples: [] } }],
						required: ['category', 'description', 'examples'],
						properties: {
							category: {
								markdownDescription: localize('chatParticipantDisambiguationCategory', "A detailed name for this category, e.g. `workspace_questions` or `web_questions`."),
								type: 'string'
							},
							description: {
								description: localize('chatParticipantDisambiguationDescription', "A detailed description of the kinds of questions that are suitable for this chat participant."),
								type: 'string'
							},
							examples: {
								description: localize('chatParticipantDisambiguationExamples', "A list of representative example questions that are suitable for this chat participant."),
								type: 'array'
							},
						}
					}
				},
				commands: {
					markdownDescription: localize('chatCommandsDescription', "Commands available for this chat participant, which the user can invoke with a `/`."),
					type: 'array',
					items: {
						additionalProperties: false,
						type: 'object',
						defaultSnippets: [{ body: { name: '', description: '' } }],
						required: ['name'],
						properties: {
							name: {
								description: localize('chatCommand', "A short name by which this command is referred to in the UI, e.g. `fix` or * `explain` for commands that fix an issue or explain code. The name should be unique among the commands provided by this participant."),
								type: 'string'
							},
							description: {
								description: localize('chatCommandDescription', "A description of this command."),
								type: 'string'
							},
							when: {
								description: localize('chatCommandWhen', "A condition which must be true to enable this command."),
								type: 'string'
							},
							sampleRequest: {
								description: localize('chatCommandSampleRequest', "When the user clicks this command in `/help`, this text will be submitted to the participant."),
								type: 'string'
							},
							isSticky: {
								description: localize('chatCommandSticky', "Whether invoking the command puts the chat into a persistent mode, where the command is automatically added to the chat input for the next message."),
								type: 'boolean'
							},
							disambiguation: {
								description: localize('chatCommandDisambiguation', "Metadata to help with automatically routing user questions to this chat command. You must add `contribChatParticipantDetection` to `enabledApiProposals` to use this API."),
								type: 'array',
								items: {
									additionalProperties: false,
									type: 'object',
									defaultSnippets: [{ body: { category: '', description: '', examples: [] } }],
									required: ['category', 'description', 'examples'],
									properties: {
										category: {
											markdownDescription: localize('chatCommandDisambiguationCategory', "A detailed name for this category, e.g. `workspace_questions` or `web_questions`."),
											type: 'string'
										},
										description: {
											description: localize('chatCommandDisambiguationDescription', "A detailed description of the kinds of questions that are suitable for this chat command."),
											type: 'string'
										},
										examples: {
											description: localize('chatCommandDisambiguationExamples', "A list of representative example questions that are suitable for this chat command."),
											type: 'array'
										},
									}
								}
							}
						}
					}
				},
			}
		}
	},
	activationEventsGenerator: (contributions: IRawChatParticipantContribution[], result: { push(item: string): void }) => {
		for (const contrib of contributions) {
			result.push(`onChatParticipant:${contrib.id}`);
		}
	},
});

export class ChatExtensionPointHandler implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatExtensionPointHandler';

	private _viewContainer: ViewContainer;
	private _participantRegistrationDisposables = new DisposableMap<string>();

	constructor(
		@IChatAgentService private readonly _chatAgentService: IChatAgentService,
		@ILogService private readonly logService: ILogService
	) {
		this._viewContainer = this.registerViewContainer();
		this.registerDefaultParticipantView();
		this.registerChatEditingView();
		this.handleAndRegisterChatExtensions();
	}

	private handleAndRegisterChatExtensions(): void {
		chatParticipantExtensionPoint.setHandler((extensions, delta) => {
			for (const extension of delta.added) {
				for (const providerDescriptor of extension.value) {
					if (!providerDescriptor.name?.match(/^[\w-]+$/)) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT register participant with invalid name: ${providerDescriptor.name}. Name must match /^[\\w-]+$/.`);
						continue;
					}

					if (providerDescriptor.fullName && strings.AmbiguousCharacters.getInstance(new Set()).containsAmbiguousCharacter(providerDescriptor.fullName)) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT register participant with fullName that contains ambiguous characters: ${providerDescriptor.fullName}.`);
						continue;
					}

					// Spaces are allowed but considered "invisible"
					if (providerDescriptor.fullName && strings.InvisibleCharacters.containsInvisibleCharacter(providerDescriptor.fullName.replace(/ /g, ''))) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT register participant with fullName that contains invisible characters: ${providerDescriptor.fullName}.`);
						continue;
					}

					if (providerDescriptor.isDefault && !isProposedApiEnabled(extension.description, 'defaultChatParticipant')) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT use API proposal: defaultChatParticipant.`);
						continue;
					}

					if ((providerDescriptor.defaultImplicitVariables || providerDescriptor.locations) && !isProposedApiEnabled(extension.description, 'chatParticipantAdditions')) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT use API proposal: chatParticipantAdditions.`);
						continue;
					}

					if (!providerDescriptor.id || !providerDescriptor.name) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT register participant without both id and name.`);
						continue;
					}

					const participantsDisambiguation: {
						category: string;
						description: string;
						examples: string[];
					}[] = [];

					if (providerDescriptor.disambiguation?.length) {
						participantsDisambiguation.push(...providerDescriptor.disambiguation.map((d) => ({
							...d, category: d.category ?? d.categoryName
						})));
					}

					try {
						const store = new DisposableStore();
						store.add(this._chatAgentService.registerAgent(
							providerDescriptor.id,
							{
								extensionId: extension.description.identifier,
								publisherDisplayName: extension.description.publisherDisplayName ?? extension.description.publisher, // May not be present in OSS
								extensionPublisherId: extension.description.publisher,
								extensionDisplayName: extension.description.displayName ?? extension.description.name,
								id: providerDescriptor.id,
								description: providerDescriptor.description,
								when: providerDescriptor.when,
								metadata: {
									isSticky: providerDescriptor.isSticky,
									sampleRequest: providerDescriptor.sampleRequest,
								},
								name: providerDescriptor.name,
								fullName: providerDescriptor.fullName,
								isDefault: providerDescriptor.isDefault,
								locations: isNonEmptyArray(providerDescriptor.locations) ?
									providerDescriptor.locations.map(ChatAgentLocation.fromRaw) :
									[ChatAgentLocation.Panel],
								slashCommands: providerDescriptor.commands ?? [],
								disambiguation: coalesce(participantsDisambiguation.flat()),
							} satisfies IChatAgentData));

						this._participantRegistrationDisposables.set(
							getParticipantKey(extension.description.identifier, providerDescriptor.id),
							store
						);
					} catch (e) {
						this.logService.error(`Failed to register participant ${providerDescriptor.id}: ${toErrorMessage(e, true)}`);
					}
				}
			}

			for (const extension of delta.removed) {
				for (const providerDescriptor of extension.value) {
					this._participantRegistrationDisposables.deleteAndDispose(getParticipantKey(extension.description.identifier, providerDescriptor.id));
				}
			}
		});
	}

	private registerViewContainer(): ViewContainer {
		// Register View Container
		const title = localize2('chat.viewContainer.label', "Chat");
		const icon = Codicon.commentDiscussion;
		const viewContainerId = CHAT_SIDEBAR_PANEL_ID;
		const viewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
			id: viewContainerId,
			title,
			icon,
			ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [viewContainerId, { mergeViewWithContainerWhenSingleView: true }]),
			storageId: viewContainerId,
			hideIfEmpty: true,
			order: 100,
		}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });

		return viewContainer;
	}

	private registerDefaultParticipantView(): IDisposable {
		const viewDescriptor: IViewDescriptor[] = [{
			id: ChatViewId,
			containerIcon: this._viewContainer.icon,
			containerTitle: this._viewContainer.title.value,
			singleViewPaneContainerTitle: this._viewContainer.title.value,
			name: localize2('chat.viewContainer.label', "Chat"),
			canToggleVisibility: false,
			canMoveView: true,
			openCommandActionDescriptor: {
				id: CHAT_SIDEBAR_PANEL_ID,
				title: this._viewContainer.title,
				mnemonicTitle: localize({ key: 'miToggleChat', comment: ['&& denotes a mnemonic'] }, "&&Chat"),
				keybindings: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyI,
					mac: {
						primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KeyI
					}
				},
				order: 1
			},
			ctorDescriptor: new SyncDescriptor(ChatViewPane, [{ location: ChatAgentLocation.Panel }]),
			when: ContextKeyExpr.or(
				ContextKeyExpr.and(
					ContextKeyExpr.has('config.chat.experimental.offerSetup'),
					ChatContextKeys.Setup.triggered
				),
				ChatContextKeys.Setup.installed,
				ChatContextKeys.panelParticipantRegistered,
				ChatContextKeys.extensionInvalid
			)
		}];
		Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(viewDescriptor, this._viewContainer);

		return toDisposable(() => {
			Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).deregisterViews(viewDescriptor, this._viewContainer);
		});
	}

	private registerChatEditingView(): IDisposable {
		const title = localize2('chatEditing.viewContainer.label', "Copilot Edits");
		const icon = Codicon.editSession;
		const viewContainerId = CHAT_EDITING_SIDEBAR_PANEL_ID;
		const viewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
			id: viewContainerId,
			title,
			icon,
			ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [viewContainerId, { mergeViewWithContainerWhenSingleView: true }]),
			storageId: viewContainerId,
			hideIfEmpty: true,
			order: 101,
		}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });

		const id = 'workbench.panel.chat.view.edits';
		const viewDescriptor: IViewDescriptor[] = [{
			id,
			containerIcon: viewContainer.icon,
			containerTitle: title.value,
			singleViewPaneContainerTitle: title.value,
			name: { value: title.value, original: title.value },
			canToggleVisibility: false,
			canMoveView: true,
			openCommandActionDescriptor: {
				id: viewContainerId,
				title,
				mnemonicTitle: localize({ key: 'miToggleEdits', comment: ['&& denotes a mnemonic'] }, "Copilot Ed&&its"),
				keybindings: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI,
					linux: {
						primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyI
					}
				},
				order: 2
			},
			ctorDescriptor: new SyncDescriptor(ChatViewPane, [{ location: ChatAgentLocation.EditingSession }]),
			when: ContextKeyExpr.or(
				ChatContextKeys.Setup.installed,
				ChatContextKeys.editingParticipantRegistered
			)
		}];
		Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(viewDescriptor, viewContainer);

		return toDisposable(() => {
			Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).deregisterViewContainer(viewContainer);
			Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).deregisterViews(viewDescriptor, viewContainer);
		});
	}
}

function getParticipantKey(extensionId: ExtensionIdentifier, participantName: string): string {
	return `${extensionId.value}_${participantName}`;
}

export class ChatCompatibilityNotifier extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatCompatNotifier';

	private registeredWelcomeView = false;

	constructor(
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IProductService private readonly productService: IProductService,
	) {
		super();

		// It may be better to have some generic UI for this, for any extension that is incompatible,
		// but this is only enabled for Copilot Chat now and it needs to be obvious.
		const isInvalid = ChatContextKeys.extensionInvalid.bindTo(contextKeyService);
		this._register(Event.runAndSubscribe(
			extensionsWorkbenchService.onDidChangeExtensionsNotification,
			() => {
				const notification = extensionsWorkbenchService.getExtensionsNotification();
				const chatExtension = notification?.extensions.find(ext => ExtensionIdentifier.equals(ext.identifier.id, this.productService.defaultChatAgent?.chatExtensionId));
				if (chatExtension) {
					isInvalid.set(true);
					this.registerWelcomeView(chatExtension);
				} else {
					isInvalid.set(false);
				}
			}
		));
	}

	private registerWelcomeView(chatExtension: IExtension) {
		if (this.registeredWelcomeView) {
			return;
		}

		this.registeredWelcomeView = true;
		const showExtensionLabel = localize('showExtension', "Show Extension");
		const mainMessage = localize('chatFailErrorMessage', "Chat failed to load because the installed version of the Copilot Chat extension is not compatible with this version of {0}. Please ensure that the Copilot Chat extension is up to date.", this.productService.nameLong);
		const commandButton = `[${showExtensionLabel}](command:${showExtensionsWithIdsCommandId}?${encodeURIComponent(JSON.stringify([[this.productService.defaultChatAgent?.chatExtensionId]]))})`;
		const versionMessage = `Copilot Chat version: ${chatExtension.version}`;
		const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
		this._register(viewsRegistry.registerViewWelcomeContent(ChatViewId, {
			content: [mainMessage, commandButton, versionMessage].join('\n\n'),
			when: ChatContextKeys.extensionInvalid,
		}));
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, RunOnceScheduler } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceSet } from '../../../../base/common/map.js';
import { autorun, autorunWithStore } from '../../../../base/common/observable.js';
import { assertType } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { observableConfigValue } from '../../../../platform/observable/common/platformObservableUtils.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IEditorIdentifier, SaveReason } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { ChatAgentLocation, IChatAgentService } from '../common/chatAgents.js';
import { ChatContextKeys } from '../common/chatContextKeys.js';
import { applyingChatEditsFailedContextKey, CHAT_EDITING_MULTI_DIFF_SOURCE_RESOLVER_SCHEME, hasUndecidedChatEditingResourceContextKey, IChatEditingService, IModifiedFileEntry, WorkingSetEntryState } from '../common/chatEditingService.js';
import { IChatModel } from '../common/chatModel.js';
import { IChatService } from '../common/chatService.js';
import { ChatEditingModifiedFileEntry } from './chatEditing/chatEditingModifiedFileEntry.js';


const STORAGE_KEY_AUTOSAVE_DISABLED = 'chat.editing.autosaveDisabled';

export class ChatEditorAutoSaveDisabler extends Disposable implements IWorkbenchContribution {

	static readonly ID: string = 'workbench.chat.autoSaveDisabler';

	private _autosaveDisabledUris: string[] = [];

	constructor(
		@IConfigurationService configService: IConfigurationService,
		@IChatEditingService chatEditingService: IChatEditingService,
		@IFilesConfigurationService fileConfigService: IFilesConfigurationService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IStorageService storageService: IStorageService
	) {
		super();

		// on shutdown remember all files that have auto save disabled
		this._store.add(lifecycleService.onWillShutdown((e) => {
			storageService.store(STORAGE_KEY_AUTOSAVE_DISABLED, this._autosaveDisabledUris, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}));

		const alwaysSaveConfig = observableConfigValue<boolean>(ChatEditorSaving._config, false, configService);

		// as quickly as possible disable auto save for all files that were modified before the last shutdown
		if (!alwaysSaveConfig.get()) {
			const autoSaveDisabled = storageService.getObject<string[]>(STORAGE_KEY_AUTOSAVE_DISABLED, StorageScope.WORKSPACE, []);
			if (Array.isArray(autoSaveDisabled) && autoSaveDisabled.length > 0) {

				const initializingStore = new DisposableStore();
				for (const uriString of autoSaveDisabled) {
					initializingStore.add(fileConfigService.disableAutoSave(URI.parse(uriString)));
				}
				chatEditingService.getOrRestoreEditingSession().finally(() => {
					// by now the session is restored and the auto save handlers are in place
					initializingStore.dispose();
				});

			}
		}

		// listen to session changes and update auto save settings accordingly
		const saveConfig = this._store.add(new MutableDisposable());
		this._store.add(autorun(reader => {
			const store = new DisposableStore();
			const autoSaveDisabled: string[] = [];
			try {
				if (alwaysSaveConfig.read(reader)) {
					return;
				}
				const session = chatEditingService.currentEditingSessionObs.read(reader);
				if (session) {
					const entries = session.entries.read(reader);
					for (const entry of entries) {
						if (entry.state.read(reader) === WorkingSetEntryState.Modified) {
							autoSaveDisabled.push(entry.modifiedURI.toString());
							store.add(fileConfigService.disableAutoSave(entry.modifiedURI));
						}
					}
				}
			} finally {
				saveConfig.value = store; // disposes the previous store, after we have added the new one
				this._autosaveDisabledUris = autoSaveDisabled;
			}
		}));
	}
}


export class ChatEditorSaving extends Disposable implements IWorkbenchContribution {

	static readonly ID: string = 'workbench.chat.editorSaving';

	static readonly _config = 'chat.editing.alwaysSaveWithGeneratedChanges';

	constructor(
		@IConfigurationService configService: IConfigurationService,
		@IChatEditingService chatEditingService: IChatEditingService,
		@IChatAgentService chatAgentService: IChatAgentService,
		@ITextFileService textFileService: ITextFileService,
		@ILabelService labelService: ILabelService,
		@IDialogService dialogService: IDialogService,
		@IChatService private readonly _chatService: IChatService,
	) {
		super();

		// --- report that save happened
		this._store.add(autorunWithStore((r, store) => {
			const session = chatEditingService.currentEditingSessionObs.read(r);
			if (!session) {
				return;
			}
			const chatSession = this._chatService.getSession(session.chatSessionId);
			if (!chatSession) {
				return;
			}
			store.add(textFileService.files.onDidSave(e => {
				const entry = session.getEntry(e.model.resource);
				if (entry && entry.state.get() === WorkingSetEntryState.Modified) {
					this._reportSavedWhenReady(chatSession, entry);
				}
			}));
		}));

		const store = this._store.add(new DisposableStore());

		const update = () => {

			store.clear();

			const alwaysSave = configService.getValue<boolean>(ChatEditorSaving._config);
			if (alwaysSave) {
				return;
			}

			const saveJobs = new class {

				private _deferred?: DeferredPromise<void>;
				private readonly _soon = new RunOnceScheduler(() => this._prompt(), 0);
				private readonly _uris = new ResourceSet();

				add(uri: URI) {
					this._uris.add(uri);
					this._soon.schedule();
					this._deferred ??= new DeferredPromise();
					return this._deferred.p;
				}

				private async _prompt() {

					// this might have changed in the meantime and there is checked again and acted upon
					const alwaysSave = configService.getValue<boolean>(ChatEditorSaving._config);
					if (alwaysSave) {
						return;
					}

					const uri = Iterable.first(this._uris);
					if (!uri) {
						// bogous?
						return;
					}

					const agentName = chatAgentService.getDefaultAgent(ChatAgentLocation.EditingSession)?.fullName ?? localize('chat', "chat");
					const filelabel = labelService.getUriBasenameLabel(uri);

					const message = this._uris.size === 1
						? localize('message.1', "Do you want to save the changes {0} made in {1}?", agentName, filelabel)
						: localize('message.2', "Do you want to save the changes {0} made to {1} files?", agentName, this._uris.size);

					const result = await dialogService.confirm({
						message,
						detail: localize('detail2', "AI-generated changes may be incorrect and should be reviewed before saving.", agentName),
						primaryButton: localize('save', "Save"),
						cancelButton: localize('discard', "Cancel"),
						checkbox: {
							label: localize('config', "Always save with AI-generated changes without asking"),
							checked: false
						}
					});

					this._uris.clear();

					if (result.confirmed && result.checkboxChecked) {
						// remember choice
						await configService.updateValue(ChatEditorSaving._config, true);
					}

					if (!result.confirmed) {
						// cancel the save
						this._deferred?.error(new CancellationError());
					} else {
						this._deferred?.complete();
					}
					this._deferred = undefined;
				}
			};

			store.add(textFileService.files.addSaveParticipant({
				participate: async (workingCopy, context, progress, token) => {

					if (context.reason !== SaveReason.EXPLICIT) {
						// all saves that we are concerned about are explicit
						// because we have disabled auto-save for them
						return;
					}

					const session = await chatEditingService.getOrRestoreEditingSession();
					if (!session) {
						return;
					}
					const entry = session.getEntry(workingCopy.resource);
					if (!entry || entry.state.get() !== WorkingSetEntryState.Modified) {
						return;
					}

					return saveJobs.add(entry.modifiedURI);
				}
			}));
		};

		configService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ChatEditorSaving._config)) {
				update();
			}
		});
		update();
	}

	private _reportSaved(entry: IModifiedFileEntry) {
		assertType(entry instanceof ChatEditingModifiedFileEntry);

		this._chatService.notifyUserAction({
			action: { kind: 'chatEditingSessionAction', uri: entry.modifiedURI, hasRemainingEdits: false, outcome: 'saved' },
			agentId: entry.telemetryInfo.agentId,
			command: entry.telemetryInfo.command,
			sessionId: entry.telemetryInfo.sessionId,
			requestId: entry.telemetryInfo.requestId,
			result: entry.telemetryInfo.result
		});
	}

	private _reportSavedWhenReady(session: IChatModel, entry: IModifiedFileEntry) {
		if (!session.requestInProgress) {
			this._reportSaved(entry);
			return;
		}
		// wait until no more request is pending
		const d = session.onDidChange(e => {
			if (!session.requestInProgress) {
				this._reportSaved(entry);
				this._store.delete(d);
				d.dispose();
			}
		});
		this._store.add(d);
	}
}

export class ChatEditingSaveAllAction extends Action2 {
	static readonly ID = 'chatEditing.saveAllFiles';
	static readonly LABEL = localize('save.allFiles', 'Save All');

	constructor() {
		super({
			id: ChatEditingSaveAllAction.ID,
			title: ChatEditingSaveAllAction.LABEL,
			tooltip: ChatEditingSaveAllAction.LABEL,
			precondition: ContextKeyExpr.and(ChatContextKeys.requestInProgress.negate(), hasUndecidedChatEditingResourceContextKey),
			icon: Codicon.saveAll,
			menu: [
				{
					when: ContextKeyExpr.equals('resourceScheme', CHAT_EDITING_MULTI_DIFF_SOURCE_RESOLVER_SCHEME),
					id: MenuId.EditorTitle,
					order: 2,
					group: 'navigation',
				},
				{
					id: MenuId.ChatEditingWidgetToolbar,
					group: 'navigation',
					order: 2,
					// Show the option to save without accepting if the user hasn't configured the setting to always save with generated changes
					when: ContextKeyExpr.and(
						applyingChatEditsFailedContextKey.negate(),
						hasUndecidedChatEditingResourceContextKey,
						ContextKeyExpr.equals(`config.${ChatEditorSaving._config}`, false),
						ChatContextKeys.location.isEqualTo(ChatAgentLocation.EditingSession)
					)
				}
			],
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyS,
				when: ContextKeyExpr.and(ChatContextKeys.requestInProgress.negate(), hasUndecidedChatEditingResourceContextKey, ChatContextKeys.location.isEqualTo(ChatAgentLocation.EditingSession), ChatContextKeys.inChatInput),
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	async run(accessor: ServicesAccessor, ...args: any[]): Promise<void> {
		const chatEditingService = accessor.get(IChatEditingService);
		const editorService = accessor.get(IEditorService);
		const configService = accessor.get(IConfigurationService);
		const chatAgentService = accessor.get(IChatAgentService);
		const dialogService = accessor.get(IDialogService);
		const labelService = accessor.get(ILabelService);

		const currentEditingSession = chatEditingService.currentEditingSession;
		if (!currentEditingSession) {
			return;
		}

		const editors: IEditorIdentifier[] = [];
		for (const modifiedFileEntry of currentEditingSession.entries.get()) {
			if (modifiedFileEntry.state.get() === WorkingSetEntryState.Modified) {
				const modifiedFile = modifiedFileEntry.modifiedURI;
				const matchingEditors = editorService.findEditors(modifiedFile);
				if (matchingEditors.length === 0) {
					continue;
				}
				const matchingEditor = matchingEditors[0];
				if (matchingEditor.editor.isDirty()) {
					editors.push(matchingEditor);
				}
			}
		}

		if (editors.length === 0) {
			return;
		}

		const alwaysSave = configService.getValue<boolean>(ChatEditorSaving._config);
		if (!alwaysSave) {
			const agentName = chatAgentService.getDefaultAgent(ChatAgentLocation.EditingSession)?.fullName;

			let message: string;
			if (editors.length === 1) {
				const resource = editors[0].editor.resource;
				if (resource) {
					const filelabel = labelService.getUriBasenameLabel(resource);
					message = agentName
						? localize('message.batched.oneFile.1', "Do you want to save the changes {0} made in {1}?", agentName, filelabel)
						: localize('message.batched.oneFile.2', "Do you want to save the changes chat made in {0}?", filelabel);
				} else {
					message = agentName
						? localize('message.batched.oneFile.3', "Do you want to save the changes {0} made in 1 file?", agentName)
						: localize('message.batched.oneFile.4', "Do you want to save the changes chat made in 1 file?");
				}
			} else {
				message = agentName
					? localize('message.batched.multiFile.1', "Do you want to save the changes {0} made in {1} files?", agentName, editors.length)
					: localize('message.batched.multiFile.2', "Do you want to save the changes chat made in {0} files?", editors.length);
			}


			const result = await dialogService.confirm({
				message,
				detail: localize('detail2', "AI-generated changes may be incorrect and should be reviewed before saving.", agentName),
				primaryButton: localize('save all', "Save All"),
				cancelButton: localize('discard', "Cancel"),
				checkbox: {
					label: localize('config', "Always save with AI-generated changes without asking"),
					checked: false
				}
			});

			if (!result.confirmed) {
				return;
			}

			if (result.checkboxChecked) {
				await configService.updateValue(ChatEditorSaving._config, true);
			}
		}

		// Skip our own chat editing save blocking participant, since we already showed our own batched dialog
		await editorService.save(editors, { reason: SaveReason.EXPLICIT, skipSaveParticipants: true });
	}
}
registerAction2(ChatEditingSaveAllAction);

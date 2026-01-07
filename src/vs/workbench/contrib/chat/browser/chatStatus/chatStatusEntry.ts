/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatStatus.css';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, ShowTooltipCommand, StatusbarAlignment, StatusbarEntryKind } from '../../../../services/statusbar/browser/statusbar.js';
import { ChatEntitlement, ChatEntitlementService, IChatEntitlementService, isProUser } from '../../../../services/chat/common/chatEntitlementService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { getCodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { IInlineCompletionsService } from '../../../../../editor/browser/services/inlineCompletionsService.js';
import { IChatSessionsService } from '../../common/chatSessionsService.js';
import { ChatStatusDashboard } from './chatStatusDashboard.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { disposableWindowInterval } from '../../../../../base/browser/dom.js';
import { isNewUser, isCompletionsEnabled } from './chatStatus.js';
import product from '../../../../../platform/product/common/product.js';

// --- Start Positron ---
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { ChatContextKeys } from '../../common/chatContextKeys.js';
// --- End Positron ---

// --- Start Positron ---
// This is a wrapper around the ChatStatus class
// which creates a ChatStatus instance for each editor part (window)\
// See src/vs/workbench/contrib/languageStatus/browser/languageStatus.ts for inspiration
export class ChatStatusBarEntry extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatStatusBarEntry';

	constructor(
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
	) {
		super();

		for (const part of editorGroupService.parts) {
			this.createChatStatus(part);
		}

		this._register(editorGroupService.onDidCreateAuxiliaryEditorPart(part => this.createChatStatus(part)));
	}

	private createChatStatus(part: IEditorPart): void {
		const disposables = new DisposableStore();
		this._register(
			part.onWillDispose(() => {
				if (!disposables.isDisposed) {
					disposables.dispose();
				}
			})
		);

		const scopedInstantiationService = this.editorGroupService.getScopedInstantiationService(part);
		disposables.add(scopedInstantiationService.createInstance(ChatStatus));
	}
}

// Rename this class to avoid needing to modify other files that import it

// export class ChatStatusBarEntry extends Disposable implements IWorkbenchContribution {
export class ChatStatus extends Disposable {
	// --- End Positron ---
	static readonly ID = 'workbench.contrib.chatStatusBarEntry';

	private entry: IStatusbarEntryAccessor | undefined = undefined;

	private readonly activeCodeEditorListener = this._register(new MutableDisposable());

	private runningSessionsCount: number;

	constructor(
		// --- Start Positron ---
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		// --- End Positron ---
		@IChatEntitlementService private readonly chatEntitlementService: ChatEntitlementService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInlineCompletionsService private readonly completionsService: IInlineCompletionsService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
	) {
		super();

		this.runningSessionsCount = this.chatSessionsService.getInProgress().reduce((total, item) => total + item.count, 0);

		this.update();

		this.registerListeners();
	}

	private update(): void {
		// --- Start Positron ---
		// Remove the Chat status if the active editor is not a code editor
		if (!this.shouldShowStatus()) {
			this.entry?.dispose();
			this.entry = undefined;
			return;
		}

		// We only need the part that displays the status. No need to hide it based on the chat entitlement setting the right context keys
		/*
		const sentiment = this.chatEntitlementService.sentiment;
		*/
		// Removed outer if (!sentiment.hidden) ...
		const props = this.getEntryProps();
		if (this.entry) {
			this.entry.update(props);
		} else {
			this.entry = this.statusbarService.addEntry(props, 'chat.statusBarEntry', StatusbarAlignment.RIGHT, { location: { id: 'status.editor.mode', priority: 100.1 }, alignment: StatusbarAlignment.RIGHT });
		}
		// --- End Positron ---
	}

	private registerListeners(): void {
		this._register(this.chatEntitlementService.onDidChangeQuotaExceeded(() => this.update()));
		this._register(this.chatEntitlementService.onDidChangeSentiment(() => this.update()));
		this._register(this.chatEntitlementService.onDidChangeEntitlement(() => this.update()));

		this._register(this.completionsService.onDidChangeIsSnoozing(() => this.update()));

		this._register(this.chatSessionsService.onDidChangeInProgress(() => {
			const oldSessionsCount = this.runningSessionsCount;
			this.runningSessionsCount = this.chatSessionsService.getInProgress().reduce((total, item) => total + item.count, 0);
			if (this.runningSessionsCount !== oldSessionsCount) {
				this.update();
			}
		}));

		this._register(this.editorService.onDidActiveEditorChange(() => this.onDidActiveEditorChange()));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(product.defaultChatAgent.completionsEnablementSetting)) {
				this.update();
			}
		}));
		// --- Start Positron ---
		this._register(this.contextKeyService.onDidChangeContext(e => {
			const expr = ChatContextKeys.inChatSession.isEqualTo(true);
			if (e.affectsSome(new Set(expr.keys()))) {
				this.update();
			}
		}));
		// --- End Positron ---
	}

	private onDidActiveEditorChange(): void {
		this.update();

		this.activeCodeEditorListener.clear();

		// Listen to language changes in the active code editor
		const activeCodeEditor = getCodeEditor(this.editorService.activeTextEditorControl);
		if (activeCodeEditor) {
			this.activeCodeEditorListener.value = activeCodeEditor.onDidChangeModelLanguage(() => {
				this.update();
			});
		}
	}

	// --- Start Positron ---
	private shouldShowStatus(): boolean {
		// Hide the Chat status item if:
		// - only plot or data explorer editors are open, and
		// - the user is not in a chat session
		const inChat = ChatContextKeys.inChatSession.getValue(this.contextKeyService);
		const isEditor = !this.editorService.editors.every(editor => {
			return editor.editorId === 'workbench.editor.positronPlots' ||
				editor.editorId === 'workbench.editor.positronDataExplorer';
		});
		return inChat || isEditor;
	}
	// --- End Positron ---

	private getEntryProps(): IStatusbarEntry {
		// --- Start Positron ---
		let text = '$(positron-assistant)';
		let ariaLabel = localize('chatStatus', "Assistant Status");
		// --- End Positron ---
		let kind: StatusbarEntryKind | undefined;

		if (isNewUser(this.chatEntitlementService)) {
			const entitlement = this.chatEntitlementService.entitlement;

			// Finish Setup
			if (
				this.chatEntitlementService.sentiment.later ||	// user skipped setup
				entitlement === ChatEntitlement.Available ||	// user is entitled
				isProUser(entitlement) ||						// user is already pro
				entitlement === ChatEntitlement.Free			// user is already free
			) {
				const finishSetup = localize('finishSetup', "Finish Setup");

				// --- Start Positron ---
				// text = `$(copilot) ${finishSetup}`;
				// --- End Positron ---
				ariaLabel = finishSetup;
				kind = 'prominent';
			}
		} else {
			const chatQuotaExceeded = this.chatEntitlementService.quotas.chat?.percentRemaining === 0;
			const completionsQuotaExceeded = this.chatEntitlementService.quotas.completions?.percentRemaining === 0;

			// Disabled
			if (this.chatEntitlementService.sentiment.disabled || this.chatEntitlementService.sentiment.untrusted) {
				// --- Start Positron ---
				// text = '$(copilot-unavailable)';
				// --- End Positron ---
				ariaLabel = localize('copilotDisabledStatus', "Copilot disabled");
			}

			// Sessions in progress
			else if (this.runningSessionsCount > 0) {
				// --- Start Positron ---
				// text = '$(copilot-in-progress)';
				text = '$(positron-assistant-in-progress)';
				// --- End Positron ---
				if (this.runningSessionsCount > 1) {
					ariaLabel = localize('chatSessionsInProgressStatus', "{0} agent sessions in progress", this.runningSessionsCount);
				} else {
					ariaLabel = localize('chatSessionInProgressStatus', "1 agent session in progress");
				}
			}

			// --- Start Positron ---
			// Dial back the treatment of 'signed out' a little bit, since
			// everyone is going to be 'signed out' by default unless they are
			// signed in to Copilot
			// Signed out
			else if (this.chatEntitlementService.entitlement === ChatEntitlement.Unknown) {
				const signedOutWarning = localize('notSignedIn', "Signed out");

				// text = `${this.chatEntitlementService.anonymous ? '$(copilot)' : '$(copilot-not-connected)'} ${signedOutWarning}`;
				// text = `$(copilot-not-connected)`;
				ariaLabel = signedOutWarning;
				// kind = 'prominent';
			}
			// --- End Positron ---

			// Free Quota Exceeded
			else if (this.chatEntitlementService.entitlement === ChatEntitlement.Free && (chatQuotaExceeded || completionsQuotaExceeded)) {
				let quotaWarning: string;
				if (chatQuotaExceeded && !completionsQuotaExceeded) {
					quotaWarning = localize('chatQuotaExceededStatus', "Chat quota reached");
				} else if (completionsQuotaExceeded && !chatQuotaExceeded) {
					quotaWarning = localize('completionsQuotaExceededStatus', "Inline suggestions quota reached");
				} else {
					quotaWarning = localize('chatAndCompletionsQuotaExceededStatus', "Quota reached");
				}

				// --- Start Positron ---
				// text = `$(copilot-warning) ${quotaWarning}`;
				// --- End Positron ---
				ariaLabel = quotaWarning;
				kind = 'prominent';
			}

			// Completions Disabled
			else if (this.editorService.activeTextEditorLanguageId && !isCompletionsEnabled(this.configurationService, this.editorService.activeTextEditorLanguageId)) {
				// --- Start Positron ---
				// text = '$(copilot-unavailable)';
				// --- End Positron ---
				ariaLabel = localize('completionsDisabledStatus', "Inline suggestions disabled");
			}

			// Completions Snoozed
			else if (this.completionsService.isSnoozing()) {
				// --- Start Positron ---
				// text = '$(copilot-snooze)';
				// --- End Positron ---
				ariaLabel = localize('completionsSnoozedStatus', "Inline suggestions snoozed");
			}
		}

		const baseResult = {
			// --- Start Positron ---
			name: localize('positronChatStatus', "Assistant Status"),
			text,
			ariaLabel,
			command: ShowTooltipCommand,
			// Do not show status in all windows; allows us to create a new status item
			// for each window manually
			// showInAllWindows: true,
			// --- End Positron ---
			kind,
			tooltip: {
				element: (token: CancellationToken) => {
					const store = new DisposableStore();
					store.add(token.onCancellationRequested(() => {
						store.dispose();
					}));
					const elem = ChatStatusDashboard.instantiateInContents(this.instantiationService, store);

					// todo@connor4312/@benibenj: workaround for #257923
					store.add(disposableWindowInterval(mainWindow, () => {
						if (!elem.isConnected) {
							store.dispose();
						}
					}, 2000));

					return elem;
				}
			}
		} satisfies IStatusbarEntry;

		return baseResult;
	}

	override dispose(): void {
		super.dispose();

		this.entry?.dispose();
		this.entry = undefined;
	}
}

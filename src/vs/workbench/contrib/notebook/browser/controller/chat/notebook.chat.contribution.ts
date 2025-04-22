/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { codiconsLibrary } from '../../../../../../base/common/codiconsLibrary.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Position } from '../../../../../../editor/common/core/position.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { IWordAtPosition } from '../../../../../../editor/common/core/wordHelper.js';
import { CompletionContext, CompletionItemKind, CompletionList } from '../../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../../editor/common/services/languageFeatures.js';
import { localize } from '../../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKey, IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { IChatWidget, IChatWidgetService } from '../../../../chat/browser/chat.js';
import { ChatInputPart } from '../../../../chat/browser/chatInputPart.js';
import { ChatDynamicVariableModel } from '../../../../chat/browser/contrib/chatDynamicVariables.js';
import { computeCompletionRanges } from '../../../../chat/browser/contrib/chatInputCompletions.js';
import { IChatAgentService } from '../../../../chat/common/chatAgents.js';
import { ChatAgentLocation } from '../../../../chat/common/constants.js';
import { ChatContextKeys } from '../../../../chat/common/chatContextKeys.js';
import { IBaseChatRequestVariableEntry } from '../../../../chat/common/chatModel.js';
import { chatVariableLeader } from '../../../../chat/common/chatParserTypes.js';
import { NOTEBOOK_CELL_HAS_OUTPUTS, NOTEBOOK_CELL_OUTPUT_MIME_TYPE_LIST_FOR_CHAT, NOTEBOOK_CELL_OUTPUT_MIMETYPE } from '../../../common/notebookContextKeys.js';
import { INotebookKernelService } from '../../../common/notebookKernelService.js';
import { getNotebookEditorFromEditorPane, ICellOutputViewModel, INotebookEditor, ICellViewModel } from '../../notebookBrowser.js';
import * as icons from '../../notebookIcons.js';
import { getOutputViewModelFromId } from '../cellOutputActions.js';
import { INotebookOutputActionContext, NOTEBOOK_ACTIONS_CATEGORY } from '../coreActions.js';
import { CellUri } from '../../../common/notebookCommon.js';
import './cellChatActions.js';
import { CTX_NOTEBOOK_CHAT_HAS_AGENT } from './notebookChatContext.js';

const NotebookKernelVariableKey = 'kernelVariable';
const NOTEBOOK_CELL_OUTPUT_MIME_TYPE_LIST_FOR_CHAT_CONST = ['text/plain', 'text/html',
	'application/vnd.code.notebook.error',
	'application/vnd.code.notebook.stdout',
	'application/x.notebook.stdout',
	'application/x.notebook.stream',
	'application/vnd.code.notebook.stderr',
	'application/x.notebook.stderr',
	'image/png',
	'image/jpeg',
	'image/svg',
];

class NotebookChatContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.notebookChatContribution';

	private readonly _ctxHasProvider: IContextKey<boolean>;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IChatAgentService chatAgentService: IChatAgentService,
		@IEditorService private readonly editorService: IEditorService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@INotebookKernelService private readonly notebookKernelService: INotebookKernelService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
	) {
		super();

		this._ctxHasProvider = CTX_NOTEBOOK_CHAT_HAS_AGENT.bindTo(contextKeyService);

		const updateNotebookAgentStatus = () => {
			const hasNotebookAgent = Boolean(chatAgentService.getDefaultAgent(ChatAgentLocation.Notebook));
			this._ctxHasProvider.set(hasNotebookAgent);
		};

		updateNotebookAgentStatus();
		this._register(chatAgentService.onDidChangeAgents(updateNotebookAgentStatus));

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatKernelDynamicCompletions',
			triggerCharacters: [chatVariableLeader],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget || !widget.supportsFileReferences) {
					return null;
				}

				if (widget.location !== ChatAgentLocation.Notebook) {
					return null;
				}

				const variableNameDef = new RegExp(`${chatVariableLeader}\\w*`, 'g');
				const range = computeCompletionRanges(model, position, variableNameDef, true);
				if (!range) {
					return null;
				}

				const result: CompletionList = { suggestions: [] };

				const afterRange = new Range(position.lineNumber, range.replace.startColumn, position.lineNumber, range.replace.startColumn + `${chatVariableLeader}${NotebookKernelVariableKey}:`.length);
				result.suggestions.push({
					label: `${chatVariableLeader}${NotebookKernelVariableKey}`,
					insertText: `${chatVariableLeader}${NotebookKernelVariableKey}:`,
					detail: localize('pickKernelVariableLabel', "Pick a variable from the kernel"),
					range,
					kind: CompletionItemKind.Text,
					command: { id: SelectAndInsertKernelVariableAction.ID, title: SelectAndInsertKernelVariableAction.ID, arguments: [{ widget, range: afterRange }] },
					sortText: 'z'
				});

				await this.addKernelVariableCompletion(widget, result, range, token);

				return result;
			}
		}));

		// output context
		NOTEBOOK_CELL_OUTPUT_MIME_TYPE_LIST_FOR_CHAT.bindTo(contextKeyService).set(NOTEBOOK_CELL_OUTPUT_MIME_TYPE_LIST_FOR_CHAT_CONST);
	}

	private async addKernelVariableCompletion(widget: IChatWidget, result: CompletionList, info: { insert: Range; replace: Range; varWord: IWordAtPosition | null }, token: CancellationToken) {
		let pattern: string | undefined;
		if (info.varWord?.word && info.varWord.word.startsWith(chatVariableLeader)) {
			pattern = info.varWord.word.toLowerCase().slice(1);
		}

		const notebook = getNotebookEditorFromEditorPane(this.editorService.activeEditorPane)?.getViewModel()?.notebookDocument;

		if (!notebook) {
			return;
		}

		const selectedKernel = this.notebookKernelService.getMatchingKernel(notebook).selected;
		const hasVariableProvider = selectedKernel?.hasVariableProvider;

		if (!hasVariableProvider) {
			return;
		}

		const variables = await selectedKernel.provideVariables(notebook.uri, undefined, 'named', 0, CancellationToken.None);

		for await (const variable of variables) {
			if (pattern && !variable.name.toLowerCase().includes(pattern)) {
				continue;
			}

			result.suggestions.push({
				label: { label: variable.name, description: variable.type },
				insertText: `${chatVariableLeader}${NotebookKernelVariableKey}:${variable.name} `,
				filterText: `${chatVariableLeader}${variable.name}`,
				range: info,
				kind: CompletionItemKind.Variable,
				sortText: 'z',
				command: { id: SelectAndInsertKernelVariableAction.ID, title: SelectAndInsertKernelVariableAction.ID, arguments: [{ widget, range: info.insert, variable: variable.name }] },
				detail: variable.type,
				documentation: variable.value,
			});
		}
	}
}

export class SelectAndInsertKernelVariableAction extends Action2 {
	constructor() {
		super({
			id: SelectAndInsertKernelVariableAction.ID,
			title: '' // not displayed
		});
	}

	static readonly ID = 'notebook.chat.selectAndInsertKernelVariable';

	override async run(accessor: ServicesAccessor, ...args: any[]): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const notebookKernelService = accessor.get(INotebookKernelService);
		const quickInputService = accessor.get(IQuickInputService);

		const notebook = getNotebookEditorFromEditorPane(editorService.activeEditorPane)?.getViewModel()?.notebookDocument;

		if (!notebook) {
			return;
		}

		const context = args[0];
		if (!context || !('widget' in context) || !('range' in context)) {
			return;
		}

		const widget = <IChatWidget>context.widget;
		const range = <Range | undefined>context.range;
		const variable = <string | undefined>context.variable;

		if (variable !== undefined) {
			this.addVariableReference(widget, variable, range, false);
			return;
		}

		const selectedKernel = notebookKernelService.getMatchingKernel(notebook).selected;
		const hasVariableProvider = selectedKernel?.hasVariableProvider;

		if (!hasVariableProvider) {
			return;
		}

		const variables = await selectedKernel.provideVariables(notebook.uri, undefined, 'named', 0, CancellationToken.None);

		const quickPickItems: IQuickPickItem[] = [];
		for await (const variable of variables) {
			quickPickItems.push({
				label: variable.name,
				description: variable.value,
				detail: variable.type,
			});
		}

		const pickedVariable = await quickInputService.pick(quickPickItems, { placeHolder: 'Select a kernel variable' });
		if (!pickedVariable) {
			return;
		}

		this.addVariableReference(widget, pickedVariable.label, range, true);
	}

	private addVariableReference(widget: IChatWidget, variableName: string, range?: Range, updateText?: boolean) {
		if (range) {
			const text = `#kernelVariable:${variableName}`;

			if (updateText) {
				const editor = widget.inputEditor;
				const success = editor.executeEdits('chatInsertFile', [{ range, text: text + ' ' }]);
				if (!success) {
					return;
				}
			}

			widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID)?.addReference({
				id: 'vscode.notebook.variable',
				range: { startLineNumber: range.startLineNumber, startColumn: range.startColumn, endLineNumber: range.endLineNumber, endColumn: range.startColumn + text.length },
				data: variableName,
				fullName: variableName,
				icon: codiconsLibrary.variable,
			});
		} else {
			widget.attachmentModel.addContext({
				id: 'vscode.notebook.variable',
				name: variableName,
				value: variableName,
				icon: codiconsLibrary.variable,
			});
		}
	}
}


registerAction2(class CopyCellOutputAction extends Action2 {
	constructor() {
		super({
			id: 'notebook.cellOutput.addToChat',
			title: localize('notebookActions.addOutputToChat', "Add Cell Output to Chat"),
			menu: {
				id: MenuId.NotebookOutputToolbar,
				when: ContextKeyExpr.and(NOTEBOOK_CELL_HAS_OUTPUTS, ContextKeyExpr.in(NOTEBOOK_CELL_OUTPUT_MIMETYPE.key, NOTEBOOK_CELL_OUTPUT_MIME_TYPE_LIST_FOR_CHAT.key)),
				order: 10
			},
			category: NOTEBOOK_ACTIONS_CATEGORY,
			icon: icons.copyIcon,
			precondition: ChatContextKeys.enabled
		});
	}

	private getNoteboookEditor(editorService: IEditorService, outputContext: INotebookOutputActionContext | { outputViewModel: ICellOutputViewModel } | undefined): INotebookEditor | undefined {
		if (outputContext && 'notebookEditor' in outputContext) {
			return outputContext.notebookEditor;
		}
		return getNotebookEditorFromEditorPane(editorService.activeEditorPane);
	}

	async run(accessor: ServicesAccessor, outputContext: INotebookOutputActionContext | { outputViewModel: ICellOutputViewModel } | undefined): Promise<void> {
		const notebookEditor = this.getNoteboookEditor(accessor.get(IEditorService), outputContext);

		if (!notebookEditor) {
			return;
		}

		let outputViewModel: ICellOutputViewModel | undefined;
		if (outputContext && 'outputId' in outputContext && typeof outputContext.outputId === 'string') {
			outputViewModel = getOutputViewModelFromId(outputContext.outputId, notebookEditor);
		} else if (outputContext && 'outputViewModel' in outputContext) {
			outputViewModel = outputContext.outputViewModel;
		}

		if (!outputViewModel) {
			// not able to find the output from the provided context, use the active cell
			const activeCell = notebookEditor.getActiveCell();
			if (!activeCell) {
				return;
			}

			if (activeCell.focusedOutputId !== undefined) {
				outputViewModel = activeCell.outputsViewModels.find(output => {
					return output.model.outputId === activeCell.focusedOutputId;
				});
			} else {
				outputViewModel = activeCell.outputsViewModels.find(output => output.pickedMimeType?.isTrusted);
			}
		}

		if (!outputViewModel) {
			return;
		}

		const mimeType = outputViewModel.pickedMimeType?.mimeType;

		const chatWidgetService = accessor.get(IChatWidgetService);
		let widget = chatWidgetService.lastFocusedWidget;
		if (!widget) {
			const widgets = chatWidgetService.getWidgetsByLocations(ChatAgentLocation.Panel);
			if (widgets.length === 0) {
				return;
			}
			widget = widgets[0];
		}
		if (mimeType && NOTEBOOK_CELL_OUTPUT_MIME_TYPE_LIST_FOR_CHAT_CONST.includes(mimeType)) {

			// get the cell index
			const cellFromViewModelHandle = outputViewModel.cellViewModel.handle;
			const cell: ICellViewModel | undefined = notebookEditor.getCellByHandle(cellFromViewModelHandle);
			if (!cell) {
				return;
			}
			// uri of the cell
			const cellUri = cell.uri;

			// get the output index
			const outputId = outputViewModel?.model.outputId;
			let outputIndex: number = 0;
			if (outputId !== undefined) {
				// find the output index

				outputIndex = cell.outputsViewModels.findIndex(output => {
					return output.model.outputId === outputId;
				});


			}
			// get URI of notebook
			let notebookUri = notebookEditor.textModel?.uri;
			if (!notebookUri) {
				// if the notebook is not found, try to parse the cell uri
				const parsedCellUri = CellUri.parse(cellUri);
				notebookUri = parsedCellUri?.notebook;
				if (!notebookUri) {
					return;
				}
			}
			// construct the URI using the cell uri and output index
			const outputCellUri = CellUri.generateCellOutputUriWithIndex(notebookUri, cellUri, outputIndex);



			const l: IBaseChatRequestVariableEntry = {
				value: outputCellUri,
				id: outputCellUri.toString(),
				name: outputCellUri.toString(),
				isFile: true,
			};
			widget.attachmentModel.addContext(l);
		}
	}

});

registerAction2(SelectAndInsertKernelVariableAction);
registerWorkbenchContribution2(NotebookChatContribution.ID, NotebookChatContribution, WorkbenchPhase.BlockRestore);

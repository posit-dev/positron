/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import '../../positronNotebook/browser/AssistantPanel/AssistantPanel.css';

// Other dependencies.
import { localize, localize2 } from '../../../../nls.js';
import { basename } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { PositronDynamicModalDialog } from '../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { OneButtonFooter } from '../../../browser/positronComponents/positronDynamicModalDialog/components/oneButtonFooter.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHeadlessLanguageModelService } from '../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { openPositAssistantChat } from '../../positronAssistant/browser/positAssistantChat.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { AssistantPanelActions } from '../../positronNotebook/browser/AssistantPanel/AssistantPanelActions.js';
import { ISuggestionsRequest } from '../../positronNotebook/browser/AssistantPanel/notebookSuggestions.js';
import { IS_QUARTO_DOCUMENT } from '../common/positronQuartoConfig.js';
import { QUARTO_CATEGORY, QuartoCommandId } from './quartoCommands.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { QUARTO_LANG_WHEN } from './quartoEditorActionBar.js';
import { buildQuartoSuggestionsRequest } from './quartoSuggestions.js';

// Localized strings.
const panelTitle = localize('positron.quartoAssistantPanel.title', "Positron Quarto Assistant");
const actionsHeader = localize('positron.quartoAssistantPanel.actions.header', "Ask Assistant To");
const closeButtonLabel = localize('positron.quartoAssistantPanel.close', "Close");

const AI_ENABLED_WHEN = ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`);

/**
 * QuartoAssistantPanelProps interface.
 */
interface QuartoAssistantPanelProps {
	renderer: PositronModalReactRenderer;
	uri: URI;
	suggestionsRequest: ISuggestionsRequest;
	configurationService: IConfigurationService;
	headlessLmService: IHeadlessLanguageModelService;
	notificationService: INotificationService;
	onActionSelected: (query: string) => void;
}

/**
 * QuartoAssistantPanel component.
 * A centered modal dialog offering assistant actions for a Quarto document.
 */
const QuartoAssistantPanel = (props: QuartoAssistantPanelProps) => {
	const { renderer, onActionSelected } = props;

	const handleClose = () => renderer.dispose();

	const handleActionSelected = (query: string) => {
		renderer.dispose();
		onActionSelected(query);
	};

	return (
		<PositronDynamicModalDialog
			content={
				<div className='assistant-panel-content'>
					<div className='assistant-panel-section-header'>
						{actionsHeader}
					</div>
					<AssistantPanelActions
						configurationService={props.configurationService}
						headlessLmService={props.headlessLmService}
						kind='document'
						notificationService={props.notificationService}
						suggestionsRequest={props.suggestionsRequest}
						uri={props.uri}
						onActionSelected={handleActionSelected}
						onClose={handleClose}
					/>
				</div>
			}
			contentMaxHeight={600}
			contentMinHeight={200}
			footer={<OneButtonFooter buttonTitle={closeButtonLabel} onButton={handleClose} />}
			renderer={renderer}
			title={panelTitle}
			width={480}
			onCancel={handleClose}
		/>
	);
};

/**
 * Action that opens the assistant panel for the active Quarto document.
 */
class QuartoAskAssistantAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.AskAssistant,
			title: localize2('positron.quarto.askAssistant', "Ask Assistant"),
			tooltip: localize2('positron.quarto.askAssistant.tooltip', "Ask the assistant about this document"),
			icon: ThemeIcon.fromId('positron-assistant'),
			f1: true,
			precondition: ContextKeyExpr.and(IS_QUARTO_DOCUMENT, AI_ENABLED_WHEN),
			category: QUARTO_CATEGORY,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 50,
				when: ContextKeyExpr.and(QUARTO_LANG_WHEN, AI_ENABLED_WHEN)
			}
		});
	}

	override run(accessor: ServicesAccessor): void {
		const editorService = accessor.get(IEditorService);
		const editor = editorService.activeTextEditorControl;
		const textModel = isCodeEditor(editor) ? editor.getModel() : null;
		if (!textModel) {
			return;
		}

		const commandService = accessor.get(ICommandService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);
		const documentModel = accessor.get(IQuartoDocumentModelService).getModel(textModel);
		const uri = textModel.uri;

		const renderer = new PositronModalReactRenderer({
			container: accessor.get(ILayoutService).activeContainer,
		});

		// Always start a fresh conversation with the document attached, since
		// the panel is a deliberate "ask about this document" entry.
		const handleActionSelected = (query: string) =>
			openPositAssistantChat(commandService, notificationService, logService, {
				prompt: query,
				target: 'new',
				behavior: 'submit',
				files: [{ uri: uri.toString(), name: basename(uri) }],
			});

		renderer.render(
			<QuartoAssistantPanel
				configurationService={accessor.get(IConfigurationService)}
				headlessLmService={accessor.get(IHeadlessLanguageModelService)}
				notificationService={notificationService}
				renderer={renderer}
				suggestionsRequest={buildQuartoSuggestionsRequest(
					textModel.getValue(),
					documentModel.primaryLanguage,
					documentModel.cells.length
				)}
				uri={uri}
				onActionSelected={handleActionSelected}
			/>
		);
	}
}

registerAction2(QuartoAskAssistantAction);

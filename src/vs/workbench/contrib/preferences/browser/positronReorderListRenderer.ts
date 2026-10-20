/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { isReorderOnlyList, reorderListChoices, reorderListError, reorderRows } from '../common/positronReorderOnlyList.js';
import { PositronReorderListWidget } from './positronReorderListWidget.js';
import { positronSettingRenderers } from './positronSettingRenderers.js';
import { AbstractSettingRenderer, ISettingItemTemplate } from './settingsTree.js';
import { SettingsTreeSettingElement } from './settingsTreeModels.js';

const POSITRON_REORDER_LIST_TEMPLATE_ID = 'settings.positronReorderList.template';

interface IReorderListTemplate extends ISettingItemTemplate<string[]> {
	listWidget: PositronReorderListWidget;
	validationErrorMessageElement: HTMLElement;
	/** Not `context`, which the base class has already set to the new element. */
	renderedElement?: SettingsTreeSettingElement;
}

/** Renders a reorder-only list setting: the user only reorders its rows, never adds or edits them. */
class PositronReorderListRenderer extends AbstractSettingRenderer implements ITreeRenderer<SettingsTreeSettingElement, never, IReorderListTemplate> {
	readonly templateId = POSITRON_REORDER_LIST_TEMPLATE_ID;

	renderTemplate(container: HTMLElement): IReorderListTemplate {
		const common = this.renderCommonTemplate(null, container, 'list');
		const listWidget = common.toDispose.add(this._instantiationService.createInstance(PositronReorderListWidget, common.controlElement));
		listWidget.domNode.classList.add(AbstractSettingRenderer.CONTROL_CLASS);

		// Placed as upstream's list renderer does, so a hand-edited value shows the same error.
		const validationErrorMessageElement = $('.setting-item-validation-message');
		// eslint-disable-next-line no-restricted-syntax
		common.containerElement.querySelector('.setting-item-description')!.after(validationErrorMessageElement);

		const template: IReorderListTemplate = { ...common, listWidget, validationErrorMessageElement };
		this.addSettingElementFocusHandler(template);

		// The widget has already applied the move, so its rows are the new value.
		common.toDispose.add(listWidget.onDidChangeList(() => {
			template.onChange?.(listWidget.items.map(item => item.value.data.toString()));
		}));
		return template;
	}

	renderElement(element: ITreeNode<SettingsTreeSettingElement, never>, index: number, template: IReorderListTemplate): void {
		super.renderSettingElement(element, index, template);
	}

	protected renderValue(dataElement: SettingsTreeSettingElement, template: IReorderListTemplate, onChange: (value: string[]) => void): void {
		// A tab switch builds new elements; keep the other tab's selected row from carrying over.
		if (template.renderedElement !== dataElement) {
			template.listWidget.clearSelection();
			template.renderedElement = dataElement;
		}
		const error = reorderListError(dataElement.setting.key, dataElement.value);
		template.containerElement.classList.toggle('invalid-input', !!error);
		template.validationErrorMessageElement.innerText = error ?? '';
		const key = dataElement.setting.key;
		template.containerElement.setAttribute('aria-label', error ? [key, localize('validationError', "Validation Error."), error].join(' ') : key);

		const saved: unknown[] = Array.isArray(dataElement.value) ? dataElement.value : [];
		template.listWidget.setValue(reorderRows(reorderListChoices(dataElement.setting.key), saved).map(row => ({
			value: { type: 'string', data: row.value },
			label: row.label,
		})));
		template.context = dataElement;
		template.onChange = onChange;
	}
}

positronSettingRenderers.push({
	templateId: POSITRON_REORDER_LIST_TEMPLATE_ID,
	matches: element => isReorderOnlyList(element.setting.key),
	create: (instantiationService, settingActions, actionFactory) =>
		instantiationService.createInstance(PositronReorderListRenderer, settingActions, actionFactory),
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { isReorderOnlyList, withMissingValues } from '../common/positronReorderOnlyList.js';
import { PositronReorderListWidget } from './positronReorderListWidget.js';
import { positronSettingRenderers } from './positronSettingRenderers.js';
import { AbstractSettingRenderer, ISettingItemTemplate } from './settingsTree.js';
import { SettingsTreeSettingElement } from './settingsTreeModels.js';

const POSITRON_REORDER_LIST_TEMPLATE_ID = 'settings.positronReorderList.template';

interface IReorderListTemplate extends ISettingItemTemplate<string[]> {
	listWidget: PositronReorderListWidget;
}

/** Renders a reorder-only list setting: every allowed value is a row, and the user only reorders them. */
class PositronReorderListRenderer extends AbstractSettingRenderer implements ITreeRenderer<SettingsTreeSettingElement, never, IReorderListTemplate> {
	readonly templateId = POSITRON_REORDER_LIST_TEMPLATE_ID;

	renderTemplate(container: HTMLElement): IReorderListTemplate {
		const common = this.renderCommonTemplate(null, container, 'list');
		const listWidget = common.toDispose.add(this._instantiationService.createInstance(PositronReorderListWidget, common.controlElement));
		listWidget.domNode.classList.add(AbstractSettingRenderer.CONTROL_CLASS);

		const template: IReorderListTemplate = { ...common, listWidget };
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
		const { key, enum: allowed, enumItemLabels } = dataElement.setting;
		const saved: string[] = Array.isArray(dataElement.value) ? dataElement.value : [];
		template.listWidget.setValue(withMissingValues(key, allowed, saved).map(id => ({
			value: { type: 'string', data: id },
			label: enumItemLabels?.[allowed?.indexOf(id) ?? -1] ?? id,
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

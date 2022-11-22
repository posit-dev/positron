/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { MarkdownString } from 'vs/base/common/htmlContent';

export const POSITRON_HELP_VIEW_ID = 'workbench.panel.positronHelp';

export const POSITRON_HELP_SERVICE_ID = 'positronHelpService';

export const IPositronHelpService = createDecorator<IPositronHelpService>(POSITRON_HELP_SERVICE_ID);

export interface IHelpResult extends IDisposable {
	element: HTMLElement;
}

/**
 * IPositronHelpService interface.
 */
export interface IPositronHelpService {

	readonly _serviceBrand: undefined;

	readonly onRenderHelp: Event<IHelpResult>;

	openHelpMarkdown(markdown: MarkdownString): void;

	openHelpURL(url: string): void;

	findTextChanged(findText: string): void;

	findPrevious(): void;

	findNext(): void;
}

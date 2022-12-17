/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { MarkdownString } from 'vs/base/common/htmlContent';

export const POSITRON_HELP_VIEW_ID = 'workbench.panel.positronHelp';

export const POSITRON_HELP_SERVICE_ID = 'positronHelpService';

export const IPositronHelpService = createDecorator<IPositronHelpService>(POSITRON_HELP_SERVICE_ID);

/**
 * IPositronHelpService interface.
 */
export interface IPositronHelpService {

	readonly _serviceBrand: undefined;

	readonly onRenderHelp: Event<TrustedHTML | undefined>;

	openHelpHtml(html: string): void;
	openHelpMarkdown(markdown: MarkdownString): void;

}

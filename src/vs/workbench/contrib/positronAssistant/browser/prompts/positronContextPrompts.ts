/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronChatContext } from '../../common/interfaces/positronAssistantService.js';
import * as xml from '../../common/xml.js';

/**
 * Convert Positron's IDE context into XML-like prompt fragments for embedding
 * in a chat prompt.
 *
 * Note: runtime session information (active session, variables, execution
 * history) is provided separately via the chat request's session references,
 * not through this global context.
 *
 * @param context The Positron chat context.
 * @returns An array of context prompt fragments.
 */
export function getPositronContextPrompts(context: IPositronChatContext): string[] {
	const result: string[] = [];

	if (context.shell) {
		result.push(xml.node('shell', context.shell, { description: 'Current active shell' }));
	}
	if (context.plots && context.plots.hasPlots) {
		result.push(xml.node('plots', 'A plot is visible.'));
	}
	if (context.positronVersion) {
		result.push(xml.node('version', `Positron version: ${context.positronVersion}`));
	}
	if (context.currentDate) {
		result.push(xml.node('date', `Today's date is: ${context.currentDate}`));
	}

	return result;
}

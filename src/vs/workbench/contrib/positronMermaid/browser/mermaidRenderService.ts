/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export type MermaidTheme = 'dark' | 'default';

export const IMermaidRenderService = createDecorator<IMermaidRenderService>('mermaidRenderService');

export interface IMermaidRenderService {
	readonly _serviceBrand: undefined;

	/**
	 * Renders a mermaid diagram source string to an SVG string.
	 *
	 * Results are cached by source+theme. Errors are not cached.
	 *
	 * @param source The mermaid diagram source code.
	 * @param theme The mermaid theme to use for rendering.
	 * @returns The rendered SVG string.
	 */
	render(source: string, theme: MermaidTheme): Promise<string>;
}

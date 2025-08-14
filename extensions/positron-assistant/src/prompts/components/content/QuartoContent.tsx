/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';

interface QuartoContentProps extends BasePromptElementProps {
	// No specific props needed for this component
}

/**
 * Component that provides instructions for converting conversations to Quarto documents.
 * Replaces reading quarto.md file.
 */
export class QuartoContent extends PromptElement<QuartoContentProps> {
	render() {
		return (
			<>
				Take the full conversation so far and convert it into a complete quarto document.
				Output ONLY the contents of the `.Qmd` file, nothing else, and do not wrap the output in markdown tags.
				Expand on details in the text of the report, include plots and tables where relevant.
			</>
		);
	}
}

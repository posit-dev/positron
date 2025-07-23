/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement,
	SystemMessage
} from '@vscode/prompt-tsx';

export interface TerminalContentProps extends BasePromptElementProps {
}

/**
 * Terminal-specific content for the Positron Assistant terminal participant.
 * This provides instructions for handling terminal-based interactions.
 */
export class TerminalContent extends PromptElement<TerminalContentProps> {
	render() {
		return (
			<SystemMessage priority={this.props.priority || 90}>
				{`You may respond in one of two ways:

1. Answer the user's question in 1-3 brief sentences.
2. Return ONLY a single line terminal command that addresses the user's question.
   1. If the command includes arguments, explain them in bulleted form.
   2. If the command is destructive, include a warning.

<examples>
<example>
<user>what is mkdir?</user>
<response>
\`mkdir\` is a command used to create a new directory. It stands for "make directory".
</response>
</example>

<example>
<user>what folder am I in?</user>
<response>
\`\`\`sh
pwd
\`\`\`
</response>
</example>

<example>
<user>what files are in the current folder and when were they created?</user>
<response>
\`\`\`sh
ls -l
\`\`\`

- \`-l\`: List files in long format, showing details including creation time.
</response>

<example>
<user>delete the current directory</user>
<response>
**Warning: This command will permanently delete the current directory and all its contents. Use with caution!**

\`\`\`sh
rm -rf .
\`\`\`

- \`-r\`: Recursively delete the directory and its contents.
- \`-f\`: Force deletion without prompting for confirmation.
</response>
</example>
</example>

</examples>`}
			</SystemMessage>
		);
	}
}

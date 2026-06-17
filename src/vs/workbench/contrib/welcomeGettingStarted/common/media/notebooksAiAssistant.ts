/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Use the es6-string-html VS Code extension to syntax highlight the markdown content below.
export default () => /* markdown */`
Unlike general-purpose AI assistants, Posit Assistant is specifically designed for data science workflows. It understands your notebook's execution context, including which cells you've run, what variables exist in memory, your execution history, and any errors you've encountered.

## What Assistant can do

- **Context-aware conversations** - Ask questions about your data, get help understanding errors and more.
- **Code generation and refactoring** - Get help writing new analysis code, refactoring existing notebooks, or exploring alternative data analysis approaches.
- **Smart quick actions** - Use AI-powered actions to explain code blocks, fix errors, or suggest improvements to your analysis.

<div align="center">
<img src="./notebook-ai-context-abstract.svg" alt="Positron Notebook Editor" width="400">
</div>

## Getting Started

The AI assistant can see your notebook's code, outputs, and variable states, making it uniquely powerful for interactive data science workflows.

**Prerequisites:** Ensure you have the [Assistant enabled and configured](https://positron.posit.co/assistant-getting-started.html) with your preferred model provider.

**Try it now:** [Open Posit Assistant](command:workbench.view.extension.posit-assistant) to configure your model provider and start an AI-assisted data science conversation.

**Work without AI:** No AI service is connected automatically if you do not opt in to using the Assistant.
`;

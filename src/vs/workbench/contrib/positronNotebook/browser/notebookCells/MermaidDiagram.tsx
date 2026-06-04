/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './MermaidDiagram.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { FileAccess, nodeModulesPath } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { isDark } from '../../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { webviewGenericCspSource } from '../../../webview/common/webview.js';
import { useWebviewMount } from './hooks/useWebviewMount.js';

type MermaidTheme = 'dark' | 'default';

interface MermaidDiagramProps {
	readonly source: string;
	readonly onDoubleClick?: () => void;
	readonly onFocus?: () => void;
}

interface MermaidWebviewProps extends MermaidDiagramProps {
	readonly theme: MermaidTheme;
}

interface MountedMermaidWebviewProps {
	readonly webview: Promise<INotebookOutputWebview>;
	readonly onDoubleClick?: () => void;
	readonly onFocus?: () => void;
}

function escapeHtmlText(str: string): string {
	return str.replace(/[&<>"']/g, char => {
		switch (char) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			case '\'':
				return '&#39;';
			default:
				return char;
		}
	});
}

function getMermaidResourceRoot() {
	return joinPath(FileAccess.asFileUri(nodeModulesPath), 'mermaid', 'dist');
}

function getMermaidWebviewHtml(source: string, theme: MermaidTheme): string {
	const nonce = generateUuid();

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webviewGenericCspSource} data:; script-src ${webviewGenericCspSource} 'nonce-${nonce}'; style-src ${webviewGenericCspSource} 'unsafe-inline';">
	<style>
		html,
		body {
			margin: 0;
			padding: 0;
			background: transparent;
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}

		body {
			box-sizing: border-box;
			padding: 8px;
			overflow: auto;
		}

		.mermaid {
			display: flex;
			justify-content: center;
			margin: 0;
			visibility: hidden;
		}

		.mermaid.rendered {
			visibility: visible;
		}

		.mermaid svg {
			max-width: 100%;
			height: auto;
		}

		.mermaid-diagram-error {
			box-sizing: border-box;
			margin: 0;
			white-space: pre-wrap;
			color: var(--vscode-errorForeground);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}
	</style>
</head>
<body>
	<pre class="mermaid">${escapeHtmlText(source)}</pre>
	<script nonce="${nonce}" src="mermaid.min.js"></script>
	<script nonce="${nonce}">
		(function() {
			const render = async () => {
				const diagram = document.querySelector('.mermaid');
				if (!diagram) {
					return;
				}

				window.addEventListener('dblclick', () => {
					window.dispatchEvent(new CustomEvent('positronWebviewDoubleClick'));
				});

				try {
					const mermaid = globalThis.mermaid;
					if (!mermaid) {
						throw new Error('Mermaid library did not load.');
					}

					mermaid.initialize({
						startOnLoad: false,
						theme: ${JSON.stringify(theme)},
						securityLevel: 'strict'
					});

					await mermaid.run({ nodes: [diagram] });
					diagram.classList.add('rendered');
				} catch (err) {
					const message = err && typeof err === 'object' && 'message' in err
						? err.message
						: String(err);
					document.body.textContent = '';
					const errorElement = document.createElement('pre');
					errorElement.className = 'mermaid-diagram-error';
					errorElement.textContent = 'Error rendering diagram: ' + message;
					document.body.appendChild(errorElement);
				}
			};

			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', render);
			} else {
				render();
			}
		})();
	</script>
</body>
</html>`;
}

/**
 * Renders a mermaid diagram in an isolated notebook output webview.
 *
 * Mermaid mutates DOM with innerHTML while rendering, which is blocked by the
 * workbench document's Trusted Types CSP. The overlay webview gives Mermaid its
 * own document while preserving notebook sizing and scroll behavior.
 */
export function MermaidDiagram({ source, onDoubleClick, onFocus }: MermaidDiagramProps) {
	const services = usePositronReactServicesContext();
	const themeService = services.get(IThemeService);

	const getMermaidTheme = React.useCallback(
		(): MermaidTheme => isDark(themeService.getColorTheme().type) ? 'dark' : 'default',
		[themeService]
	);
	const [theme, setTheme] = React.useState(getMermaidTheme);

	React.useEffect(() => {
		const disposable = themeService.onDidColorThemeChange(() => {
			setTheme(getMermaidTheme());
		});
		return () => disposable.dispose();
	}, [themeService, getMermaidTheme]);

	return (
		<MermaidWebview
			key={`${source}:${theme}`}
			source={source}
			theme={theme}
			onDoubleClick={onDoubleClick}
			onFocus={onFocus}
		/>
	);
}

function MermaidWebview({ source, theme, onDoubleClick, onFocus }: MermaidWebviewProps) {
	const services = usePositronReactServicesContext();
	const notebookOutputWebviewService = services.get(IPositronNotebookOutputWebviewService);
	const [webview, setWebview] = React.useState<Promise<INotebookOutputWebview>>();

	React.useEffect(() => {
		let disposed = false;
		let resolvedWebview: INotebookOutputWebview | undefined;
		const webviewPromise = notebookOutputWebviewService.createRawHtmlOutputWebview(
			`mermaid-${generateUuid()}`,
			getMermaidWebviewHtml(source, theme),
			getMermaidResourceRoot()
		);

		setWebview(webviewPromise);

		webviewPromise.then(
			outputWebview => {
				resolvedWebview = outputWebview;
				if (disposed) {
					outputWebview.dispose();
				}
			},
			() => {
				// useWebviewMount reports rejected webview creation promises.
			}
		);

		return () => {
			disposed = true;
			resolvedWebview?.dispose();
		};
	}, [notebookOutputWebviewService, source, theme]);

	if (!webview) {
		return (
			<div className='mermaid-diagram-loading'>
				{localize('positron.notebook.mermaid.rendering', 'Rendering diagram...')}
			</div>
		);
	}

	return (
		<MountedMermaidWebview
			webview={webview}
			onDoubleClick={onDoubleClick}
			onFocus={onFocus}
		/>
	);
}

function MountedMermaidWebview({ webview, onDoubleClick, onFocus }: MountedMermaidWebviewProps) {
	const { containerRef, isLoading, error } = useWebviewMount(webview, { onDoubleClick, onFocus });

	if (error) {
		return (
			<div className='mermaid-diagram-error'>
				{localize('positron.notebook.mermaid.error', 'Error rendering diagram: {0}', error.message)}
			</div>
		);
	}

	return (
		<>
			{isLoading && (
				<div className='mermaid-diagram-loading'>
					{localize('positron.notebook.mermaid.rendering', 'Rendering diagram...')}
				</div>
			)}
			<div ref={containerRef} className='mermaid-diagram-container' />
		</>
	);
}

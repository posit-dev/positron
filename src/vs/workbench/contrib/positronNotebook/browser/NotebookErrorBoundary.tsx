/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookErrorBoundary.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * The error boundary level determines the fallback UI style and message.
 */
type ErrorBoundaryLevel = 'output' | 'cell' | 'editor';

/**
 * Common props shared by all error boundary levels.
 */
interface NotebookErrorBoundaryBaseProps {
	/** Descriptive name for logging. */
	componentName: string;
	/** Log service for error logging (class components cannot use hooks). */
	logService: ILogService;
	/** Child components to render. */
	children: React.ReactNode;
}

/**
 * Props for the NotebookErrorBoundary component.
 * Uses a discriminated union so `onReload` is required at the editor level.
 */
type NotebookErrorBoundaryProps = NotebookErrorBoundaryBaseProps & (
	| { level: 'output' | 'cell' }
	| { level: 'editor'; onReload: () => void }
);

/**
 * State for the NotebookErrorBoundary component.
 */
interface NotebookErrorBoundaryState {
	hasError: boolean;
	error?: Error;
	componentStack?: string;
	showDetails: boolean;
	retryCount: number;
}

/**
 * Localized strings.
 */
const levelMessages: Record<ErrorBoundaryLevel, string> = {
	output: localize('positron.notebook.errorBoundary.output', "Something went wrong rendering this output."),
	cell: localize('positron.notebook.errorBoundary.cell', "Something went wrong rendering this cell."),
	editor: localize('positron.notebook.errorBoundary.editor', "Something went wrong rendering this notebook."),
};
const retryLabel = localize('positron.notebook.errorBoundary.retry', "Retry");
const reloadLabel = localize('positron.notebook.errorBoundary.reload', "Reload");
const showDetailsLabel = localize('positron.notebook.errorBoundary.showDetails', "Show Details");
const hideDetailsLabel = localize('positron.notebook.errorBoundary.hideDetails', "Hide Details");

/**
 * Error boundary for Positron notebook components.
 *
 * Catches errors thrown during rendering of child components and displays a
 * fallback UI with error details and retry/reload actions. Can be used at
 * output, cell, or editor level with appropriate styling for each.
 */
export class NotebookErrorBoundary extends React.Component<
	NotebookErrorBoundaryProps,
	NotebookErrorBoundaryState
> {
	constructor(props: NotebookErrorBoundaryProps) {
		super(props);
		this.state = {
			hasError: false,
			showDetails: false,
			retryCount: 0,
		};
	}

	static getDerivedStateFromError(error: Error): Partial<NotebookErrorBoundaryState> {
		return { hasError: true, error, componentStack: undefined, showDetails: false };
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
		const { level, componentName, logService } = this.props;
		const componentStack = errorInfo.componentStack ?? '';
		this.setState({ componentStack });

		logService.error(
			`Positron Notebook | ErrorBoundary (${level}) | Component "${componentName}" failed to render: ${error.message}`,
			componentStack
		);
	}

	private handleRetry = (): void => {
		this.setState(prevState => ({
			hasError: false,
			error: undefined,
			componentStack: undefined,
			showDetails: false,
			retryCount: prevState.retryCount + 1,
		}));
	};

	private handleReload = (): void => {
		// Only called when level === 'editor'; narrowing needed for TypeScript.
		if (this.props.level === 'editor') {
			this.props.onReload();
		}
	};

	private toggleDetails = (): void => {
		this.setState(prevState => ({
			showDetails: !prevState.showDetails,
		}));
	};

	override render(): React.ReactNode {
		if (this.state.hasError) {
			const { level } = this.props;
			const { error, componentStack, showDetails } = this.state;
			const message = levelMessages[level];
			const isEditorLevel = level === 'editor';

			return (
				<div className={`notebook-error-boundary notebook-error-boundary-${level}`} role='alert'>
					<div className='notebook-error-boundary-header'>
						<span className='notebook-error-boundary-icon codicon codicon-error'></span>
						<span>{message}</span>
					</div>
					<div className='notebook-error-boundary-actions'>
						<button
							className='notebook-error-boundary-action'
							onClick={this.toggleDetails}
						>
							{showDetails ? hideDetailsLabel : showDetailsLabel}
						</button>
						{isEditorLevel ? (
							<button
								className='notebook-error-boundary-action'
								onClick={this.handleReload}
							>
								{reloadLabel}
							</button>
						) : (
							<button
								className='notebook-error-boundary-action'
								onClick={this.handleRetry}
							>
								{retryLabel}
							</button>
						)}
					</div>
					{showDetails && (
						<div className='notebook-error-boundary-details'>
							<code>
								{error?.message}
								{componentStack && <>{'\n'}{componentStack}</>}
							</code>
						</div>
					)}
				</div>
			);
		}

		return (
			<React.Fragment key={this.state.retryCount}>
				{this.props.children}
			</React.Fragment>
		);
	}
}

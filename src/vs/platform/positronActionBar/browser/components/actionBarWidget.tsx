/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarWidget.css';

// React.
import React, { useCallback } from 'react';

// Other dependencies.
import { IPositronActionBarWidgetDescriptor } from '../positronActionBarWidgetRegistry.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { ICommandService } from '../../../commands/common/commands.js';

/**
 * Error boundary for action bar widgets.
 * Catches errors thrown by widget components and displays an error indicator
 * instead of crashing the entire action bar.
 */
class WidgetErrorBoundary extends React.Component<
	{ widgetId: string; children: React.ReactNode },
	{ hasError: boolean; error?: Error }
> {
	constructor(props: { widgetId: string; children: React.ReactNode }) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error };
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error(`Action bar widget '${this.props.widgetId}' failed to render:`, error, errorInfo);
	}

	override render() {
		if (this.state.hasError) {
			return (
				<div
					className='action-bar-widget-error'
					title={`Widget error: ${this.state.error?.message || 'Unknown error'}`}
				>
					<span className='codicon codicon-error'></span>
				</div>
			);
		}

		return this.props.children;
	}
}

/**
 * ActionBarWidget component props.
 */
interface ActionBarWidgetProps {
	/** The widget descriptor containing component factory and metadata */
	readonly descriptor: IPositronActionBarWidgetDescriptor;
}

/**
 * Renders a custom React widget in the action bar.
 *
 * This component supports two widget types:
 *
 * 1. **Command-driven widgets** (default):
 *    - Widget is wrapped in a button that executes a command
 *    - Button provides full accessibility (ARIA, keyboard events, focus)
 *    - Widget component is purely presentational
 *
 * 2. **Self-contained widgets** (selfContained: true):
 *    - Widget manages its own interaction and accessibility
 *    - No button wrapper (just styled div for visual consistency)
 *    - Widget is responsible for ARIA, keyboard events, and focus
 *
 * Per-render lifecycle means:
 * - Simple, no memoization complexity
 * - Widget always gets fresh props/context
 * - Widget manages its own state internally
 * - No cleanup needed between renders
 * - Performance should be considered to avoid slow performance
 *
 * If the widget throws an error during render, the error boundary catches it
 * and displays an error icon instead of crashing the entire action bar.
 *
 * @param props Component props containing the widget descriptor
 * @returns Rendered widget component (or error indicator if widget failed)
 */
export const ActionBarWidget = (props: ActionBarWidgetProps) => {
	// Get services accessor for passing to component factory
	const services = usePositronReactServicesContext();
	const commandService = services.get(ICommandService);

	const WidgetComponent = props.descriptor.componentFactory(services);

	// Handler for command execution (only used for command-driven widgets)
	const handleClick = useCallback(() => {
		if (props.descriptor.commandId) {
			commandService.executeCommand(props.descriptor.commandId, props.descriptor.commandArgs);
		}
	}, [props.descriptor.commandId, props.descriptor.commandArgs, commandService]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if ((e.key === 'Enter' || e.key === ' ') && props.descriptor.commandId) {
			e.preventDefault();
			commandService.executeCommand(props.descriptor.commandId, props.descriptor.commandArgs);
		}
	}, [props.descriptor.commandId, props.descriptor.commandArgs, commandService]);

	// Render the widget content
	const widgetContent = (
		<WidgetErrorBoundary widgetId={props.descriptor.id}>
			<WidgetComponent />
		</WidgetErrorBoundary>
	);

	// Self-contained widgets: just wrap in styled div (no button semantics)
	if (props.descriptor.selfContained) {
		console.log(`POSITRON NOTEBOOK: Rendering self-contained widget '${props.descriptor.id}'`);
		return (
			<div className='action-bar-button action-bar-widget'>
				{widgetContent}
			</div>
		);
	}

	// Command-driven widgets: wrap in button for full accessibility
	if (props.descriptor.commandId) {
		console.log(`POSITRON NOTEBOOK: Rendering command-driven widget '${props.descriptor.id}' with command '${props.descriptor.commandId}'`);
		return (
			<button
				aria-label={props.descriptor.ariaLabel}
				className='action-bar-button action-bar-widget'
				title={props.descriptor.tooltip}
				onClick={handleClick}
				onKeyDown={handleKeyDown}
			>
				{widgetContent}
			</button>
		);
	}

	// Legacy widgets (no command, not self-contained): styled div only
	// This maintains backward compatibility but should be avoided in new code
	return (
		<div className='action-bar-button action-bar-widget'>
			{widgetContent}
		</div>
	);
};

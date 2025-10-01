/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarWidget.css';

// React.
import React from 'react';

// Other dependencies.
import { IPositronActionBarWidgetDescriptor } from '../positronActionBarWidgetRegistry.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

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
 * This component:
 * 1. Wraps the widget content in action bar button styling for visual consistency
 * 2. Calls the widget's componentFactory to get the React component type
 * 3. Renders that component within an error boundary for fault isolation
 * 4. Uses per-render lifecycle (new component instance on each render)
 *
 * The wrapper div applies action-bar-button class to ensure widgets match the
 * visual styling of standard action bar buttons (padding, border-radius, hover states).
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

	const WidgetComponent = props.descriptor.componentFactory(services);

	return (
		<div className='action-bar-button action-bar-widget'>
			<WidgetErrorBoundary widgetId={props.descriptor.id}>
				<WidgetComponent />
			</WidgetErrorBoundary>
		</div>
	);
};

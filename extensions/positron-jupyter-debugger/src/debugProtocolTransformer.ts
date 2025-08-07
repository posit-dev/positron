/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DebugProtocol } from '@vscode/debugprotocol';

/**
 * Represents a source location in the debug protocol.
 */
export interface DebugLocation {
	source?: DebugProtocol.Source;
	line?: number;
	endLine?: number;
}

type DebugProtocolTransform<T extends DebugProtocol.ProtocolMessage | DebugLocation> = (obj: T) => T;

/**
 * Options for the {@link DebugProtocolTransformer}.
 */
export interface DebugProtocolTransformerOptions {
	/**
	 * Transforms a debug source location.
	 *
	 * @param obj The debug source location to transform.
	 * @return The transformed debug source location.
	 *   If the transformation is not applicable, return `undefined`.
	 */
	location?: <T extends DebugLocation>(obj: T) => T | undefined;
}

/**
 * Transforms debug protocol messages.
 */
export class DebugProtocolTransformer {
	constructor(private readonly options: DebugProtocolTransformerOptions) { }

	/**
	 * Transforms a debug protocol message.
	 *
	 * @param message The debug protocol message to transform.
	 * @returns The transformed debug protocol message.
	 */
	transform(message: DebugProtocol.ProtocolMessage): DebugProtocol.ProtocolMessage {
		switch (message.type) {
			case 'event':
				return this.event(message as DebugProtocol.Event);
			case 'request':
				return this.request(message as DebugProtocol.Request);
			case 'response':
				return this.response(message as DebugProtocol.Response);
			default:
				return message;
		}
	}

	private event: DebugProtocolTransform<DebugProtocol.Event> = message => {
		switch (message.event) {
			case 'breakpoint':
				return this.breakpointEvent(message as DebugProtocol.BreakpointEvent);
			case 'loadedSource':
				return this.loadedSourceEvent(message as DebugProtocol.LoadedSourceEvent);
			case 'output':
				return this.outputEvent(message as DebugProtocol.OutputEvent);
			default:
				return message;
		}
	};

	private request: DebugProtocolTransform<DebugProtocol.Request> = message => {
		switch (message.command) {
			case 'breakpointLocations':
				return this.breakpointLocationsRequest(message as DebugProtocol.BreakpointLocationsRequest);
			case 'gotoTargets':
				return this.gotoTargetsRequest(message as DebugProtocol.GotoTargetsRequest);
			case 'setBreakpoints':
				return this.setBreakpointsRequest(message as DebugProtocol.SetBreakpointsRequest);
			case 'source':
				return this.sourceRequest(message as DebugProtocol.SourceRequest);
			default:
				return message;
		}
	};

	private response: DebugProtocolTransform<DebugProtocol.Response> = message => {
		switch (message.command) {
			case 'loadedSources':
				return this.loadedSourcesResponse(message as DebugProtocol.LoadedSourcesResponse);
			case 'scopes':
				return this.scopesResponse(message as DebugProtocol.ScopesResponse);
			case 'setBreakpoints':
				return this.setBreakpointsResponse(message as DebugProtocol.SetBreakpointsResponse);
			case 'setFunctionBreakpoints':
				return this.setFunctionBreakpointsResponse(message as DebugProtocol.SetFunctionBreakpointsResponse);
			case 'stackTrace':
				return this.stackTraceResponse(message as DebugProtocol.StackTraceResponse);
			default:
				return message;
		}
	};

	private breakpointEvent: DebugProtocolTransform<DebugProtocol.BreakpointEvent> = message => {
		const breakpoint = this.options.location?.(message.body.breakpoint);
		if (!breakpoint) {
			return message;
		}
		return {
			...message,
			body: {
				...message.body,
				breakpoint,
			},
		};
	};

	private loadedSourceEvent: DebugProtocolTransform<DebugProtocol.LoadedSourceEvent> = message => {
		const body = this.options.location?.(message.body);
		if (!body) {
			return message;
		}
		return {
			...message,
			body,
		};
	};

	private outputEvent: DebugProtocolTransform<DebugProtocol.OutputEvent> = message => {
		const body = this.options.location?.(message.body);
		if (!body) {
			return message;
		}
		return {
			...message,
			body,
		};
	};

	private breakpointLocationsRequest: DebugProtocolTransform<DebugProtocol.BreakpointLocationsRequest> = message => {
		const args = message.arguments && this.options.location?.(message.arguments);
		if (!args) {
			return message;
		}
		return {
			...message,
			arguments: args,
		};
	};

	private gotoTargetsRequest: DebugProtocolTransform<DebugProtocol.GotoTargetsRequest> = message => {
		const args = this.options.location?.(message.arguments);
		if (!args) {
			return message;
		}
		return {
			...message,
			arguments: args,
		};
	};

	private setBreakpointsRequest: DebugProtocolTransform<DebugProtocol.SetBreakpointsRequest> = message => {
		const [updatedBreakpoints, breakpoints] = message.arguments.breakpoints ?
			transformArray(message.arguments.breakpoints, breakpoint => {
				const location = this.options.location?.({ source: message.arguments.source, line: breakpoint.line });
				return location && { ...breakpoint, line: location.line };
			}) :
			[false, message.arguments.breakpoints];

		const source = this.options.location?.({ source: message.arguments.source })?.source;

		if (!updatedBreakpoints && !source) {
			return message;
		}

		return {
			...message,
			arguments: {
				...message.arguments,
				breakpoints,
				source: source ?? message.arguments.source,
			},
		};
	};

	private sourceRequest: DebugProtocolTransform<DebugProtocol.SourceRequest> = message => {
		const args = this.options.location?.(message.arguments);
		if (!args) {
			return message;
		}
		return {
			...message,
			arguments: args,
		};
	};

	private loadedSourcesResponse: DebugProtocolTransform<DebugProtocol.LoadedSourcesResponse> = message => {
		const [updated, sources] = transformArray(message.body.sources, source => this.options.location?.({ source })?.source);
		if (!updated) {
			return message;
		}
		return {
			...message,
			body: {
				...message.body,
				sources,
			},
		};
	};

	private scopesResponse: DebugProtocolTransform<DebugProtocol.ScopesResponse> = message => {
		const [updated, scopes] = transformArray(message.body.scopes, scope => this.options.location?.(scope));
		if (!updated) {
			return message;
		}
		return {
			...message,
			body: {
				...message.body,
				scopes,
			},
		};
	};

	private setBreakpointsResponse: DebugProtocolTransform<DebugProtocol.SetBreakpointsResponse> = message => {
		const [updated, breakpoints] = transformArray(message.body.breakpoints, breakpoint => this.options.location?.(breakpoint));
		if (!updated) {
			return message;
		}
		return {
			...message,
			body: {
				...message.body,
				breakpoints,
			},
		};
	};

	private setFunctionBreakpointsResponse: DebugProtocolTransform<DebugProtocol.SetFunctionBreakpointsResponse> = message => {
		const [updated, breakpoints] = transformArray(message.body.breakpoints, breakpoint => this.options.location?.(breakpoint));
		if (!updated) {
			return message;
		}
		return {
			...message,
			body: {
				...message.body,
				breakpoints,
			},
		};
	};

	private stackTraceResponse: DebugProtocolTransform<DebugProtocol.StackTraceResponse> = message => {
		const [updated, stackFrames] = transformArray(message.body.stackFrames, frame => this.options.location?.(frame));
		if (!updated) {
			return message;
		}
		return {
			...message,
			body: {
				...message.body,
				stackFrames,
			},
		};
	};
}

function transformArray<T>(array: T[], transformFn: (item: T) => T | undefined): [boolean, T[]] {
	let updated = false;
	const transformedArray = array.map(item => {
		const transformedItem = transformFn(item);
		if (!transformedItem) {
			return item;
		}
		updated = true;
		return transformedItem;
	});
	return [updated, transformedArray];
}

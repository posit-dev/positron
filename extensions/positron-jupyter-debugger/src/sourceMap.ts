/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DebugProtocol } from '@vscode/debugprotocol';

export interface DebugLocation {
	source?: DebugProtocol.Source;
	line?: number;
	endLine?: number;
}

export interface DebugProtocolTransformerOptions {
	location: <T extends DebugLocation>(obj: T) => T;
}

type DebugProtocolTransform<T extends DebugProtocol.ProtocolMessage | DebugLocation> = (obj: T) => T;

export class DebugProtocolTransformer {
	constructor(private readonly options: DebugProtocolTransformerOptions) { }

	transform(message: DebugProtocol.ProtocolMessage): DebugProtocol.ProtocolMessage {
		switch (message.type) {
			case 'event':
				return this.event(message as DebugProtocol.Event);
			case 'request':
				return this.request(message as DebugProtocol.Request);
			case 'response':
				return this.response(message as DebugProtocol.Response);
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

	private request: DebugProtocolTransform<DebugProtocol.Request> = request => {
		switch (request.command) {
			case 'breakpointLocations':
				return this.breakpointLocationsRequest(request as DebugProtocol.BreakpointLocationsRequest);
			case 'gotoTargets':
				return this.gotoTargetsRequest(request as DebugProtocol.GotoTargetsRequest);
			case 'setBreakpoints':
				return this.setBreakpointsRequest(request as DebugProtocol.SetBreakpointsRequest);
			case 'source':
				return this.sourceRequest(request as DebugProtocol.SourceRequest);
			default:
				return request;
		}
	};

	private response: DebugProtocolTransform<DebugProtocol.Response> = response => {
		switch (response.command) {
			case 'loadedSources':
				return this.loadedSourcesResponse(response as DebugProtocol.LoadedSourcesResponse);
			case 'scopes':
				return this.scopesResponse(response as DebugProtocol.ScopesResponse);
			case 'setBreakpoints':
				return this.setBreakpointsResponse(response as DebugProtocol.SetBreakpointsResponse);
			case 'setFunctionBreakpoints':
				return this.setFunctionBreakpointsResponse(response as DebugProtocol.SetFunctionBreakpointsResponse);
			case 'stackTrace':
				return this.stackTraceResponse(response as DebugProtocol.StackTraceResponse);
			default:
				return response;
		}
	};

	private breakpointEvent: DebugProtocolTransform<DebugProtocol.BreakpointEvent> = event => {
		return {
			...event,
			body: {
				...event.body,
				breakpoint: this.options.location(event.body.breakpoint),
			},
		};
	};

	private loadedSourceEvent: DebugProtocolTransform<DebugProtocol.LoadedSourceEvent> = event => {
		return {
			...event,
			body: this.options.location(event.body),
		};
	};

	private outputEvent: DebugProtocolTransform<DebugProtocol.OutputEvent> = event => {
		return {
			...event,
			body: this.options.location(event.body),
		};
	};

	private breakpointLocationsRequest: DebugProtocolTransform<DebugProtocol.BreakpointLocationsRequest> = request => {
		return {
			...request,
			arguments: this.options.location(request.arguments),
		};
	};

	private gotoTargetsRequest: DebugProtocolTransform<DebugProtocol.GotoTargetsRequest> = request => {
		return {
			...request,
			arguments: this.options.location(request.arguments),
		};
	};

	private setBreakpointsRequest: DebugProtocolTransform<DebugProtocol.SetBreakpointsRequest> = request => {
		return {
			...request,
			arguments: {
				...request.arguments,
				breakpoints: request.arguments.breakpoints?.map(breakpoint => {
					const location = this.options.location({ source: request.arguments.source, line: breakpoint.line });
					return {
						...breakpoint,
						line: location.line,
					};
				}),
				source: this.options.location({ source: request.arguments.source }).source,
			},
		};
	};

	private sourceRequest: DebugProtocolTransform<DebugProtocol.SourceRequest> = request => {
		return {
			...request,
			arguments: this.options.location(request.arguments),
		};
	};

	private loadedSourcesResponse: DebugProtocolTransform<DebugProtocol.LoadedSourcesResponse> = response => {
		return {
			...response,
			body: {
				...response.body,
				sources: response.body.sources.map(source => {
					return this.options.location({ source }).source;
				}),
			},
		};
	};

	private scopesResponse: DebugProtocolTransform<DebugProtocol.ScopesResponse> = response => {
		return {
			...response,
			body: {
				...response.body,
				scopes: response.body.scopes.map(scope => {
					return this.options.location(scope);
				}),
			},
		};
	};

	private setBreakpointsResponse: DebugProtocolTransform<DebugProtocol.SetBreakpointsResponse> = response => {
		return {
			...response,
			body: {
				...response.body,
				breakpoints: response.body.breakpoints.map(breakpoint => {
					return this.options.location(breakpoint);
				}),
			},
		};
	};

	private setFunctionBreakpointsResponse: DebugProtocolTransform<DebugProtocol.SetFunctionBreakpointsResponse> = response => {
		return {
			...response,
			body: {
				...response.body,
				breakpoints: response.body.breakpoints.map(breakpoint => {
					return this.options.location(breakpoint);
				}),
			},
		};
	};

	private stackTraceResponse: DebugProtocolTransform<DebugProtocol.StackTraceResponse> = response => {
		return {
			...response,
			body: {
				...response.body,
				stackFrames: response.body.stackFrames.map(frame => {
					return this.options.location(frame);
				}),
			},
		};
	};
}

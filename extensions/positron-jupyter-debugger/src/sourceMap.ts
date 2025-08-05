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

export class SourceMapper {
	constructor(
		private readonly mapLocation: <T extends DebugLocation>(location: T) => T,
	) { }

	map(message: DebugProtocol.ProtocolMessage): DebugProtocol.ProtocolMessage {
		switch (message.type) {
			case 'event':
				return this.mapEvent(message as DebugProtocol.Event);
			case 'request':
				return this.mapRequest(message as DebugProtocol.Request);
			case 'response':
				return this.mapResponse(message as DebugProtocol.Response);
		}
	}

	private mapEvent(event: DebugProtocol.Event): DebugProtocol.Event {
		switch (event.event) {
			case 'breakpoint':
				return this.mapBreakpointEvent(event as DebugProtocol.BreakpointEvent);
			case 'loadedSource':
				return this.mapLoadedSourceEvent(event as DebugProtocol.LoadedSourceEvent);
			case 'output':
				return this.mapOutputEvent(event as DebugProtocol.OutputEvent);
			default:
				return event;
		}
	}

	private mapRequest(request: DebugProtocol.Request): DebugProtocol.Request {
		switch (request.command) {
			case 'breakpointLocations':
				return this.mapBreakpointLocationsRequest(request as DebugProtocol.BreakpointLocationsRequest);
			case 'gotoTargets':
				return this.mapGotoTargetsRequest(request as DebugProtocol.GotoTargetsRequest);
			case 'setBreakpoints':
				return this.mapSetBreakpointsRequest(request as DebugProtocol.SetBreakpointsRequest);
			case 'source':
				return this.mapSourceRequest(request as DebugProtocol.SourceRequest);
			default:
				return request;
		}
	}

	private mapResponse(response: DebugProtocol.Response): DebugProtocol.Response {
		switch (response.command) {
			case 'loadedSources':
				return this.mapLoadedSourcesResponse(response as DebugProtocol.LoadedSourcesResponse);
			case 'scopes':
				return this.mapScopesResponse(response as DebugProtocol.ScopesResponse);
			case 'setBreakpoints':
				return this.mapSetBreakpointsResponse(response as DebugProtocol.SetBreakpointsResponse);
			case 'setFunctionBreakpoints':
				return this.mapSetFunctionBreakpointsResponse(response as DebugProtocol.SetFunctionBreakpointsResponse);
			case 'stackTrace':
				return this.mapStackTraceResponse(response as DebugProtocol.StackTraceResponse);
			default:
				return response;
		}
	}

	private mapBreakpointEvent(event: DebugProtocol.BreakpointEvent): DebugProtocol.BreakpointEvent {
		return {
			...event,
			body: {
				...event.body,
				breakpoint: this.mapLocation(event.body.breakpoint),
			},
		};
	}

	private mapLoadedSourceEvent(event: DebugProtocol.LoadedSourceEvent): DebugProtocol.LoadedSourceEvent {
		return {
			...event,
			body: this.mapLocation(event.body),
		};
	}

	private mapOutputEvent(event: DebugProtocol.OutputEvent): DebugProtocol.OutputEvent {
		return {
			...event,
			body: this.mapLocation(event.body),
		};
	}

	private mapBreakpointLocationsRequest(request: DebugProtocol.BreakpointLocationsRequest): DebugProtocol.BreakpointLocationsRequest {
		return {
			...request,
			arguments: this.mapLocation(request.arguments),
		};
	}

	private mapGotoTargetsRequest(request: DebugProtocol.GotoTargetsRequest): DebugProtocol.GotoTargetsRequest {
		return {
			...request,
			arguments: this.mapLocation(request.arguments),
		};
	}

	private mapSetBreakpointsRequest(request: DebugProtocol.SetBreakpointsRequest): DebugProtocol.Request {
		return {
			...request,
			arguments: {
				...request.arguments,
				breakpoints: request.arguments.breakpoints?.map((breakpoint) => {
					const location = this.mapLocation({ source: request.arguments.source, line: breakpoint.line });
					return {
						...breakpoint,
						line: location.line,
					};
				}),
				source: this.mapLocation({ source: request.arguments.source }).source,
			},
		};
	}

	private mapSourceRequest(request: DebugProtocol.SourceRequest): DebugProtocol.SourceRequest {
		return {
			...request,
			arguments: this.mapLocation(request.arguments),
		};
	}

	private mapLoadedSourcesResponse(response: DebugProtocol.LoadedSourcesResponse): DebugProtocol.LoadedSourcesResponse {
		return {
			...response,
			body: {
				...response.body,
				sources: response.body.sources.map((source) => {
					return this.mapLocation({ source }).source;
				}),
			},
		};
	}

	private mapScopesResponse(response: DebugProtocol.ScopesResponse): DebugProtocol.ScopesResponse {
		return {
			...response,
			body: {
				...response.body,
				scopes: response.body.scopes.map((scope) => {
					return this.mapLocation(scope);
				}),
			},
		};
	}

	private mapSetBreakpointsResponse(response: DebugProtocol.SetBreakpointsResponse): DebugProtocol.SetBreakpointsResponse {
		return {
			...response,
			body: {
				...response.body,
				breakpoints: response.body.breakpoints.map((breakpoint) => {
					return this.mapLocation(breakpoint);
				}),
			},
		};
	}

	private mapSetFunctionBreakpointsResponse(response: DebugProtocol.SetFunctionBreakpointsResponse): DebugProtocol.SetFunctionBreakpointsResponse {
		return {
			...response,
			body: {
				...response.body,
				breakpoints: response.body.breakpoints.map((breakpoint) => {
					return this.mapLocation(breakpoint);
				}),
			},
		};
	}

	private mapStackTraceResponse(response: DebugProtocol.StackTraceResponse): DebugProtocol.StackTraceResponse {
		return {
			...response,
			body: {
				...response.body,
				stackFrames: response.body.stackFrames.map((frame) => {
					return this.mapLocation(frame);
				}),
			},
		};
	}
}

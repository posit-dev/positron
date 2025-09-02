/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DebugProtocol } from '@vscode/debugprotocol';
import { LogOutputChannel } from 'vscode';

export function formatDebugMessage(message: DebugProtocol.ProtocolMessage): string {
	switch (message.type) {
		case 'request': {
			const request = message as DebugProtocol.Request;
			return `${request.command} #${request.seq}: ${JSON.stringify(request.arguments)}`;
		}
		case 'event': {
			const event = message as DebugProtocol.Event;
			return `${event.event}: ${JSON.stringify(event.body)}`;
		}
		case 'response': {
			const response = message as DebugProtocol.Response;
			return `${response.command} #${response.request_seq}: ${JSON.stringify(response.body)}`;
		}
		default: {
			return `[${message.type}]: ${JSON.stringify(message)}`;
		}
	}
}

/**
 * Type map for Debug Adapter Protocol messages based on their 'type' field
 */
interface DebugMessageTypeMap {
	'request': DebugProtocol.Request;
	'response': DebugProtocol.Response;
	'event': DebugProtocol.Event;
}

interface DebugRequestTypeMap {
	'initialize': DebugProtocol.InitializeRequest;
	'setBreakpoints': DebugProtocol.SetBreakpointsRequest;
	// Add request types as needed...
}

interface DebugResponseTypeMap {
	'configurationDone': DebugProtocol.ConfigurationDoneResponse;
	// Add response types as needed...
}

/**
 * Assertion function that validates a Debug Adapter Protocol message matches the expected type.
 * Throws an error if validation fails, otherwise narrows the type.
 *
 * @param obj The object to validate
 * @param expectedType The expected message type ('request', 'response', or 'event')
 * @param context Optional context string for the error message
 * @throws Error if the object is not a valid debug protocol message of the expected type
 */
export function assertDebugMessage<T extends keyof DebugMessageTypeMap>(
	obj: unknown,
	log: LogOutputChannel,
	context?: string,
	expectedType?: T,
): asserts obj is DebugMessageTypeMap[T] {
	const prefix = context ? `${context}: ` : '';

	// Check basic object structure
	if (typeof obj !== 'object' || obj === null) {
		throw new Error(`${prefix}Invalid debug ${expectedType} - not an object: ${JSON.stringify(obj)}`);
	}

	const msg = obj as Record<string, any>;

	// All messages must have type
	if (typeof msg.type !== 'string') {
		throw new Error(`${prefix}Invalid debug ${expectedType} - no type: ${JSON.stringify(obj)}`);
	}

	// If a specific type is expected, check for it
	if (expectedType && msg.type !== expectedType) {
		throw new Error(`${prefix}Invalid debug ${expectedType} - wrong type: ${JSON.stringify(obj)}`);
	}

	// All messages must have sequence number
	// NOTE: The ipykernel debugger currently doesn't always include a sequence number,
	// but that doesn't seem to cause any bugs, so log at debug level instead of throwing.
	if (typeof msg.seq !== 'number') {
		log.debug(`${prefix}Invalid debug ${expectedType} - wrong type or missing seq: ${JSON.stringify(obj)}`);
	}

	// Validate type-specific required fields
	if (
		(expectedType === 'request' && typeof msg.command !== 'string') ||
		(expectedType === 'response' &&
			(typeof msg.request_seq !== 'number' ||
				typeof msg.success !== 'boolean' ||
				typeof msg.command !== 'string')) ||
		(expectedType === 'event' && typeof msg.event !== 'string')
	) {
		throw new Error(`${prefix}Invalid debug ${expectedType} - missing required fields: ${JSON.stringify(obj)}`);
	}
}

export function isDebugRequest<T extends keyof DebugRequestTypeMap>(
	request: DebugProtocol.ProtocolMessage,
	expectedCommand: T,
): request is DebugRequestTypeMap[T] {
	return request.type === 'request' && (request as DebugProtocol.Request).command === expectedCommand;
}

export function isDebugResponse<T extends keyof DebugResponseTypeMap>(
	request: DebugProtocol.ProtocolMessage,
	expectedCommand: T,
): request is DebugResponseTypeMap[T] {
	return request.type === 'response' && (request as DebugProtocol.Response).command === expectedCommand;
}

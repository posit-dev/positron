/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Usage telemetry for the Positron MCP server, fed from the same audit stream
 * that drives the log channel and the status UI. Counters only: tool names,
 * client names, outcomes, and duration buckets -- never arguments, code,
 * paths, or results. The content-carrying record is the local audit log.
 */

import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { McpAuditEvent } from './positronMcpAudit.js';

type McpToolCallEvent = {
	toolName: string;
	clientName: string;
	outcome: string;
	durationBucket: string;
};

type McpToolCallClassification = {
	owner: 'positron';
	comment: 'Counts Positron MCP tool calls to measure which tools and agents are used; arguments and results are never captured.';
	toolName: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Name of the MCP tool that was called (fixed set advertised by the server).' };
	clientName: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Self-reported MCP client name (e.g. claude-code), or unknown.' };
	outcome: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the call succeeded (ok) or returned a tool error (error).' };
	durationBucket: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Coarse duration bucket for the call.' };
};

type McpSessionEvent = {
	kind: string;
	clientName: string;
};

type McpSessionClassification = {
	owner: 'positron';
	comment: 'Counts Positron MCP session lifecycle events to measure how many agents connect and how sessions end.';
	kind: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Lifecycle kind: session-created, session-resumed, session-closed, or client-identified.' };
	clientName: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Self-reported MCP client name (e.g. claude-code), or unknown.' };
};

/** Coarse duration bucket, keeping the events countable rather than continuous. */
export function durationBucket(durationMs: number): string {
	if (durationMs < 100) { return '<100ms'; }
	if (durationMs < 1000) { return '100ms-1s'; }
	if (durationMs < 10_000) { return '1s-10s'; }
	if (durationMs < 60_000) { return '10s-60s'; }
	return '>60s';
}

/**
 * Report an audit event as usage telemetry. Completed tool calls and session
 * lifecycle events are counted; transient start events and window re-pins are
 * not. Safe to call for every event the audit sink sees.
 */
export function reportMcpTelemetry(telemetryService: ITelemetryService, event: McpAuditEvent): void {
	switch (event.type) {
		case 'tool-call':
			telemetryService.publicLog2<McpToolCallEvent, McpToolCallClassification>('positronMcp.toolCall', {
				toolName: event.toolName,
				clientName: event.clientName ?? 'unknown',
				outcome: event.outcome,
				durationBucket: durationBucket(event.durationMs),
			});
			break;
		case 'session-created':
		case 'session-resumed':
		case 'session-closed':
		case 'client-identified':
			telemetryService.publicLog2<McpSessionEvent, McpSessionClassification>('positronMcp.session', {
				kind: event.type,
				clientName: event.clientName ?? 'unknown',
			});
			break;
	}
}

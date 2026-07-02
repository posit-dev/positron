/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ITelemetryService } from '../../../telemetry/common/telemetry.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { McpAuditEvent } from '../../common/positronMcpAudit.js';
import { durationBucket, reportMcpTelemetry } from '../../common/positronMcpTelemetry.js';

describe('positronMcpTelemetry', () => {
	function telemetryStub() {
		const publicLog2 = vi.fn();
		return { service: stubInterface<ITelemetryService>({ publicLog2 }), publicLog2 };
	}

	it('durationBucket maps durations to coarse buckets', () => {
		expect([0, 99, 100, 999, 1000, 9999, 10_000, 59_999, 60_000].map(durationBucket)).toEqual([
			'<100ms', '<100ms', '100ms-1s', '100ms-1s', '1s-10s', '1s-10s', '10s-60s', '10s-60s', '>60s',
		]);
	});

	it('reports a completed tool call as counters only (no args or result)', () => {
		const { service, publicLog2 } = telemetryStub();
		reportMcpTelemetry(service, {
			type: 'tool-call',
			callId: 'c1',
			timestamp: 1,
			sessionId: 's1',
			clientName: 'claude-code',
			clientVersion: '1.2.3',
			toolName: 'execute-code',
			argsSummary: '{code: "print(secret)"}',
			outcome: 'ok',
			durationMs: 840,
			resultSummary: 'text(12 chars)',
		});
		expect(publicLog2).toHaveBeenCalledExactlyOnceWith('positronMcp.toolCall', {
			toolName: 'execute-code',
			clientName: 'claude-code',
			outcome: 'ok',
			durationBucket: '100ms-1s',
		});
	});

	it('reports session lifecycle events, defaulting an anonymous client to unknown', () => {
		const { service, publicLog2 } = telemetryStub();
		reportMcpTelemetry(service, { type: 'session-resumed', timestamp: 1, sessionId: 's1' });
		reportMcpTelemetry(service, { type: 'client-identified', timestamp: 2, sessionId: 's1', clientName: 'codex-mcp-client' });
		expect(publicLog2.mock.calls).toEqual([
			['positronMcp.session', { kind: 'session-resumed', clientName: 'unknown' }],
			['positronMcp.session', { kind: 'client-identified', clientName: 'codex-mcp-client' }],
		]);
	});

	it('ignores transient start events and window re-pins', () => {
		const { service, publicLog2 } = telemetryStub();
		const events: McpAuditEvent[] = [
			{ type: 'tool-call-start', callId: 'c1', timestamp: 1, sessionId: 's1', toolName: 'get-plot' },
			{ type: 'window-repinned', timestamp: 2, sessionId: 's1', pinnedWindowId: 2 },
		];
		events.forEach(event => reportMcpTelemetry(service, event));
		expect(publicLog2).not.toHaveBeenCalled();
	});
});

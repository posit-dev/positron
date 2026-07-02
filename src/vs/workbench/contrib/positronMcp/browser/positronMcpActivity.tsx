/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronMcpActivity.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { getActiveWindow } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { localize } from '../../../../nls.js';
import { IMcpSessionInfo, mcpClientDisplayName } from '../../../../platform/positronMcp/common/positronMcp.js';
import { IMcpLifecycleAuditEvent, IMcpToolCallAuditEvent, IMcpToolCallStartEvent, McpAuditEvent } from '../../../../platform/positronMcp/common/positronMcpAudit.js';
import { IMcpActivityState, PositronMcpActivityFeed } from './positronMcpActivityFeed.js';
import { formatRelativeTime } from './positronMcpStatusModal.js';

/** How often the pane refreshes its relative timestamps. */
const TIME_TICK_MS = 5000;

/** The outcome filter states, cycled by the filter bar chips. */
export type McpOutcomeFilter = 'all' | 'ok' | 'error';

/** Display label for an event's client: mapped name, or the anonymous fallback. */
function clientDisplay(clientName?: string, clientVersion?: string): string {
	if (!clientName) {
		// Matches the console's attribution label for unidentified agents.
		return localize('positron.mcp.activity.externalAgent', "External Agent");
	}
	const name = mcpClientDisplayName(clientName);
	return clientVersion ? `${name} ${clientVersion}` : name;
}

/** The inline feed line for a session-lifecycle event. */
export function lifecycleLabel(event: IMcpLifecycleAuditEvent): string {
	const client = clientDisplay(event.clientName, event.clientVersion);
	switch (event.type) {
		case 'session-created':
			return localize('positron.mcp.activity.sessionCreated', "Agent session created");
		case 'session-resumed':
			return localize('positron.mcp.activity.sessionResumed', "Agent session resumed");
		case 'session-closed':
			return localize('positron.mcp.activity.sessionClosed', "{0} disconnected", client);
		case 'client-identified':
			return localize('positron.mcp.activity.clientIdentified', "{0} connected", client);
		case 'window-repinned':
			return event.pinnedWindowId !== undefined
				? localize('positron.mcp.activity.windowRepinned', "Re-pinned to window {0}", event.pinnedWindowId)
				: localize('positron.mcp.activity.windowUnpinned', "Pinned window closed");
	}
}

const lifecycleIcon: Record<IMcpLifecycleAuditEvent['type'], string> = {
	'session-created': 'codicon-plug',
	'session-resumed': 'codicon-plug',
	'client-identified': 'codicon-plug',
	'session-closed': 'codicon-debug-disconnect',
	'window-repinned': 'codicon-window',
};

/**
 * Whether an event survives the filter bar. Text matches the tool name and the
 * client identity (raw and display forms); the outcome chips narrow to
 * successes or failures, hiding lifecycle rows (which have no outcome).
 */
export function matchesFilter(event: McpAuditEvent, filterText: string, outcome: McpOutcomeFilter): boolean {
	if (outcome !== 'all' && (event.type !== 'tool-call' || event.outcome !== outcome)) {
		return false;
	}
	const text = filterText.trim().toLowerCase();
	if (text.length === 0) {
		return true;
	}
	const haystack = [
		event.type === 'tool-call' || event.type === 'tool-call-start' ? event.toolName : lifecycleLabel(event),
		event.clientName ?? '',
		clientDisplay(event.clientName, 'clientVersion' in event ? event.clientVersion : undefined),
	].join(' ').toLowerCase();
	return haystack.includes(text);
}

interface PositronMcpActivityProps {
	readonly feed: PositronMcpActivityFeed;
}

/**
 * The MCP activity pane body: a connections header, the allow-all consent
 * banner, a filter bar, and the live feed of tool calls (including in-flight
 * spinners) and session-lifecycle events, newest first. Tool-call rows expand
 * on click to the full argument/result summaries -- never full arguments or
 * result contents, the same privacy line as the audit log.
 */
export const PositronMcpActivity = (props: PositronMcpActivityProps) => {
	const { feed } = props;
	const [state, setState] = useState<IMcpActivityState>(feed.state);
	const [now, setNow] = useState(Date.now());
	const [filterText, setFilterText] = useState('');
	const [outcomeFilter, setOutcomeFilter] = useState<McpOutcomeFilter>('all');

	useEffect(() => {
		const disposable = feed.onDidChange(() => setState(feed.state));
		return () => disposable.dispose();
	}, [feed]);

	// Keep the relative timestamps moving while the pane is mounted.
	useEffect(() => {
		const targetWindow = getActiveWindow();
		const interval = targetWindow.setInterval(() => setNow(Date.now()), TIME_TICK_MS);
		return () => targetWindow.clearInterval(interval);
	}, []);

	const textFilter = filterText.trim().toLowerCase();
	const inFlight = state.inFlight.filter(call => matchesFilter(call, textFilter, 'all'));
	// Newest first; in-flight rows render above these.
	const events = state.events.filter(event => matchesFilter(event, textFilter, outcomeFilter)).slice().reverse();
	const hasAnyActivity = state.events.length > 0 || state.inFlight.length > 0;

	return (
		<div className='positron-mcp-activity'>
			<ConnectionsHeader now={now} running={state.running} sessions={state.sessions} />
			{state.allowAll &&
				<div className='consent-banner'>
					<span className='codicon codicon-warning' />
					<span className='consent-text'>{localize('positron.mcp.activity.consent.allowAll', "All agent code execution is allowed for this session.")}</span>
					<Button className='button row-action' onPressed={() => feed.resetConsent()}>
						{localize('positron.mcp.activity.consent.reset', "Reset")}
					</Button>
				</div>}
			<FilterBar filterText={filterText} outcomeFilter={outcomeFilter} onFilterTextChanged={setFilterText} onOutcomeFilterChanged={setOutcomeFilter} />
			<div className='activity-feed'>
				{inFlight.map(call => <InFlightRow key={call.callId} call={call} now={now} />)}
				{events.map((event, index) => event.type === 'tool-call'
					? <ToolCallRow key={event.callId} call={event} now={now} />
					: event.type === 'tool-call-start'
						? null
						: <LifecycleRow key={`${event.type}-${event.timestamp}-${index}`} event={event} now={now} />)}
				{inFlight.length === 0 && events.length === 0 &&
					<p className='feed-empty'>
						{hasAnyActivity
							? localize('positron.mcp.activity.emptyFiltered', "No activity matches the filter.")
							: localize('positron.mcp.activity.empty', "No MCP activity yet. Tool calls from connected agents will appear here.")}
					</p>}
			</div>
		</div>
	);
};

/**
 * The live sessions header: one line per connected agent with its identity,
 * connection age, and last activity. The window tag appears only when the
 * sessions span more than one Positron window.
 */
const ConnectionsHeader = (props: { sessions: readonly IMcpSessionInfo[]; running: boolean; now: number }) => {
	const { sessions, running, now } = props;

	if (sessions.length === 0) {
		return (
			<div className='connections-header'>
				<p className='connections-empty'>
					{running
						? localize('positron.mcp.activity.noAgents', "No agents connected.")
						: localize('positron.mcp.activity.notRunning', "MCP server is not running. Restart Positron to start it.")}
				</p>
			</div>
		);
	}

	const showWindow = new Set(sessions.map(s => s.pinnedWindowId)).size > 1;
	return (
		<div className='connections-header'>
			{sessions.map(session => (
				<div key={session.sessionId} className='connection-row'>
					<span className='connection-dot' />
					<span className='connection-client'>{clientDisplay(session.clientName, session.clientVersion)}</span>
					<span className='connection-meta'>
						{localize('positron.mcp.activity.connectedSince', "connected {0}", formatRelativeTime(session.createdAt, now))}
						{' · '}
						{localize('positron.mcp.activity.lastActivity', "active {0}", formatRelativeTime(session.lastActivityAt, now))}
						{showWindow && session.pinnedWindowId !== undefined &&
							` · ${localize('positron.mcp.activity.window', "window {0}", session.pinnedWindowId)}`}
					</span>
				</div>
			))}
		</div>
	);
};

/** The filter bar: a free-text filter plus outcome chips (All / OK / Errors). */
const FilterBar = (props: {
	filterText: string;
	outcomeFilter: McpOutcomeFilter;
	onFilterTextChanged: (value: string) => void;
	onOutcomeFilterChanged: (value: McpOutcomeFilter) => void;
}) => {
	const chips: { readonly value: McpOutcomeFilter; readonly label: string }[] = [
		{ value: 'all', label: localize('positron.mcp.activity.filter.all', "All") },
		{ value: 'ok', label: localize('positron.mcp.activity.filter.ok', "OK") },
		{ value: 'error', label: localize('positron.mcp.activity.filter.errors', "Errors") },
	];
	return (
		<div className='filter-bar'>
			<input
				aria-label={localize('positron.mcp.activity.filter.ariaLabel', "Filter MCP activity")}
				className='filter-input'
				placeholder={localize('positron.mcp.activity.filter.placeholder', "Filter by tool or agent")}
				type='text'
				value={props.filterText}
				onChange={e => props.onFilterTextChanged(e.target.value)}
			/>
			<div className='outcome-chips'>
				{chips.map(chip => (
					<Button
						key={chip.value}
						className={`button outcome-chip${chip.value === props.outcomeFilter ? ' selected' : ''}`}
						onPressed={() => props.onOutcomeFilterChanged(chip.value)}
					>
						{chip.label}
					</Button>
				))}
			</div>
		</div>
	);
};

/** A currently-running tool call: spinner, tool, agent, elapsed time. */
const InFlightRow = (props: { call: IMcpToolCallStartEvent; now: number }) => {
	const { call, now } = props;
	const elapsedSeconds = Math.max(0, Math.round((now - call.timestamp) / 1000));
	return (
		<div className='activity-row in-flight'>
			<span className='activity-outcome codicon codicon-loading codicon-modifier-spin' />
			<span className='activity-tool'>{call.toolName}</span>
			<span className='activity-client'>{clientDisplay(call.clientName)}</span>
			<span className='activity-meta'>{localize('positron.mcp.activity.running', "running {0}s", elapsedSeconds)}</span>
		</div>
	);
};

/**
 * One completed tool call. Clicking toggles the detail block: the argument and
 * result summaries, timing, and session identity from the audit event.
 */
const ToolCallRow = (props: { call: IMcpToolCallAuditEvent; now: number }) => {
	const { call, now } = props;
	const [expanded, setExpanded] = useState(false);

	return (
		<div className='activity-entry'>
			<button
				aria-expanded={expanded}
				className={`activity-row expandable${call.outcome === 'error' ? ' error' : ''}`}
				onClick={() => setExpanded(!expanded)}
			>
				<span className={`activity-outcome codicon ${call.outcome === 'ok' ? 'codicon-pass-filled' : 'codicon-error'}`} />
				<span className='activity-tool'>{call.toolName}</span>
				<span className='activity-client'>{clientDisplay(call.clientName, call.clientVersion)}</span>
				<span className='activity-meta'>
					{localize('positron.mcp.activity.duration', "{0}ms", call.durationMs)}
					{' · '}
					{formatRelativeTime(call.timestamp, now)}
				</span>
			</button>
			{expanded &&
				<div className='activity-detail'>
					<DetailField label={localize('positron.mcp.activity.detail.args', "Arguments")} value={call.argsSummary} />
					<DetailField label={localize('positron.mcp.activity.detail.result', "Result")} value={call.resultSummary} />
					<DetailField label={localize('positron.mcp.activity.detail.outcome', "Outcome")} value={call.outcome} />
					<DetailField label={localize('positron.mcp.activity.detail.time', "Time")} value={new Date(call.timestamp).toLocaleTimeString()} />
					<DetailField label={localize('positron.mcp.activity.detail.session', "Session")} value={call.sessionId} />
					{call.pinnedWindowId !== undefined &&
						<DetailField label={localize('positron.mcp.activity.detail.window', "Window")} value={String(call.pinnedWindowId)} />}
				</div>}
		</div>
	);
};

const DetailField = (props: { label: string; value: string }) => (
	<div className='detail-field'>
		<span className='detail-label'>{props.label}</span>
		<span className='detail-value'>{props.value}</span>
	</div>
);

/** A session-lifecycle marker rendered inline in the feed, dimmed. */
const LifecycleRow = (props: { event: IMcpLifecycleAuditEvent; now: number }) => {
	const { event, now } = props;
	return (
		<div className='activity-row lifecycle'>
			<span className={`activity-outcome codicon ${lifecycleIcon[event.type]}`} />
			<span className='activity-lifecycle-label'>{lifecycleLabel(event)}</span>
			<span className='activity-meta'>{formatRelativeTime(event.timestamp, now)}</span>
		</div>
	);
};

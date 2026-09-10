/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Event schema shared by every layer that emits console-execution timing.
 *
 * Five processes emit events: the Playwright harness, the Electron renderer, the
 * extension host (`positron-supervisor` and `positron-r`), and Ark. Each writes
 * `TraceEvent` records as JSONL; the analysis tool joins them.
 *
 * Correlation rides on identifiers the protocols already carry rather than a new
 * wire field, so no layer's message format changes and Kallichore needs no
 * modification. The chain is:
 *
 *   sample_id      harness, set on the renderer at arm time
 *   submission_id  renderer, one per Enter
 *   execution_id   renderer -> extension host, Positron's own execution id
 *   jupyter_msg_id extension host -> Ark, and Ark's IOPub `parent_msg_id`
 *   lsp_request_id positron-r -> Ark, for the input-boundary hop
 *
 * Each layer logs the identifier it hands to the next, so the analysis can walk
 * the chain without correlating by expression text (the same expression repeats
 * across samples).
 *
 * Clocks: `t_mono_us` is process-local and only ever subtracted within one
 * process. `t_wall_us` places events on a common timeline. Every process emits
 * `clock.pair` at trace start and end, reading both clocks back to back, so the
 * analysis can convert monotonic to wall with a measured offset and report the
 * residual drift as uncertainty rather than hiding it.
 */

export const TRACE_SCHEMA_VERSION = 1;

/** Which process emitted an event. Determines which clock origin applies. */
export type TraceProc = 'harness' | 'renderer' | 'exthost' | 'ark';

/**
 * Identifiers carried by an event. Every field is optional: a layer records only
 * the identifiers it actually has, and the analysis flags a broken chain rather
 * than guessing across a gap.
 */
export type TraceIds = {
	sample_id?: string;
	submission_id?: string;
	execution_id?: string;
	jupyter_msg_id?: string;
	parent_msg_id?: string;
	lsp_request_id?: string | number;
};

/**
 * One timing checkpoint.
 *
 * `attrs` carries metadata only, never output bodies or source text: a timing
 * log that contains the console output is both large enough to perturb the
 * measurement and unusable as an artifact.
 */
export type TraceEvent = {
	v: number;
	run_id: string;
	proc: TraceProc;
	pid: number;
	/** Emitting thread where a process has more than one that matters (Ark). */
	thread?: string;
	name: string;
	t_mono_us: number;
	t_wall_us: number;
	ids?: TraceIds;
	attrs?: Record<string, string | number | boolean | null>;
};

/**
 * Event names, grouped by emitting layer.
 *
 * The catalogue for harness call sites and for `STAGES` below. Product and
 * extension call sites spell the same names as literals, since `src/vs` and the
 * extensions cannot import from `test/`, so this file is the reference for them
 * rather than the definition. `analyze.mts` reports any name in `STAGES` that no
 * sample carries, which is what catches a literal that drifted from this list.
 *
 * A `.start`/`.end` pair brackets an interval measured in one process; a bare
 * name is an instant.
 */
export const TraceName = {
	clockPair: 'clock.pair',

	harness: {
		sampleStart: 'harness.sample.start',
		armStart: 'harness.arm.start',
		armEnd: 'harness.arm.end',
		enterPressStart: 'harness.enter.press.start',
		enterPressEnd: 'harness.enter.press.end',
		outputAssertStart: 'harness.output.assert.start',
		outputAssertEnd: 'harness.output.assert.end',
		textRetrieveStart: 'harness.text.retrieve.start',
		textRetrieveEnd: 'harness.text.retrieve.end',
		focusStart: 'harness.focus.start',
		focusEnd: 'harness.focus.end',
		promptAssertStart: 'harness.prompt.assert.start',
		promptAssertEnd: 'harness.prompt.assert.end',
		sampleEnd: 'harness.sample.end',
		drainStart: 'harness.drain.start',
		drainEnd: 'harness.drain.end',
	},

	renderer: {
		enterKeydown: 'renderer.enter.keydown',
		enterHandler: 'renderer.enter.handler',
		submitEntry: 'renderer.submit.entry',
		submitFlow: 'renderer.submit.flow',
		boundariesRequest: 'renderer.boundaries.request',
		boundariesResponse: 'renderer.boundaries.response',
		executeDispatch: 'renderer.execute.dispatch',
		executeProxySend: 'renderer.execute.proxy_send',
		provisionalInputEcho: 'renderer.provisional_input.echo',
		runtimeMessageOutput: 'renderer.runtime.msg.output',
		runtimeMessageState: 'renderer.runtime.msg.state',
		modelUpdate: 'renderer.model.update',
		/**
		 * The runtime-items emitter coalesced a fire. Above 20 fires in a
		 * rolling 50ms window it defers delivery by 50ms, which delays the
		 * React re-render and so the appearance of output in the DOM.
		 */
		itemsEmitterThrottled: 'renderer.items_emitter.throttled',
		itemsEmitterDelivered: 'renderer.items_emitter.delivered',
		/**
		 * A runtime event arrived out of Lamport-clock sequence, so the whole
		 * queue -- output included -- waits up to 250ms for the missing
		 * predecessor.
		 */
		eventQueueDefer: 'renderer.event_queue.defer',
		eventQueueProcess: 'renderer.event_queue.process',
		stateReady: 'renderer.state.ready',
		/**
		 * A main-thread block reported by `PerformanceObserver`. Without this a
		 * stalled renderer shows up only as an absence of events, which cannot
		 * be told apart from an idle one.
		 */
		longTask: 'renderer.longtask',
		domOutput: 'renderer.dom.output',
		domReady: 'renderer.dom.ready',
		/**
		 * Every keydown while a sample is armed, tagged with the key and its
		 * modifiers. The focus chord (`Cmd+K F`) is otherwise invisible on this
		 * timeline: nothing marks when the renderer actually receives it.
		 */
		keydownAny: 'renderer.keydown.any',
		/**
		 * Brackets `FocusConsole`'s command handler. Separates a cost inside it
		 * (e.g. `openView` activating something on first focus) from a cost
		 * upstream of it, between the harness's keypress and the handler running.
		 */
		focusConsoleStart: 'renderer.focus_console.start',
		focusConsoleEnd: 'renderer.focus_console.end',
	},

	exthost: {
		supervisorExecuteEntry: 'exthost.supervisor.execute.entry',
		supervisorCompletenessStart: 'exthost.supervisor.completeness.start',
		supervisorCompletenessEnd: 'exthost.supervisor.completeness.end',
		supervisorBarrierWaitStart: 'exthost.supervisor.barrier.wait.start',
		supervisorBarrierWaitEnd: 'exthost.supervisor.barrier.wait.end',
		supervisorMessageBuild: 'exthost.supervisor.msg.build',
		supervisorSocketSend: 'exthost.supervisor.socket.send',
		supervisorIopubReceive: 'exthost.supervisor.iopub.recv',
		supervisorPendingResolve: 'exthost.supervisor.pending.resolve',
		supervisorEventEmit: 'exthost.supervisor.event.emit',
		rBoundariesProviderEntry: 'exthost.r.boundaries.provider.entry',
		/**
		 * LSP client lifecycle. The `starting` to `running` handshake runs
		 * inside the measured interval on the first R submission, because the
		 * harness's focus chord makes R the foreground session and that starts
		 * the LSP.
		 */
		rLspClientStarting: 'exthost.r.lsp.client.starting',
		rLspClientRunning: 'exthost.r.lsp.client.running',
		rLspSend: 'exthost.r.lsp.send',
		rLspResponse: 'exthost.r.lsp.response',
	},

	ark: {
		shellReceive: 'ark.shell.recv',
		executeEnqueue: 'ark.execute.enqueue',
		executePickup: 'ark.execute.pickup',
		executeEvalStart: 'ark.execute.eval.start',
		executeEvalEnd: 'ark.execute.eval.end',
		executeReplySend: 'ark.execute.reply.send',
		iopubEnqueue: 'ark.iopub.enqueue',
		/**
		 * The IOPub thread handed the message to the outbound channel. A third
		 * thread performs the zmq write, so this is neither the enqueue nor the
		 * transmission.
		 */
		iopubForward: 'ark.iopub.forward',
		iopubSocketSend: 'ark.iopub.socket.send',
		/**
		 * Stream output is held in a buffer flushed on an 80ms tick, so stdout
		 * carries a delay that has nothing to do with evaluation time.
		 */
		iopubStreamBufferFlush: 'ark.iopub.stream_buffer.flush',
		/**
		 * Top-level autoprint output is accumulated to ride on the execute
		 * reply instead of going out over IOPub, which is why a bare expression
		 * and a `cat()` call reach the frontend by different routes.
		 */
		autoprintBuffered: 'ark.autoprint.buffered',
		lspBoundariesIngress: 'ark.lsp.boundaries.ingress',
		lspBoundariesHandler: 'ark.lsp.boundaries.handler',
		lspRtaskEnqueue: 'ark.lsp.rtask.enqueue',
		/**
		 * Fires for every sync R task, because a queued task carries no origin.
		 * The boundary stage below therefore assumes the first pickup after its
		 * enqueue is the one it wants.
		 */
		rtaskPickup: 'ark.rtask.pickup',
		/**
		 * Paired with the pickup above. Without it a quiet stretch in the
		 * timeline cannot be distinguished from an idle R thread.
		 */
		rtaskComplete: 'ark.rtask.complete',
		lspParseDone: 'ark.lsp.parse.done',
		lspBoundariesResponse: 'ark.lsp.boundaries.response',
		/**
		 * LSP server startup. Every other `ark.lsp.*` marker covers input
		 * boundaries or the synthetic write, so startup was entirely unmeasured
		 * despite being the current leading suspect.
		 */
		lspServerStart: 'ark.lsp.server.start',
		lspInitializeRequest: 'ark.lsp.initialize.request',
		lspInitializeHandler: 'ark.lsp.initialize.handler',
		lspInitializeResponse: 'ark.lsp.initialize.response',
		lspInitialized: 'ark.lsp.initialized',
		lspIndexWarmStart: 'ark.lsp.index.warm.start',
		lspIndexWarmEnd: 'ark.lsp.index.warm.end',
		lspSyntheticWriteStart: 'ark.lsp.synthetic_write.start',
		lspSyntheticWriteEnd: 'ark.lsp.synthetic_write.end',
		completeShellReceive: 'ark.complete.shell.recv',
		completeRtaskPickup: 'ark.complete.rtask.pickup',
		completeParseDone: 'ark.complete.parse.done',
		completeReplySend: 'ark.complete.reply.send',
	},
} as const;

/**
 * Stage definitions the analysis tool turns into a duration table.
 *
 * `same_process` stages are subtracted from monotonic clocks and are exact.
 * Cross-process stages are subtracted from wall clocks and inherit the
 * clock-alignment uncertainty, which the report states alongside the value.
 */
export type StageSpec = {
	stage: string;
	from: string;
	to: string;
	same_process: boolean;
};

export const STAGES: readonly StageSpec[] = [
	// Harness-visible intervals. These reproduce the shape of the existing
	// metric, so a change in the metric can be attributed to one of its parts.
	{ stage: 'harness.enter_press', from: TraceName.harness.enterPressStart, to: TraceName.harness.enterPressEnd, same_process: true },
	{ stage: 'harness.output_assert', from: TraceName.harness.outputAssertStart, to: TraceName.harness.outputAssertEnd, same_process: true },
	{ stage: 'harness.text_retrieve', from: TraceName.harness.textRetrieveStart, to: TraceName.harness.textRetrieveEnd, same_process: true },
	{ stage: 'harness.focus', from: TraceName.harness.focusStart, to: TraceName.harness.focusEnd, same_process: true },
	{ stage: 'harness.prompt_assert', from: TraceName.harness.promptAssertStart, to: TraceName.harness.promptAssertEnd, same_process: true },
	{ stage: 'harness.total', from: TraceName.harness.sampleStart, to: TraceName.harness.sampleEnd, same_process: true },

	// Browser DOM readiness, all on one clock, so these are the reference
	// against which the harness intervals are judged.
	{ stage: 'dom.enter_to_output', from: TraceName.renderer.enterKeydown, to: TraceName.renderer.domOutput, same_process: true },
	{ stage: 'dom.enter_to_ready', from: TraceName.renderer.enterKeydown, to: TraceName.renderer.domReady, same_process: true },

	// Renderer submission path, one clock throughout.
	{ stage: 'renderer.keydown_to_submit', from: TraceName.renderer.enterKeydown, to: TraceName.renderer.submitEntry, same_process: true },
	{ stage: 'renderer.boundaries_roundtrip', from: TraceName.renderer.boundariesRequest, to: TraceName.renderer.boundariesResponse, same_process: true },
	{ stage: 'renderer.boundaries_to_dispatch', from: TraceName.renderer.boundariesResponse, to: TraceName.renderer.executeDispatch, same_process: true },
	{ stage: 'renderer.dispatch_to_first_output_msg', from: TraceName.renderer.executeDispatch, to: TraceName.renderer.runtimeMessageOutput, same_process: true },
	{ stage: 'renderer.output_msg_to_model', from: TraceName.renderer.runtimeMessageOutput, to: TraceName.renderer.modelUpdate, same_process: true },
	{ stage: 'renderer.model_to_dom', from: TraceName.renderer.modelUpdate, to: TraceName.renderer.domOutput, same_process: true },
	{ stage: 'renderer.output_msg_to_dom', from: TraceName.renderer.runtimeMessageOutput, to: TraceName.renderer.domOutput, same_process: true },
	{ stage: 'renderer.state_ready_to_dom_ready', from: TraceName.renderer.stateReady, to: TraceName.renderer.domReady, same_process: true },
	// Two renderer-side holds that would otherwise be misread as kernel or
	// transport latency. Both are bounded waits on a timer, not work.
	{ stage: 'renderer.event_queue_hold', from: TraceName.renderer.eventQueueDefer, to: TraceName.renderer.eventQueueProcess, same_process: true },
	{ stage: 'renderer.items_emitter_hold', from: TraceName.renderer.itemsEmitterThrottled, to: TraceName.renderer.itemsEmitterDelivered, same_process: true },
	{ stage: 'renderer.focus_console', from: TraceName.renderer.focusConsoleStart, to: TraceName.renderer.focusConsoleEnd, same_process: true },

	// The input-boundary hop, split across three processes. The enclosing
	// renderer round trip above stays reliable even where this subdivision does not.
	{ stage: 'boundaries.renderer_to_provider', from: TraceName.renderer.boundariesRequest, to: TraceName.exthost.rBoundariesProviderEntry, same_process: false },
	{ stage: 'boundaries.provider_to_lsp_send', from: TraceName.exthost.rBoundariesProviderEntry, to: TraceName.exthost.rLspSend, same_process: true },
	{ stage: 'boundaries.lsp_send_to_ark_ingress', from: TraceName.exthost.rLspSend, to: TraceName.ark.lspBoundariesIngress, same_process: false },
	{ stage: 'boundaries.ark_main_loop_wait', from: TraceName.ark.lspBoundariesIngress, to: TraceName.ark.lspBoundariesHandler, same_process: true },
	{ stage: 'boundaries.ark_rtask_wait', from: TraceName.ark.lspRtaskEnqueue, to: TraceName.ark.rtaskPickup, same_process: true },
	{ stage: 'boundaries.ark_parse', from: TraceName.ark.rtaskPickup, to: TraceName.ark.lspParseDone, same_process: true },
	{ stage: 'boundaries.ark_response_to_exthost', from: TraceName.ark.lspBoundariesResponse, to: TraceName.exthost.rLspResponse, same_process: false },

	// Execution dispatch through the supervisor and Kallichore. The relay is
	// bracketed, not instrumented: this interval includes transport and
	// scheduling as well as Kallichore's own work.
	// Spans the RPC, `$executeCode`, and the session lookup together. The
	// intermediate hop in `extHostLanguageRuntime` is not marked: the extension
	// host half of `src/vs` has no file sink, and adding one there would buy a
	// subdivision of an interval this already bounds.
	{ stage: 'execute.renderer_to_supervisor', from: TraceName.renderer.executeProxySend, to: TraceName.exthost.supervisorExecuteEntry, same_process: false },
	{ stage: 'execute.supervisor_barrier_wait', from: TraceName.exthost.supervisorBarrierWaitStart, to: TraceName.exthost.supervisorBarrierWaitEnd, same_process: true },
	{ stage: 'execute.supervisor_build_to_send', from: TraceName.exthost.supervisorMessageBuild, to: TraceName.exthost.supervisorSocketSend, same_process: true },
	{ stage: 'execute.relay_send_to_ark', from: TraceName.exthost.supervisorSocketSend, to: TraceName.ark.shellReceive, same_process: false },

	// Ark execution, all on Ark's clock.
	{ stage: 'ark.execute_queue_wait', from: TraceName.ark.executeEnqueue, to: TraceName.ark.executePickup, same_process: true },
	{ stage: 'ark.execute_eval', from: TraceName.ark.executeEvalStart, to: TraceName.ark.executeEvalEnd, same_process: true },
	{ stage: 'ark.iopub_enqueue_to_forward', from: TraceName.ark.iopubEnqueue, to: TraceName.ark.iopubForward, same_process: true },
	{ stage: 'ark.iopub_forward_to_send', from: TraceName.ark.iopubForward, to: TraceName.ark.iopubSocketSend, same_process: true },
	{ stage: 'ark.iopub_enqueue_to_send', from: TraceName.ark.iopubEnqueue, to: TraceName.ark.iopubSocketSend, same_process: true },
	// The 80ms stream-buffer tick sits between output being produced and being
	// transmitted, so it is measured on its own rather than folded into the
	// enqueue-to-send total.
	{ stage: 'ark.stream_buffer_hold', from: TraceName.ark.iopubEnqueue, to: TraceName.ark.iopubStreamBufferFlush, same_process: true },
	// The synthetic Salsa write blocks the LSP main loop until every
	// outstanding database reader drops, which is the mechanism #1315 introduced.
	{ stage: 'ark.synthetic_write_wait', from: TraceName.ark.lspSyntheticWriteStart, to: TraceName.ark.lspSyntheticWriteEnd, same_process: true },
	{ stage: 'ark.shell_recv_to_reply', from: TraceName.ark.shellReceive, to: TraceName.ark.executeReplySend, same_process: true },

	// The return leg. `ark.iopub.socket.send` is the real transmission, not the
	// enqueue, so this measures the relay rather than Ark's own queue.
	{ stage: 'return.ark_send_to_supervisor', from: TraceName.ark.iopubSocketSend, to: TraceName.exthost.supervisorIopubReceive, same_process: false },
	{ stage: 'return.supervisor_to_renderer', from: TraceName.exthost.supervisorEventEmit, to: TraceName.renderer.runtimeMessageOutput, same_process: false },

	// LSP startup, the current leading suspect. On the first R submission this
	// whole sequence runs inside the measured interval.
	{ stage: 'lsp_startup.ark_server_start_to_initialize', from: TraceName.ark.lspServerStart, to: TraceName.ark.lspInitializeRequest, same_process: true },
	{ stage: 'lsp_startup.ark_initialize', from: TraceName.ark.lspInitializeRequest, to: TraceName.ark.lspInitializeResponse, same_process: true },
	{ stage: 'lsp_startup.ark_initialize_queue_wait', from: TraceName.ark.lspInitializeRequest, to: TraceName.ark.lspInitializeHandler, same_process: true },
	{ stage: 'lsp_startup.ark_index_warm', from: TraceName.ark.lspIndexWarmStart, to: TraceName.ark.lspIndexWarmEnd, same_process: true },
	{ stage: 'lsp_startup.client_handshake', from: TraceName.exthost.rLspClientStarting, to: TraceName.exthost.rLspClientRunning, same_process: true },
	{ stage: 'lsp_startup.ark_start_to_client_running', from: TraceName.ark.lspServerStart, to: TraceName.exthost.rLspClientRunning, same_process: false },

	// A queued task carries no origin, so this pairs the first pickup with the
	// first completion and is flagged ambiguous whenever more than one ran.
	{ stage: 'ark.rtask_duration', from: TraceName.ark.rtaskPickup, to: TraceName.ark.rtaskComplete, same_process: true },

	// The gap the reassessment cares about: how much of the recorded metric is
	// the harness noticing a state change that already happened.
	{ stage: 'gap.dom_ready_to_harness_end', from: TraceName.renderer.domReady, to: TraceName.harness.sampleEnd, same_process: false },
] as const;

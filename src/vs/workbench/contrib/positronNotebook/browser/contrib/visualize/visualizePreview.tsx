/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { localize } from '../../../../../../nls.js';
import { URI } from '../../../../../../base/common/uri.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import {
	ILanguageRuntimeMessageError,
	ILanguageRuntimeMessageOutput,
	ILanguageRuntimeMessageResult,
	RuntimeCodeExecutionMode,
	RuntimeErrorBehavior,
} from '../../../../../services/languageRuntime/common/languageRuntimeService.js';
import { StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { VizLibrary } from './generateVizCode.js';

// Workspace-scoped key for the live preview on/off preference. Lives in
// IStorageService so flipping the toggle does not dirty the notebook file.
const LIVE_PREVIEW_STORAGE_KEY = 'positronNotebook.visualize.livePreview';

const DEBOUNCE_MS = 400;
const CLEANUP_TIMEOUT_MS = 15_000;

type PreviewState =
	| { status: 'idle' }
	| { status: 'disabled' }
	| { status: 'unsupported-library' }
	| { status: 'no-runtime' }
	| { status: 'needs-dfname' }
	| { status: 'loading' }
	| { status: 'success'; mime: 'text/html' | 'image/png' | 'image/svg+xml'; data: string }
	| { status: 'error'; message: string };

interface Props {
	/** The full Python snippet to execute. Pass empty string to clear. */
	code: string;
	/** The notebook's URI, used to find the runtime session. */
	notebookUri: URI;
	/**
	 * Library the user picked. Plotly emits an `application/vnd.plotly.v1+json`
	 * mime bundle that the simple iframe path here doesn't render, so we
	 * surface a clear "not supported" state instead of leaving the user on
	 * "Rendering preview..." until the cleanup timer fires.
	 */
	library: VizLibrary;
	/** True when the user has chosen columns but dfName is missing or invalid. */
	needsDfName?: boolean;
}

export function VisualizePreview({ code, notebookUri, library, needsDfName }: Props) {
	const services = usePositronReactServicesContext();
	const [state, setState] = useState<PreviewState>({ status: 'idle' });
	// Bumped when a runtime session for `notebookUri` becomes available, so
	// the main effect re-runs and we transition out of `no-runtime` instead
	// of staying stuck after a kernel attaches mid-dialog.
	const [sessionAttachTick, setSessionAttachTick] = useState(0);
	const latestExecIdRef = useRef<string>('');
	// Track the in-flight subscription store and its auto-dispose timer so
	// effect re-runs (rapid edits, code cleared) tear them down immediately
	// instead of waiting out the 15s grace period.
	const activeDisposablesRef = useRef<DisposableStore | null>(null);
	const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// Preference is persisted per-workspace via IStorageService so toggling
	// does not dirty the notebook file or require a contributed user setting.
	// Default: on.
	const [enabled, setEnabled] = useState(() =>
		services.storageService.getBoolean(LIVE_PREVIEW_STORAGE_KEY, StorageScope.WORKSPACE, true)
	);

	const toggleEnabled = () => {
		const next = !enabled;
		setEnabled(next);
		services.storageService.store(
			LIVE_PREVIEW_STORAGE_KEY,
			next,
			StorageScope.WORKSPACE,
			StorageTarget.USER,
		);
	};

	// While we don't have a runtime session attached, listen for one starting
	// against this notebookUri and bump a tick so the main effect re-evaluates.
	// Doing it in its own effect (rather than reaching into the main effect's
	// state) keeps the subscription scope independent of debounce/cleanup.
	useEffect(() => {
		const disposable = services.runtimeSessionService.onDidStartRuntime((session) => {
			if (session.metadata.notebookUri?.toString() === notebookUri.toString()) {
				setSessionAttachTick(t => t + 1);
			}
		});
		return () => disposable.dispose();
	}, [services.runtimeSessionService, notebookUri]);

	useEffect(() => {
		if (!enabled) {
			setState({ status: 'disabled' });
			return;
		}
		if (library === 'plotly') {
			// Plotly's renderer emits a non-HTML mime bundle that we don't
			// route through a webview yet. Bail out before scheduling the
			// kernel run -- the result wouldn't be displayable.
			setState({ status: 'unsupported-library' });
			return;
		}
		if (needsDfName) {
			setState({ status: 'needs-dfname' });
			return;
		}
		if (!code.trim()) {
			setState({ status: 'idle' });
			return;
		}

		const session = services.runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (!session) {
			setState({ status: 'no-runtime' });
			return;
		}

		const debounceTimer = setTimeout(() => {
			// Tear down any prior run that slipped through (e.g. the outer
			// cleanup hasn't fired yet) before starting a new one.
			activeDisposablesRef.current?.dispose();
			clearTimeout(cleanupTimerRef.current);

			const execId = `viz-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			latestExecIdRef.current = execId;
			setState({ status: 'loading' });

			const disposables = new DisposableStore();
			activeDisposablesRef.current = disposables;

			const matches = (msg: { parent_id: string }) =>
				msg.parent_id === execId && latestExecIdRef.current === execId;

			const handleDisplay = (msg: ILanguageRuntimeMessageOutput | ILanguageRuntimeMessageResult) => {
				if (!matches(msg)) { return; }
				const html = msg.data['text/html'];
				const png = msg.data['image/png'];
				const svg = msg.data['image/svg+xml'];
				if (html) {
					setState({ status: 'success', mime: 'text/html', data: html });
				} else if (svg) {
					setState({ status: 'success', mime: 'image/svg+xml', data: svg });
				} else if (png) {
					setState({ status: 'success', mime: 'image/png', data: png });
				} else {
					// A matching message arrived but carried no MIME we can render.
					// Without this terminal transition the preview would stay on
					// 'loading' until the cleanup timer fires.
					setState({
						status: 'error',
						message: localize('positron.notebook.visualize.preview.error.unsupportedMime', 'Preview format not supported.'),
					});
				}
			};

			disposables.add(session.onDidReceiveRuntimeMessageOutput(handleDisplay));
			disposables.add(session.onDidReceiveRuntimeMessageResult(handleDisplay));
			disposables.add(session.onDidReceiveRuntimeMessageError((msg: ILanguageRuntimeMessageError) => {
				if (!matches(msg)) { return; }
				const raw = msg.message || msg.name
					|| localize('positron.notebook.visualize.preview.error.fallback', 'Execution error');
				// Trim common Python traceback noise to the last meaningful line.
				const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
				const summary = lines[lines.length - 1] ?? raw;
				setState({ status: 'error', message: summary });
			}));

			// execute() now returns a promise that signals acceptance; handle
			// both a synchronous throw and an async rejection (e.g. RPC failure)
			// so the error surfaces and subscriptions are cleaned up.
			const handleExecuteError = (err: unknown) => {
				setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
				disposables.dispose();
			};
			try {
				Promise.resolve(session.execute(
					code,
					execId,
					RuntimeCodeExecutionMode.Silent,
					RuntimeErrorBehavior.Continue,
				)).catch(handleExecuteError);
			} catch (err) {
				handleExecuteError(err);
				return;
			}

			// Auto-dispose subscriptions after a generous timeout to catch
			// trailing messages that arrive after the success/error path
			// fires. `latestExecIdRef` still skips stale messages, so this
			// is belt-and-suspenders.
			cleanupTimerRef.current = setTimeout(() => {
				disposables.dispose();
				if (activeDisposablesRef.current === disposables) {
					activeDisposablesRef.current = null;
				}
			}, CLEANUP_TIMEOUT_MS);
		}, DEBOUNCE_MS);

		return () => {
			clearTimeout(debounceTimer);
			clearTimeout(cleanupTimerRef.current);
			activeDisposablesRef.current?.dispose();
			activeDisposablesRef.current = null;
			latestExecIdRef.current = '';
		};
	}, [code, notebookUri, services.runtimeSessionService, enabled, library, needsDfName, sessionAttachTick]);

	return (
		<div className='visualize-preview'>
			<div className='visualize-preview-header'>
				<span className='codicon codicon-graph' />
				<span className='visualize-preview-header-title'>
					{localize('positron.notebook.visualize.preview.header', 'Live preview')}
				</span>
				<button
					aria-checked={enabled}
					aria-label={localize('positron.notebook.visualize.preview.toggle.label', 'Toggle live preview')}
					className={`visualize-preview-toggle${enabled ? ' on' : ''}`}
					role='switch'
					title={enabled
						? localize('positron.notebook.visualize.preview.toggle.tooltipOn', 'Live preview is on. Click to turn off.')
						: localize('positron.notebook.visualize.preview.toggle.tooltipOff', 'Live preview is off. Click to turn on.')}
					type='button'
					onClick={toggleEnabled}
				>
					<span className='visualize-preview-toggle-track'>
						<span className='visualize-preview-toggle-thumb' />
					</span>
					<span className='visualize-preview-toggle-label'>
						{enabled
							? localize('positron.notebook.visualize.preview.toggle.on', 'On')
							: localize('positron.notebook.visualize.preview.toggle.off', 'Off')}
					</span>
				</button>
			</div>
			<div className='visualize-preview-body'>
				{renderBody(state, toggleEnabled)}
			</div>
		</div>
	);
}

function renderBody(state: PreviewState, onToggle: () => void) {
	switch (state.status) {
		case 'idle':
			return (
				<PreviewMessage
					hint={localize('positron.notebook.visualize.preview.idle.hint', 'Pick a library, chart type, and columns.')}
					icon='codicon-info'
					title={localize('positron.notebook.visualize.preview.idle.title', 'Nothing to preview yet')}
				/>
			);
		case 'disabled':
			return (
				<PreviewMessage
					action={{
						label: localize('positron.notebook.visualize.preview.disabled.action', 'Turn preview on'),
						onClick: onToggle,
					}}
					hint={localize('positron.notebook.visualize.preview.disabled.hint', 'Skip running code in the kernel until you turn it back on.')}
					icon='codicon-eye-closed'
					title={localize('positron.notebook.visualize.preview.disabled.title', 'Live preview is off')}
				/>
			);
		case 'needs-dfname':
			return (
				<PreviewMessage
					hint={localize('positron.notebook.visualize.preview.needsDfName.hint', 'Enter a valid DataFrame variable name on the columns step.')}
					icon='codicon-info'
					title={localize('positron.notebook.visualize.preview.needsDfName.title', 'DataFrame variable needed')}
				/>
			);
		case 'no-runtime':
			return (
				<PreviewMessage
					hint={localize('positron.notebook.visualize.preview.noRuntime.hint', 'Start a kernel for this notebook and try again.')}
					icon='codicon-debug-disconnect'
					title={localize('positron.notebook.visualize.preview.noRuntime.title', 'No runtime attached')}
				/>
			);
		case 'unsupported-library':
			return (
				<PreviewMessage
					hint={localize('positron.notebook.visualize.preview.unsupportedLibrary.hint', 'Live preview is only available for Matplotlib and Seaborn right now. Inserting still works.')}
					icon='codicon-info'
					title={localize('positron.notebook.visualize.preview.unsupportedLibrary.title', 'Preview not available for this library')}
				/>
			);
		case 'loading':
			return (
				<PreviewMessage
					hint={localize('positron.notebook.visualize.preview.loading.hint', 'Running your snippet in the kernel.')}
					icon='codicon-loading codicon-modifier-spin'
					title={localize('positron.notebook.visualize.preview.loading.title', 'Rendering preview...')}
				/>
			);
		case 'success':
			if (state.mime === 'text/html') {
				return (
					<iframe
						className='visualize-preview-iframe'
						sandbox='allow-scripts'
						srcDoc={state.data}
						title={localize('positron.notebook.visualize.preview.iframeTitle', 'Chart preview')}
					/>
				);
			}
			// PNG arrives base64-encoded; SVG arrives as raw XML (URL-encoded for the data URI).
			return (
				<img
					alt={localize('positron.notebook.visualize.preview.imageAlt', 'Generated chart preview')}
					className='visualize-preview-image'
					src={state.mime === 'image/svg+xml'
						? `data:image/svg+xml;utf8,${encodeURIComponent(state.data)}`
						: `data:image/png;base64,${state.data}`}
				/>
			);
		case 'error':
			return (
				<PreviewMessage
					hint={state.message}
					icon='codicon-warning'
					title={localize('positron.notebook.visualize.preview.error.title', 'Preview failed')}
					tone='error'
				/>
			);
	}
}

function PreviewMessage({ icon, title, hint, tone, action }: {
	icon: string;
	title: string;
	hint?: string;
	tone?: 'error';
	action?: { label: string; onClick: () => void };
}) {
	return (
		<div className={`visualize-preview-message${tone ? ` ${tone}` : ''}`}>
			<span className={`visualize-preview-message-icon codicon ${icon}`} />
			<span className='visualize-preview-message-title'>{title}</span>
			{hint && <span className='visualize-preview-message-hint'>{hint}</span>}
			{action && (
				<button
					className='visualize-preview-message-action'
					type='button'
					onClick={action.onClick}
				>
					{action.label}
				</button>
			)}
		</div>
	);
}

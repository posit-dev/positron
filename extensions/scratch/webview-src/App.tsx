/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoConfig, DemoProvider, HostMessage } from '../src/providerDemoProtocol';
import { vscodeApi } from './vscodeApi';

/**
 * The verbs the built-in authentication extension's `onAction` callback
 * understands. `cancel` is listed first because it maps to `cancelSignIn()` and
 * has no persistent effect, so it proves the call reached the authentication
 * extension without touching a stored credential.
 */
const ACTIONS = ['cancel', 'oauth-signin', 'oauth-signout', 'save', 'delete'] as const;

/**
 * The only verb that reads the config. The others are given `{}` so a
 * half-filled form cannot ride along with `delete` or a sign-out.
 */
const CONFIG_ACTION = 'save';

interface ResultEntry {
	readonly requestId: number;
	readonly label: string;
	readonly ok: boolean | undefined;
	readonly detail: string;
}

export function App() {
	const [providers, setProviders] = useState<readonly DemoProvider[] | undefined>(undefined);
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
	const [action, setAction] = useState<string>(ACTIONS[0]);
	const [results, setResults] = useState<readonly ResultEntry[]>([]);
	const [apiKey, setApiKey] = useState('');
	const [baseUrl, setBaseUrl] = useState('');

	// Request ids only need to be unique within one panel lifetime.
	const nextRequestId = useRef(1);

	useEffect(() => {
		const onMessage = (event: MessageEvent<HostMessage>) => {
			const message = event.data;
			switch (message.type) {
				case 'providers':
					setProviders(message.providers);
					setSelectedId(current => current ?? message.providers[0]?.id);
					return;
				case 'result':
					setResults(current => current.map(entry => entry.requestId === message.requestId
						? { ...entry, ok: message.ok, detail: message.detail }
						: entry));
					return;
			}
		};

		window.addEventListener('message', onMessage);
		// Announcing readiness rather than having the host push on creation
		// avoids a race where the first message arrives before this listener is
		// attached and is dropped.
		vscodeApi.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				// The webview is an iframe, so this keydown never reaches the
				// modal's own handling. Forwarding it is what makes Escape work.
				vscodeApi.postMessage({ type: 'close' });
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	const track = useCallback((label: string): number => {
		const requestId = nextRequestId.current++;
		setResults(current => [{ requestId, label, ok: undefined, detail: 'pending...' }, ...current].slice(0, 8));
		return requestId;
	}, []);

	const selected = providers?.find(provider => provider.id === selectedId);
	const supportsApiKey = selected?.supportedOptions.includes('apiKey') ?? false;
	const supportsBaseUrl = selected?.supportedOptions.includes('baseUrl') ?? false;

	// Fields are per-provider, so switching selection must not carry a key typed
	// for one provider over to the next.
	useEffect(() => {
		setApiKey('');
		setBaseUrl('');
	}, [selectedId]);

	const onRunAction = useCallback(() => {
		if (!selectedId) {
			return;
		}

		// Only include a field the provider supports and the user actually filled
		// in. An omitted field leaves any stored value alone; sending an empty
		// string would ask the provider to clear it.
		const config: DemoConfig = action === CONFIG_ACTION
			? {
				...(supportsApiKey && apiKey !== '' ? { apiKey } : {}),
				...(supportsBaseUrl && baseUrl !== '' ? { baseUrl } : {}),
			}
			: {};

		const fields = Object.keys(config);
		const shape = fields.length > 0 ? `{ ${fields.join(', ')} }` : '{}';
		const requestId = track(`runLegacyProviderAction('${selectedId}', '${action}', ${shape})`);
		vscodeApi.postMessage({ type: 'runAction', requestId, providerId: selectedId, action, config });
	}, [selectedId, action, apiKey, baseUrl, supportsApiKey, supportsBaseUrl, track]);

	const onInspectCredential = useCallback(() => {
		if (!selectedId) {
			return;
		}
		const requestId = track(`getSession('${selectedId}')`);
		vscodeApi.postMessage({ type: 'inspectCredential', requestId, providerId: selectedId });
	}, [selectedId, track]);

	return (
		<div className='app'>
			<header>
				<h1>Scratch Provider Demo</h1>
				<p className='subtitle'>
					An extension-hosted React app running in a Positron modal. The provider list,
					the actions, and the credential read all cross the extension host boundary.
				</p>
			</header>

			{providers === undefined
				? <p className='muted'>Loading providers...</p>
				: providers.length === 0
					? <p className='muted'>No language model providers are registered.</p>
					: (
						<div className='columns'>
							<section className='pane'>
								<h2>positron.ai.getRegisteredProviders()</h2>
								<ul className='providers'>
									{providers.map(provider => (
										<li key={provider.id}>
											<button
												className={provider.id === selectedId ? 'provider selected' : 'provider'}
												type='button'
												onClick={() => setSelectedId(provider.id)}
											>
												<span className='provider-name'>{provider.displayName}</span>
												<span className='provider-id'>{provider.id}</span>
												<span className='badges'>
													{provider.signedIn && <span className='badge ok'>signed in</span>}
													{provider.status === 'error' && <span className='badge error'>error</span>}
												</span>
											</button>
										</li>
									))}
								</ul>
								<button className='link' type='button' onClick={() => vscodeApi.postMessage({ type: 'refresh' })}>
									Refresh
								</button>
							</section>

							<section className='pane'>
								<h2>{selected ? selected.displayName : 'No selection'}</h2>
								{selected && (
									<>
										<dl className='details'>
											<dt>supportedOptions</dt>
											<dd>{selected.supportedOptions.length > 0 ? selected.supportedOptions.join(', ') : '(none)'}</dd>
											<dt>authMethods</dt>
											<dd>{selected.authMethods?.join(', ') || '(none)'}</dd>
											<dt>status</dt>
											<dd>{selected.status ?? 'ok'}{selected.statusMessage ? ` - ${selected.statusMessage}` : ''}</dd>
										</dl>

										{(supportsApiKey || supportsBaseUrl) && (
											<div className='fields'>
												{supportsApiKey && (
													<label className='field'>
														<span>apiKey</span>
														<input
															autoComplete='off'
															placeholder='(unchanged)'
															spellCheck={false}
															type='password'
															value={apiKey}
															onChange={event => setApiKey(event.target.value)}
														/>
													</label>
												)}
												{supportsBaseUrl && (
													<label className='field'>
														<span>baseUrl</span>
														<input
															autoComplete='off'
															placeholder={selected.baseUrlDefault ?? '(provider default)'}
															spellCheck={false}
															type='text'
															value={baseUrl}
															onChange={event => setBaseUrl(event.target.value)}
														/>
													</label>
												)}
												<p className='hint'>
													Only sent with <code>{CONFIG_ACTION}</code>, and only the fields you
													fill in. Rendered from <code>supportedOptions</code>, so a provider
													that declares neither field shows no form at all.
												</p>
											</div>
										)}

										<div className='row'>
											<select
												aria-label='Action'
												value={action}
												onChange={event => setAction(event.target.value)}
											>
												{ACTIONS.map(candidate => <option key={candidate} value={candidate}>{candidate}</option>)}
											</select>
											<button type='button' onClick={onRunAction}>Run action</button>
										</div>
										<p className='hint'>
											Routes through the transitional core bridge, which only permits this
											extension against providers the built-in authentication extension owns.
										</p>

										<div className='row'>
											<button type='button' onClick={onInspectCredential}>Inspect credential</button>
										</div>
										<p className='hint'>
											Reads the session through <code>vscode.authentication</code>. Only providers
											this extension is allow-listed for in <code>product.json</code> will resolve.
										</p>
									</>
								)}
							</section>
						</div>
					)}

			<section className='pane results'>
				<h2>Results</h2>
				{results.length === 0
					? <p className='muted'>Nothing run yet.</p>
					: (
						<ul>
							{results.map(entry => (
								<li key={entry.requestId} className={entry.ok === undefined ? 'pending' : entry.ok ? 'ok' : 'error'}>
									<code>{entry.label}</code>
									<pre>{entry.detail}</pre>
								</li>
							))}
						</ul>
					)}
			</section>

			<footer>
				<button type='button' onClick={() => vscodeApi.postMessage({ type: 'close' })}>Close</button>
				<span className='muted'>Escape also closes, forwarded from the iframe.</span>
			</footer>
		</div>
	);
}

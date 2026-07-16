/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { PositronGallerySourceConfigKey, PositronCustomGalleryUrlConfigKey } from '../../../../platform/extensionManagement/common/extensionGalleryManifest.js';
import { deriveGalleryConfig } from '../../../../platform/extensionManagement/common/extensionGalleryManifestService.js';
import { interpretProbeResult, WarnOnceCache, buildProbeQueryBody, ProbeOutcome, redactUrlForDisplay } from '../common/positronCustomGalleryProbe.js';

const PROBE_DEBOUNCE_MS = 750;
const PROBE_TIMEOUT_MS = 5000;

/**
 * Advisory, desktop-only check that warns when the configured custom extension
 * gallery is malformed or unreachable. Runs once at startup (so a persisted bad
 * config is surfaced without re-editing) and on each relevant config change,
 * debounced and warn-once'd so editing the setting does not spam notifications.
 * Never blocks: the value still saves and the gallery only switches on restart.
 */
export class PositronCustomGalleryValidation extends Disposable implements IWorkbenchContribution {

	private readonly warnOnce = new WarnOnceCache();
	private readonly scheduler: RunOnceScheduler;
	private cts: CancellationTokenSource | undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IRequestService private readonly requestService: IRequestService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this.scheduler = this._register(new RunOnceScheduler(() => this.probe(), PROBE_DEBOUNCE_MS));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(PositronGallerySourceConfigKey) || e.affectsConfiguration(PositronCustomGalleryUrlConfigKey)) {
				this.cancelInFlight();
				this.scheduler.schedule();
			}
		}));

		// Startup advisory: probe once if the user is already on a custom gallery.
		if (this.isCustom()) {
			this.scheduler.schedule();
		}
	}

	override dispose(): void {
		// Cancel any in-flight probe so it cannot notify after disposal.
		this.cancelInFlight();
		super.dispose();
	}

	private isCustom(): boolean {
		return this.configurationService.getValue<string>(PositronGallerySourceConfigKey) === 'custom';
	}

	private cancelInFlight(): void {
		this.cts?.cancel();
		this.cts?.dispose();
		this.cts = undefined;
	}

	private async probe(): Promise<void> {
		if (!this.isCustom()) {
			return;
		}
		const rawUrl = (this.configurationService.getValue<string>(PositronCustomGalleryUrlConfigKey) ?? '').trim();
		const config = deriveGalleryConfig(rawUrl, msg => this.logService.warn(`[CustomGallery] ${msg}`));
		// Credential-free display value. For a valid config use the canonical
		// serviceUrl (minus /gallery); otherwise redact the raw input so a
		// credential-bearing URL (which is exactly why derivation failed) never
		// reaches the notification.
		const displayUrl = config ? config.serviceUrl.replace(/\/gallery$/, '') : redactUrlForDisplay(rawUrl);

		const outcome: ProbeOutcome = config
			? await this.requestQuery(`${config.serviceUrl}/extensionquery`)
			: { kind: 'invalid-url' };

		const decision = interpretProbeResult(outcome);
		if (decision.notify) {
			if (this.warnOnce.shouldWarn(rawUrl)) {
				this.notificationService.warn(localize(
					'positron.extensions.customGallery.unreachable',
					"Couldn't reach the custom extension gallery at {0}: {1}.", displayUrl, decision.reason
				));
			}
		} else {
			this.warnOnce.clear();
		}
	}

	private async requestQuery(url: string): Promise<ProbeOutcome> {
		// Defensive: supersede any probe still in flight before starting a new one.
		this.cancelInFlight();
		this.cts = new CancellationTokenSource();
		try {
			const context = await this.requestService.request({
				type: 'POST',
				url,
				data: JSON.stringify(buildProbeQueryBody()),
				headers: { 'Content-Type': 'application/json', 'Accept': 'application/json;api-version=3.0-preview.1' },
				timeout: PROBE_TIMEOUT_MS,
				callSite: 'positronCustomGalleryValidation.probe',
			}, this.cts.token);

			const status = context.res.statusCode ?? 0;
			let hasResultsArray = false;
			try {
				const body = await asJson<{ results?: unknown[] }>(context);
				hasResultsArray = Array.isArray(body?.results);
			} catch {
				hasResultsArray = false;
			}
			return { kind: 'http', status, hasResultsArray };
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[CustomGallery] probe failed for ${url}: ${reason}`);
			return { kind: 'error', reason: 'connection failed' };
		}
	}
}

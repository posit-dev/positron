/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './environmentHealthSection.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { URI } from '../../../../../../base/common/uri.js';
import { Button } from '../../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { HealthItemStatus, IHealthItem, IHealthItemFix } from '../environmentHealth.js';

/** Icon and screen reader text for each outcome. */
const STATUS_PRESENTATION: Record<HealthItemStatus, { codicon: string; label: string }> = {
	pass: { codicon: 'codicon-pass-filled', label: localize('positron.welcome.environmentSetupStatusPass', "Passed") },
	warn: { codicon: 'codicon-warning', label: localize('positron.welcome.environmentSetupStatusWarn', "Needs attention") },
	fail: { codicon: 'codicon-error', label: localize('positron.welcome.environmentSetupStatusFail', "Failed") },
	skipped: { codicon: 'codicon-circle-outline', label: localize('positron.welcome.environmentSetupStatusSkipped', "Not checked") },
};

export interface HealthItemRowProps {
	readonly item: IHealthItem;
	/**
	 * Whether this language has a check or a fix running. A fix command can run
	 * for minutes, and pressing it again runs it again -- a second install, or a
	 * second environment.
	 */
	readonly busy: boolean;
	readonly onRunFix: (fix: IHealthItemFix) => void;
}

/**
 * HealthItemRow component. One environment check, whichever language produced it.
 * @param props A HealthItemRowProps that contains the component properties.
 * @returns The rendered component.
 */
export const HealthItemRow = ({ item, busy, onRunFix }: HealthItemRowProps) => {
	const services = usePositronReactServicesContext();
	const status = STATUS_PRESENTATION[item.status];

	// The workbench does not intercept a plain anchor click: on desktop the
	// main process blocks the navigation outright, and on web it would
	// navigate the whole tab away. Opening through the opener service keeps
	// this row generic -- it still knows nothing about languages or fixes.
	const openLearnMore = (e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault();
		services.openerService.open(URI.parse(item.learnMoreUrl!));
	};

	// Render.
	return (
		<li className='environment-health-item'>
			<div className='environment-health-item-main'>
				<span aria-hidden='true' className={`environment-health-item-icon environment-health-item-icon-${item.status} codicon ${status.codicon}`} />
				<span className='visually-hidden'>{status.label}</span>
				<span className='environment-health-item-summary'>{item.summary}</span>
				{item.fix &&
					<Button ariaDisabled={busy} className='environment-health-item-fix' onPressed={() => onRunFix(item.fix!)}>
						{item.fix.label}
					</Button>}
			</div>
			{(item.detail || item.learnMoreUrl) &&
				<div className='environment-health-item-secondary'>
					{item.detail && <p className='environment-health-item-detail'>{item.detail}</p>}
					{item.learnMoreUrl &&
						<a
							href={item.learnMoreUrl}
							onClick={openLearnMore}
						>
							{localize('positron.welcome.environmentSetupLearnMore', "Learn more")}
						</a>}
				</div>}
		</li>
	);
};

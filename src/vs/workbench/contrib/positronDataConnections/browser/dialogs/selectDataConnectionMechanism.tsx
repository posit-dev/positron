/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './selectDataConnectionMechanism.css';

// React.
import { useCallback, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { ThreeButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/threeButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { IDataConnectionDriver, IDataConnectionMechanism } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

/**
 * SelectDataConnectionMechanismProps interface.
 */
interface SelectDataConnectionMechanismProps {
	// The renderer.
	renderer: PositronModalDialogReactRenderer;

	// The driver whose mechanisms are being selected from.
	driver: IDataConnectionDriver;

	// Called when the user clicks the Back button to return to the provider selection step.
	onBack: () => void;

	// Called when the user selects a mechanism and clicks Next.
	onNext: (mechanism: IDataConnectionMechanism) => void;
}

/**
 * SelectDataConnectionMechanism component.
 * Displays a dialog with a list of the driver's configuration mechanisms that the user can choose
 * from. Only shown when the driver exposes more than one mechanism.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const SelectDataConnectionMechanism = (props: SelectDataConnectionMechanismProps) => {
	// Destructure props for use in hooks.
	const { driver, onBack, onNext, renderer } = props;

	// State. Pre-select the first mechanism so Next is always actionable.
	const [selectedMechanismId, setSelectedMechanismId] = useState<string>(driver.metadata.mechanisms[0].id);

	// Cancel handler.
	const cancelHandler = useCallback(() => {
		// Dispose the renderer, which will close the dialog.
		renderer.dispose();
	}, [renderer]);

	// Resolves the given mechanism id and advances to the next step. Takes the id explicitly (rather
	// than reading selectedMechanismId) so callers like double-click can advance in the same tick they
	// select, without waiting for the selection state update to flush.
	const proceedWithMechanism = useCallback((mechanismId: string) => {
		// Get the mechanism. This can't fail since the id is always one of the driver's mechanisms.
		const mechanism = driver.metadata.mechanisms.find(_ => _.id === mechanismId);
		if (!mechanism) {
			return;
		}

		// Proceed to the next step with the selected mechanism.
		onNext(mechanism);
	}, [driver.metadata.mechanisms, onNext]);

	// Next handler.
	const nextHandler = useCallback(() => {
		proceedWithMechanism(selectedMechanismId);
	}, [proceedWithMechanism, selectedMechanismId]);

	// Render.
	return (
		<PositronDynamicModalDialog
			content={
				<div className='select-data-connection-mechanism'>
					<div className='mechanism-list' role='radiogroup'>
						{driver.metadata.mechanisms.map(mechanism => {
							const mechanismCardId = `data-connection-mechanism-card-${mechanism.id}`;
							return (
								<label
									key={mechanism.id}
									className={positronClassNames(
										'mechanism-card',
										{ 'selected': selectedMechanismId === mechanism.id }
									)}
									htmlFor={mechanismCardId}
									onDoubleClick={() => {
										// Double-click selects the mechanism and advances, mirroring Next.
										setSelectedMechanismId(mechanism.id);
										proceedWithMechanism(mechanism.id);
									}}
								>
									<input
										checked={selectedMechanismId === mechanism.id}
										className='mechanism-card-input'
										id={mechanismCardId}
										name='data-connection-mechanism'
										type='radio'
										value={mechanism.id}
										onChange={() => setSelectedMechanismId(mechanism.id)}
									/>
									<div className='mechanism-card-label'>{mechanism.label}</div>
									<div className='mechanism-card-description'>{mechanism.description}</div>
								</label>
							);
						})}
					</div>
				</div>
			}
			footer={
				<ThreeButtonFooter
					leftButtonTitle={localize('positron.selectDataConnectionMechanism.back', "Back")}
					primaryButtonTitle={localize('positron.selectDataConnectionMechanism.next', "Next")}
					secondaryButtonTitle={localize('positron.selectDataConnectionMechanism.cancel', "Cancel")}
					topBorder={true}
					onLeftButton={onBack}
					onPrimaryButton={nextHandler}
					onSecondaryButton={cancelHandler}
				/>
			}
			renderer={props.renderer}
			title={localize(
				'positron.selectDataConnectionMechanism.title',
				"Add Data Connection \u00B7 {0}",
				driver.metadata.name
			)}
			titleDescription={localize(
				'positron.selectDataConnectionMechanism.selectMechanism',
				"Select how to connect"
			)}
			titleSize='large'
			width={492}
			onCancel={cancelHandler}
			onSubmit={nextHandler}
		/>
	);
};

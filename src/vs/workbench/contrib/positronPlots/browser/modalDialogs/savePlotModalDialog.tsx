/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./savePlotModalDialog';
import * as React from 'react';
import { ContentArea } from 'vs/base/browser/ui/positronModalDialog/components/contentArea';
import { PositronModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';
import { localize } from 'vs/nls';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';

export const showSavePlotModalDialog = async (
	layoutService: IWorkbenchLayoutService
): Promise<FileSystemFileHandle | undefined> => {

	return new Promise<FileSystemFileHandle | undefined>((resolve) => {
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(layoutService.mainContainer);
		const ModalDialog = () => {
			const [path, setPath] = React.useState('');

			const acceptHandler = async () => {
				positronModalDialogReactRenderer.destroy();

				resolve(undefined);
			};

			const cancelHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(undefined);
			};

			const saveHandler = async () => {
				const path = await showSaveFilePicker({
					types: [
						{
							description: 'PNG',
							accept: {
								'image/png': ['.png']
							}
						},
						{
							description: 'SVG',
							accept: {
								'image/svg+xml': ['.svg']
							}
						},
						{
							description: 'JPEG',
							accept: {
								'image/jpeg': ['.jpeg']
							}
						}
					],
				});
				path.getFile().then(file => {
					setPath(file.name);
					console.log(file.name);
				});
			};

			return (
				<PositronModalDialog
					width={350}
					height={200}
					title={localize('positronSavePlotModalDialogTitle', "Save Plot")}
					accept={acceptHandler}
					cancel={cancelHandler}>
					<ContentArea>
						<table>
							<tr>
								<td>
									<label htmlFor='plotPath'>{localize('positronSavePlotModalDialogPath', "Path:")}</label>
								</td>
								<td>
									<input type='text' id='plotPath' value={path} />
									<button tabIndex={0} onClick={saveHandler}>{localize('positronSavePlotModalDialogBrowse', "Browse...")}</button>
								</td>
							</tr>
							<tr>

							</tr>
						</table>
						<div className='plot-save-dialog-action-bar top-separator'>
							<div className='right'>
								<button className='button action-bar-button default' tabIndex={0} onClick={acceptHandler}>
									{localize('positronSave', "Save")}
								</button>
								<button className='button action-bar-button' tabIndex={0} onClick={cancelHandler}>
									{localize('positronCancel', "Cancel")}
								</button>
							</div>
						</div>
					</ContentArea>

				</PositronModalDialog>
			);
		};

		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};

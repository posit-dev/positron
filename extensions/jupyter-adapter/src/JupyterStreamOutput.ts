/*
 * JupyterStreamOutput.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import { JupyterMessageSpec } from "./JupyterMessageSpec";

export interface JupyterStreamOutput extends JupyterMessageSpec {
    /** The stream the output belongs to, i.e. stdout/stderr */
    name: string;

    /** The text emitted from the stream */
    text: string;
}

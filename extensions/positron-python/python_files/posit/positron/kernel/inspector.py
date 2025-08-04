#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable, Container

from IPython.core.oinspect import Inspector, find_file, find_source_lines

if TYPE_CHECKING:
    from IPython.core.oinspect import OInfo

    from positron.kernel.shell import PositronShell


class PositronInspector(Inspector):
    parent: PositronShell

    def pinfo(
        self,
        obj: Any,
        oname: str = "",
        formatter: Callable[[str], dict[str, str]] | None = None,
        info: OInfo | None = None,
        detail_level: int = 0,
        enable_html_pager: bool = True,  # noqa: FBT001, FBT002
        omit_sections: Container[str] = (),
    ) -> None:
        kernel = self.parent.kernel

        # Intercept `%pinfo obj` / `obj?` calls, and instead use Positron's help service
        if detail_level == 0:
            kernel.help_service.show_help(obj)
            return None

        # For `%pinfo2 obj` / `obj??` calls, try to open an editor via Positron's UI service
        fname = find_file(obj)

        if fname is None:
            # If we couldn't get a filename, fall back to the default implementation.
            return super().pinfo(
                obj,
                oname,
                formatter,
                info,
                detail_level,
                enable_html_pager,
                omit_sections,
            )

        # If we got a filename, try to get the line number and open an editor.
        lineno = find_source_lines(obj) or 0
        kernel.ui_service.open_editor(fname, lineno, 0)
        return None

    pinfo.__doc__ = Inspector.pinfo.__doc__

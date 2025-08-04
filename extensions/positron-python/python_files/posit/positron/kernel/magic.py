#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

from typing import TYPE_CHECKING

from IPython.core import magic_arguments
from IPython.core.error import UsageError
from IPython.core.magic import Magics, line_magic, magics_class

from ..access_keys import encode_access_key
from ..utils import get_qualname

if TYPE_CHECKING:
    from .shell import PositronShell


@magics_class
class PositronMagics(Magics):
    shell: PositronShell

    # This will override the default `clear` defined in `ipykernel.zmqshell.KernelMagics`.
    @line_magic
    def clear(self, line: str) -> None:  # noqa: ARG002
        """Clear the console."""
        # Send a message to the frontend to clear the console.
        self.shell.kernel.ui_service.clear_console()

    @magic_arguments.magic_arguments()
    @magic_arguments.argument(
        "object",
        help="The object or expression to view.",
    )
    @magic_arguments.argument(
        "title",
        nargs="?",
        help="The title of the Data Explorer tab. Defaults to the object's name or expression.",
    )
    @line_magic
    def view(self, line: str) -> None:
        """
        View an object or expression result in the Positron Data Explorer.

        Examples
        --------
        View an object:

        >>> %view df

        View an expression result:

        >>> %view df.groupby('column').sum()

        View an object with a custom title (quotes are required if the title contains spaces):

        >>> %view df "My Dataset"
        """
        try:
            args = magic_arguments.parse_argstring(self.view, line)
        except UsageError as e:
            if (
                len(e.args) > 0
                and isinstance(e.args[0], str)
                and e.args[0].startswith("unrecognized arguments")
            ):
                raise UsageError(f"{e.args[0]}. Did you quote the title?") from e
            raise

        # First try to find the object directly by name
        info = self.shell._ofind(args.object)  # noqa: SLF001

        if info.found:
            obj = info.obj
        else:
            # Check if the object name is a quoted string and remove quotes if necessary
            obj_name = args.object
            if (obj_name.startswith('"') and obj_name.endswith('"')) or (
                obj_name.startswith("'") and obj_name.endswith("'")
            ):
                obj_name = obj_name[1:-1]  # Remove the quotes

            # If not found as a variable, try to evaluate it as an expression
            try:
                obj = self.shell.ev(obj_name)
            except Exception as e:
                raise UsageError(f"Failed to evaluate expression '{obj_name}': %s" % e) from e

        title = args.title
        if title is None:
            title = args.object
        else:
            # Remove quotes around the title if they exist.
            if (title.startswith('"') and title.endswith('"')) or (
                title.startswith("'") and title.endswith("'")
            ):
                title = title[1:-1]

        # Register a dataset with the data explorer service.
        try:
            self.shell.kernel.data_explorer_service.register_table(
                obj, title, variable_path=[encode_access_key(args.object)]
            )
        except TypeError as e:
            raise UsageError(f"cannot view object of type '{get_qualname(obj)}'") from e

    @magic_arguments.magic_arguments()
    @magic_arguments.argument(
        "object",
        help="The connection object to show.",
    )
    @line_magic
    def connection_show(self, line: str) -> None:
        """Show a connection object in the Positron Connections Pane."""
        args = magic_arguments.parse_argstring(self.connection_show, line)

        # Find the object.
        info = self.shell._ofind(args.object)  # noqa: SLF001
        if not info.found:
            raise UsageError(f"name '{args.object}' is not defined")

        try:
            self.shell.kernel.connections_service.register_connection(
                info.obj, variable_path=args.object
            )
        except TypeError as e:
            raise UsageError(f"cannot show object of type '{get_qualname(info.obj)}'") from e

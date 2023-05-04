#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

""" Positron extensions to the iPython Kernel."""

import asyncio
import logging
from collections.abc import Iterable, Sequence
from itertools import chain
from typing import Any, Optional, Tuple

from ipykernel.ipkernel import IPythonKernel
from ipykernel.zmqshell import ZMQInteractiveShell

from .dataviewer import DataViewerService
from .environment import EnvironmentService
from .inspectors import get_inspector
from .plots import PositronDisplayPublisherHook

POSITRON_DATA_VIEWER_COMM = "positron.dataViewer"
"""The comm channel target_name for Positron's Data Viewer"""

POSITRON_ENVIRONMENT_COMM = "positron.environment"
"""The comm channel target_name for Positron's Environment View"""

POSITRON_PLOT_COMM = "positron.plot"
"""The comm channel target_name for Positron's Plots View"""

POSITON_NS_HIDDEN = {"_exit_code": {}, "__pydevd_ret_val_dict": {}, "__warningregistry__": {}}
"""Additional variables to hide from the user's namespace."""

# Key used to store the user's environment snapshot in the hidden namespace
__POSITRON_CACHE_KEY__ = "__positron_cache__"


class PositronIPyKernel(IPythonKernel):
    """
    Positron extension of IPythonKernel.

    Adds additional comms to introspect the user's environment.
    """

    def __init__(self, **kwargs):
        """Initializes Positron's IPython kernel."""
        super().__init__(**kwargs)

        # Register for REPL execution events
        shell: ZMQInteractiveShell = self.shell  # type: ignore
        shell.events.register("pre_execute", self.handle_pre_execute)
        shell.events.register("post_execute", self.handle_post_execute)
        self.get_user_ns_hidden().update(POSITON_NS_HIDDEN)

        # Set the traceback mode to minimal by default
        shell.InteractiveTB.set_mode(mode="Minimal")

        # Setup Positron's environment service
        self.env_service = EnvironmentService(self)
        self.comm_manager.register_target(POSITRON_ENVIRONMENT_COMM, self.env_service.on_comm_open)

        # Register Positron's display publisher hook to intercept display_data messages
        # and establish a comm channel with the frontend for rendering plots
        self.display_pub_hook = PositronDisplayPublisherHook(POSITRON_PLOT_COMM)
        shell.display_pub.register_hook(self.display_pub_hook)

        # Setup Positron's dataviewer service
        self.dataviewer_service = DataViewerService(POSITRON_DATA_VIEWER_COMM)

    def do_shutdown(self, restart) -> dict:
        """
        Handle kernel shutdown.
        """
        result = super().do_shutdown(restart)
        self.display_pub_hook.shutdown()
        self.env_service.shutdown()
        self.dataviewer_service.shutdown()
        return result

    def handle_pre_execute(self) -> None:
        """
        Prior to execution, reset the user environment watch state.
        """
        try:
            self.snapshot_user_ns()
        except Exception:
            logging.warning("Failed to snapshot user namespace", exc_info=True)

    def handle_post_execute(self) -> None:
        """
        After execution, sends an update message to the client to summarize
        the changes observed to variables in the user environment.
        """

        # First check pre_execute snapshot exists
        hidden = self.get_user_ns_hidden()
        if __POSITRON_CACHE_KEY__ not in hidden:
            return

        try:
            # Try to detect the changes made since the last execution
            assigned, removed = self.compare_user_ns()
            self.env_service.send_update(assigned, removed)
        except Exception as err:
            logging.warning(err, exc_info=True)

    def get_user_ns(self) -> dict:
        return self.shell.user_ns  # type: ignore

    def get_user_ns_hidden(self) -> dict:
        return self.shell.user_ns_hidden  # type: ignore

    def snapshot_user_ns(self) -> None:
        """
        Caches a shallow copy snapshot of the user's environment
        before execution.
        """
        ns = self.get_user_ns()
        hidden = self.get_user_ns_hidden()
        snapshot = ns.copy()

        # TODO: Determine snapshot strategy for nested objects
        for key, value in ns.items():
            if key in hidden:
                continue

            inspector = get_inspector(value)
            if inspector.is_snapshottable(value):
                snapshot[key] = inspector.copy(value)

        # Save the snapshot in the hidden namespace to compare against
        # after an operation or execution is performed
        hidden[__POSITRON_CACHE_KEY__] = snapshot

    def compare_user_ns(self) -> Tuple[dict, set]:
        assigned = {}
        removed = set()
        after = self.get_user_ns()
        hidden = self.get_user_ns_hidden()

        # Check if a snapshot exists
        snapshot = hidden.get(__POSITRON_CACHE_KEY__, None)
        if snapshot is None:
            return assigned, removed

        # Remove the snapshot for the next comparison
        del hidden[__POSITRON_CACHE_KEY__]

        # Find assigned and removed variables
        for key in chain(snapshot.keys(), after.keys()):
            try:
                if key in hidden:
                    continue

                if key in snapshot and key not in after:
                    # Key was removed
                    removed.add(key)

                elif key not in snapshot and key in after:
                    # Key was added
                    assigned[key] = after[key]

                elif key in snapshot and key in after:
                    v1 = snapshot[key]
                    v2 = after[key]
                    inspector1 = get_inspector(v1)
                    inspector2 = get_inspector(v2)

                    # If either value is snapshottable, compare using the
                    # inspector's special equals() method
                    if inspector1.is_snapshottable(v1) or inspector2.is_snapshottable(v2):
                        if inspector1 != inspector2 or not inspector2.equals(v1, v2):
                            assigned[key] = v2

                    # Otherwise, check if key's value is no longer
                    # the same after exection
                    elif v1 != v2 and key not in assigned:
                        assigned[key] = v2

            except Exception as err:
                logging.warning("err: %s", err, exc_info=True)

        return assigned, removed

    def get_filtered_vars(self, variables: Optional[dict] = None) -> dict:
        """
        Returns a filtered dict of the variables, excluding hidden variables.

        If variables is None, the current user namespace is used.
        """
        hidden = self.get_user_ns_hidden()

        if variables is None:
            variables = self.get_user_ns()

        filtered_variables = {}
        for key, value in variables.items():
            if key not in hidden:
                filtered_variables[key] = value
        return filtered_variables

    def get_filtered_var_names(self, names: set) -> set:
        hidden = self.get_user_ns_hidden()

        # Filter out hidden variables
        filtered_names = set()
        for name in names:
            if hidden is not None and name in hidden:
                continue
            filtered_names.add(name)
        return filtered_names

    def find_var(self, path: Iterable) -> Tuple[bool, Any]:
        """
        Finds the variable at the requested path in the current user session.

        Args:
            path: A list of path segments that will be traversed to find
              the requested variable.
            context: The context from which to start the search.

        Returns:
            A tuple (bool, Any) containing a boolean indicating whether the
            variable was found, as well as the value of the variable, if found.
        """

        if path is None:
            return False, None

        is_known = False
        value = None
        context = self.get_user_ns()

        # Walk the given path segment by segment
        for segment in path:
            # Check for membership as a property
            name = str(segment)
            is_known = hasattr(context, name)
            if is_known:
                value = getattr(context, name, None)
            else:
                # Check for membership via inspector
                inspector = get_inspector(context)
                if inspector is not None:
                    is_known = inspector.has_child(context, name)
                    if is_known:
                        value = inspector.get_child(context, name)

            # Subsequent segment starts from the value
            context = value

            # But we stop if the path segment was unknown
            if not is_known:
                break

        return is_known, value

    def view_var(self, path: Sequence) -> None:
        """
        Opens a viewer comm for the variable at the requested path in the
        current user session.
        """
        if path is None:
            return

        error_message = None
        is_known, value = self.find_var(path)

        if is_known:
            inspector = get_inspector(value)
            if inspector is not None:
                # Use the leaf segment as the title
                title = path[-1:][0]
                dataset = inspector.to_dataset(value, title)
                if dataset is not None:
                    self.dataviewer_service.register_dataset(dataset)
            else:
                error_message = f"Cannot create viewer for variable at '{path}'"
        else:
            error_message = f"Cannot find variable at '{path}' to inspect"

        if error_message is not None:
            raise ValueError(error_message)

    def delete_vars(self, names: Iterable, parent) -> Tuple[dict, set]:
        """
        Deletes the requested variables by name from the current user session.
        """
        if names is None:
            return ({}, set())

        self.snapshot_user_ns()

        for name in names:
            try:
                self.shell.del_var(name, False)  # type: ignore
            except Exception:
                logging.warning(f"Unable to delete variable '{name}'")
                pass

        assigned, removed = self.compare_user_ns()

        # Publish an input to inform clients of the variables that were deleted
        if len(removed) > 0:
            command = "del " + ", ".join(removed)
            try:
                self._publish_execute_input(command, parent, self.execution_count - 1)
            except Exception:
                pass

        return (assigned, removed)

    def delete_all_vars(self, parent) -> None:
        """
        Deletes all of the variables in the current user session.
        """
        loop = asyncio.get_event_loop()
        asyncio.run_coroutine_threadsafe(self._soft_reset(parent), loop)

    async def _soft_reset(self, parent) -> dict:
        """
        Use %reset with the soft switch to delete all user defined
        variables from the environment.
        """
        # Run the %reset magic to clear user variables
        command = "%reset -sf"
        coro = await self.do_execute(command, False, False)

        # Publish an input to inform clients of the "delete all" operation
        try:
            self._publish_execute_input(command, parent, self.execution_count - 1)
        except Exception:
            pass

        # Refresh the client state
        self.env_service.send_list()

        return coro

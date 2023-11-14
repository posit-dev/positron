#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

""" Positron extensions to the iPython Kernel."""
from __future__ import annotations
import asyncio
import logging
import warnings
from collections.abc import Iterable
from itertools import chain
from typing import Any, Callable, Container, Dict, Mapping, Optional, Set, Tuple, Type

from ipykernel.comm.manager import CommManager
from ipykernel.ipkernel import IPythonKernel
from ipykernel.kernelapp import IPKernelApp
from ipykernel.zmqshell import ZMQInteractiveShell, ZMQDisplayPublisher
from IPython.core import oinspect
from IPython.core.interactiveshell import InteractiveShell
from IPython.core.magic import Magics, line_magic, magics_class, needs_local_scope, MagicsManager
from IPython.core import page
from IPython.utils import PyColorize
import traitlets

from .dataviewer import DataViewerService
from .environment import EnvironmentService
from .frontend import FrontendService
from .help import HelpService
from .inspectors import get_inspector
from .lsp import LSPService
from .plots import PositronDisplayPublisherHook
from .utils import cancel_tasks, create_task

POSITRON_DATA_VIEWER_COMM = "positron.dataViewer"
"""The comm channel target_name for Positron's Data Viewer"""

POSITRON_ENVIRONMENT_COMM = "positron.environment"
"""The comm channel target_name for Positron's Environment View"""

POSITRON_FRONTEND_COMM = "positron.frontEnd"
"""The comm channel target_name for Positron's Frontend i.e. unscoped to any particular view"""

POSITRON_HELP_COMM = "positron.help"
"""The comm channel target_name for Positron's Help View"""

POSITRON_LSP_COMM = "positron.lsp"
"""The comm channel target_name for Positron's LSP"""

POSITRON_PLOT_COMM = "positron.plot"
"""The comm channel target_name for Positron's Plots View"""

POSITON_NS_HIDDEN = {
    "_exit_code": {},
    "__pydevd_ret_val_dict": {},
    "__warningregistry__": {},
    "__nonzero__": {},
}
"""Additional variables to hide from the user's namespace."""

# Key used to store the user's environment snapshot in the hidden namespace
__POSITRON_CACHE_KEY__ = "__positron_cache__"

logger = logging.getLogger(__name__)


class PositronIPythonInspector(oinspect.Inspector):
    parent: PositronShell

    def pinfo(
        self,
        obj: Any,
        oname: str,
        formatter: Callable[[str], Dict[str, str]],
        info: oinspect.OInfo,
        *,
        detail_level: int,
        enable_html_pager: bool,
        omit_sections: Container[str] = (),
    ) -> None:
        # Intercept `%pinfo obj` / `obj?` calls, and instead use Positron's help service
        if detail_level == 0:
            self.parent.kernel.help_service.show_help(obj)
            return

        super().pinfo(
            obj=obj,
            oname=oname,
            formatter=formatter,
            info=info,
            detail_level=detail_level,
            enable_html_pager=enable_html_pager,
            omit_sections=omit_sections,
        )

    pinfo.__doc__ = oinspect.Inspector.pinfo.__doc__


class PositronShell(ZMQInteractiveShell):
    kernel: PositronIPyKernel
    object_info_string_level: int
    magics_manager: MagicsManager
    display_pub: ZMQDisplayPublisher

    inspector_class: Type[PositronIPythonInspector] = traitlets.Type(
        PositronIPythonInspector, help="Class to use to instantiate the shell inspector"  # type: ignore
    ).tag(config=True)

    @traitlets.observe("colors")
    def init_inspector(self, change: Optional[traitlets.Bunch] = None) -> None:
        # Override to pass `parent=self` to the inspector
        self.inspector = self.inspector_class(
            oinspect.InspectColors,
            PyColorize.ANSICodeColors,
            self.colors,
            self.object_info_string_level,
            parent=self,
        )

    def init_hooks(self):
        super().init_hooks()

        # For paged output, send display_data messages instead of using the legacy "payload"
        # functionality of execute_reply messages. The priority of 90 is chosen arbitrarily, as long
        # as its lower than other hooks registered by IPython and ipykernel.
        self.set_hook("show_in_pager", page.as_hook(page.display_page), 90)

    async def _stop(self):
        # Initiate the kernel shutdown sequence.
        await self.kernel.do_shutdown(restart=False)

        # Stop the main event loop.
        self.kernel.io_loop.stop()

    @traitlets.observe("exit_now")
    def _update_exit_now(self, change):
        """stop eventloop when exit_now fires"""
        if change["new"]:
            if hasattr(self.kernel, "io_loop"):
                loop = self.kernel.io_loop
                # --- Start Positron ---
                # This is reached when a user types `quit` or `exit` into the Positron Console.
                # Perform a full kernel shutdown sequence before stopping the loop.
                # TODO: We'll need to update this once Positron has a way for kernels to kick off
                # Positron's shutdown sequencing. Currently, this is seen as a kernel crash.
                # See: https://github.com/posit-dev/positron/issues/628.
                loop.call_later(0.1, self._stop)
                # --- End Positron ---
            if self.kernel.eventloop:
                exit_hook = getattr(self.kernel.eventloop, "exit_hook", None)
                if exit_hook:
                    exit_hook(self.kernel)


class PositronIPyKernel(IPythonKernel):
    """
    Positron extension of IPythonKernel.

    Adds additional comms to introspect the user's environment.
    """

    shell: PositronShell
    comm_manager: CommManager
    execution_count: int

    shell_class: PositronShell = traitlets.Type(PositronShell, klass=InteractiveShell)  # type: ignore

    def __init__(self, **kwargs) -> None:
        """Initializes Positron's IPython kernel."""
        super().__init__(**kwargs)

        # Hold strong references to pending tasks to prevent them from being garbage collected
        self._pending_tasks: Set[asyncio.Task] = set()

        # Register for REPL execution events
        self.shell.events.register("pre_execute", self.handle_pre_execute)
        self.shell.events.register("post_execute", self.handle_post_execute)
        self.get_user_ns_hidden().update(POSITON_NS_HIDDEN)

        # Setup Positron's LSP service
        self.lsp_service = LSPService(self)
        self.comm_manager.register_target(POSITRON_LSP_COMM, self.lsp_service.on_comm_open)

        # Setup Positron's dataviewer service
        self.dataviewer_service = DataViewerService(POSITRON_DATA_VIEWER_COMM)

        # Setup Positron's environment service
        self.env_service = EnvironmentService(self, self.dataviewer_service)
        self.comm_manager.register_target(POSITRON_ENVIRONMENT_COMM, self.env_service.on_comm_open)

        # Setup Positron's frontend service
        self.frontend_service = FrontendService()
        self.comm_manager.register_target(
            POSITRON_FRONTEND_COMM, self.frontend_service.on_comm_open
        )

        # Setup Positron's help service
        self.help_service = HelpService(self)
        self.comm_manager.register_target(POSITRON_HELP_COMM, self.help_service.on_comm_open)

        # Register Positron's display publisher hook to intercept display_data messages
        # and establish a comm channel with the frontend for rendering plots
        self.display_pub_hook = PositronDisplayPublisherHook(POSITRON_PLOT_COMM)
        # Not all display publishers support hooks -- in particular, the one used in our tests
        if hasattr(self.shell.display_pub, "register_hook"):
            self.shell.display_pub.register_hook(self.display_pub_hook)
        else:
            logger.warning(f"Unable to register display publisher hook on shell: {self.shell}")

        # Ignore warnings that the user can't do anything about
        warnings.filterwarnings(
            "ignore",
            category=UserWarning,
            message="Matplotlib is currently using module://matplotlib_inline.backend_inline",
        )
        # Trying to import a module that's "auto-imported" by Jedi shows a warning in the Positron
        # Console.
        warnings.filterwarnings(
            "ignore",
            category=UserWarning,
            message=r"Module [^\s]+ not importable in path",
            module="jedi",
        )

        # Register the `%view` magic.
        self.shell.register_magics(ViewerMagic)

    def start(self) -> None:
        super().start()
        self.help_service.start()

    async def do_shutdown(self, restart: bool) -> Dict[str, Any]:
        """
        Handle kernel shutdown.
        """
        logger.info("Shutting down the kernel")
        self.display_pub_hook.shutdown()
        self.env_service.shutdown()
        self.lsp_service.shutdown()
        self.help_service.shutdown()
        self.frontend_service.shutdown()
        self.dataviewer_service.shutdown()

        # Cancel and await pending tasks
        await cancel_tasks(self._pending_tasks)

        # We don't call super().do_shutdown since it sets shell.exit_now = True which tries to
        # stop the event loop at the same time as self.shutdown_request (since self.shell_stream.io_loop
        # points to the same underlying asyncio loop).
        return dict(status="ok", restart=restart)

    def handle_pre_execute(self) -> None:
        """
        Prior to execution, reset the user environment watch state.
        """
        try:
            self.snapshot_user_ns()
        except Exception:
            logger.warning("Failed to snapshot user namespace", exc_info=True)

    def handle_post_execute(self) -> None:
        """
        After execution, sends an update message to the client to summarize
        the changes observed to variables in the user's environment.
        """
        # Check for changes to the working directory
        try:
            self.frontend_service.poll_working_directory()
        except:
            logger.exception("Error polling working directory")

        # First check pre_execute snapshot exists
        hidden = self.get_user_ns_hidden()
        if __POSITRON_CACHE_KEY__ not in hidden:
            return

        try:
            # Try to detect the changes made since the last execution
            assigned, removed = self.compare_user_ns()
            self.env_service.send_update(assigned, removed)
        except Exception as err:
            logger.warning(err, exc_info=True)

    def get_user_ns(self) -> Dict[str, Any]:
        return self.shell.user_ns or {}

    def get_user_ns_hidden(self) -> Dict[str, Any]:
        return self.shell.user_ns_hidden or {}

    def snapshot_user_ns(self) -> None:
        """
        Caches a shallow copy snapshot of the user's environment
        before execution and stores it in the hidden namespace.
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

    def compare_user_ns(self) -> Tuple[Dict[str, Any], Set[str]]:
        """
        Attempts to detect changes to variables in the user's environment.

        Returns:
            A tuple (dict, set) containing a dict of variables that were modified
            (added or updated) and a set of variables that were removed.
        """
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
                logger.warning("err: %s", err, exc_info=True)

        return assigned, removed

    def get_filtered_vars(self, variables: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        """
        Returns:
            A filtered dict of the variables, excluding hidden variables. If variables
            is None, the current user namespace in the environment is used.
        """
        hidden = self.get_user_ns_hidden()

        if variables is None:
            variables = self.get_user_ns()

        filtered_variables = {}
        for key, value in variables.items():
            if key not in hidden:
                filtered_variables[key] = value
        return filtered_variables

    def get_filtered_var_names(self, names: Iterable[str]) -> Set[str]:
        """
        Returns:
            A filtered set of variable names, excluding hidden variables.
        """
        hidden = self.get_user_ns_hidden()

        # Filter out hidden variables
        filtered_names = set()
        for name in names:
            if name in hidden:
                continue
            filtered_names.add(name)
        return filtered_names

    def find_var(self, path: Iterable[str]) -> Tuple[bool, Any]:
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
        for access_key in path:
            # Check for membership via inspector
            inspector = get_inspector(context)
            is_known = inspector.has_child(context, access_key)
            if is_known:
                value = inspector.get_child(context, access_key)

            # Subsequent segment starts from the value
            context = value

            # But we stop if the path segment was unknown
            if not is_known:
                break

        return is_known, value

    def delete_vars(self, names: Iterable[str], parent: Dict[str, Any]) -> Tuple[dict, set]:
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
                logger.warning(f"Unable to delete variable '{name}'")
                pass

        assigned, removed = self.compare_user_ns()

        # Publish an input to inform clients of the variables that were deleted
        if len(removed) > 0:
            command = "del " + ", ".join(removed)
            try:
                if self.execution_count:
                    self._publish_execute_input(command, parent, self.execution_count - 1)
            except Exception:
                pass

        return (assigned, removed)

    def delete_all_vars(self, parent: Dict[str, Any]) -> None:
        """
        Deletes all of the variables in the current user session.
        """
        create_task(self._soft_reset(parent), self._pending_tasks)

    async def _soft_reset(self, parent: Dict[str, Any]) -> Dict[str, Any]:
        """
        Use %reset with the soft switch to delete all user defined
        variables from the environment.
        """
        # Run the %reset magic to clear user variables
        command = "%reset -sf"
        reply_content = await self.do_execute(command, silent=False, store_history=False)

        # Publish an input to inform clients of the "delete all" operation
        try:
            if self.execution_count:
                self._publish_execute_input(command, parent, self.execution_count - 1)
        except Exception:
            pass

        # Refresh the client state
        self.env_service.send_list()

        return reply_content


class PositronIPKernelApp(IPKernelApp):
    kernel_class: Type[PositronIPyKernel] = traitlets.Type(PositronIPyKernel)  # type: ignore


@magics_class
class ViewerMagic(Magics):
    shell: PositronShell

    @needs_local_scope
    @line_magic
    def view(self, value: str, local_ns: Dict[str, Any]):
        """Open DataViewerService through %view magic command"""

        try:
            local_value = local_ns[value]
            inspector = get_inspector(local_value)
            dataset = inspector.to_dataset(local_value, value)
        except KeyError:  # not in namespace
            eval_value = eval(value, local_ns, local_ns)
            inspector = get_inspector(eval_value)
            dataset = inspector.to_dataset(eval_value, value)

        if dataset is not None:
            self.shell.kernel.dataviewer_service.register_dataset(dataset)

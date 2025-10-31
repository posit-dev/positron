"""Entry point for launching Positron's extensions to Jedi and IPyKernel in the same environment."""  # noqa: INP001

import argparse
import asyncio
import asyncio.events
import logging
import os
import sys
import threading

from positron.positron_ipkernel import (
    PositronIPKernelApp,
    PositronIPyKernel,
    PositronShell,
)
from positron.positron_jedilsp import POSITRON
from positron.session_mode import SessionMode

logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    # Given we're using TCP, support a subset of the Jedi LSP configuration
    parser = argparse.ArgumentParser(
        prog="positron-language-server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Positron Jedi language server: an LSP wrapper for jedi.",
    )

    parser.add_argument(
        "--debugport",
        help="port for debugpy debugger",
        type=int,
        default=None,
    )
    parser.add_argument(
        "--logfile",
        help="redirect logs to file specified",
        type=str,
    )
    parser.add_argument(
        "--loglevel",
        help="logging level",
        type=str,
        default="error",
        choices=["critical", "error", "warn", "info", "debug"],
    )
    parser.add_argument(
        "-f",
        "--connection-file",
        help="location of the IPyKernel connection file",
        type=str,
    )
    parser.add_argument(
        "-q",
        "--quiet",
        help="Suppress console startup banner information",
        action="store_true",
    )
    parser.add_argument(
        "--session-mode",
        help="session mode in which the kernel is to be started",
        type=SessionMode,
        default=SessionMode.DEFAULT,
        choices=sorted(SessionMode),
    )
    args = parser.parse_args()
    args.loglevel = args.loglevel.upper()

    return args


if __name__ == "__main__":
    exit_status = 0

    # Parse command-line arguments
    args = parse_args()

    # Start the debugpy debugger if a port was specified
    if args.debugport is not None:
        try:
            import debugpy

            debugpy.listen(args.debugport)
        except Exception as error:
            logger.warning(f"Unable to start debugpy: {error}", exc_info=True)

    # Configure logging by passing the IPKernelApp traitlets application by passing a logging config
    # dict. See: https://docs.python.org/3/library/logging.config.html#logging-config-dictschema for
    # more info about this schema.
    handlers = ["console"] if args.logfile is None else ["file"]
    logging_config = {
        "loggers": {
            "PositronIPKernelApp": {
                "level": args.loglevel,
                "handlers": handlers,
            },
            "Comm": {
                "level": args.loglevel,
                "handlers": handlers,
            },
            "positron": {
                "level": args.loglevel,
                "handlers": handlers,
            },
            "asyncio": {
                "level": args.loglevel,
                "handlers": handlers,
            },
        }
    }
    if args.logfile is not None:
        logging_config["handlers"] = {
            "file": {
                "class": "logging.FileHandler",
                "formatter": "console",
                "level": args.loglevel,
                "filename": args.logfile,
            }
        }

    # IPKernelApp expects an empty string if no connection_file is provided.
    if args.connection_file is None:
        args.connection_file = ""

    # Start Positron's IPyKernel as the interpreter for our console.
    app: PositronIPKernelApp = PositronIPKernelApp.instance(
        connection_file=args.connection_file,
        log_level=args.loglevel,
        logging_config=logging_config,
        session_mode=args.session_mode,
    )
    # Initialize with empty argv, otherwise BaseIPythonApplication.initialize reuses our
    # command-line arguments in unexpected ways (e.g. logfile instructs it to log executed code).
    app.initialize(argv=[])
    assert app.kernel is not None, "Kernel was not initialized"
    # Disable the banner if running in quiet mode.
    if args.quiet:
        app.kernel.shell.banner1 = ""

    app.kernel.start()

    logger.info(f"Process ID {os.getpid()}")

    # IPyKernel uses Tornado which (as of version 5.0) shares the same event
    # loop as asyncio.
    loop: asyncio.events.AbstractEventLoop = asyncio.get_event_loop_policy().get_event_loop()

    # Enable asyncio debug mode.
    if args.loglevel == "DEBUG":
        loop.set_debug(True)
        POSITRON.set_debug(True)

        # Log all callbacks that take longer than 0.5 seconds (the current default is too noisy).
        loop.slow_callback_duration = 0.5

    # On Windows, set up interrupt event monitoring. Typically ipykernel would
    # handle JPY_INTERRUPT_EVENT itself, but since we're running a custom event
    # loop, it will not receive the signal, so we need to do it here and inject
    # KeyboardInterrupt into the main thread.
    if sys.platform == "win32":
        import ctypes
        import ctypes.wintypes

        # Get the interrupt event handle from the environment variable
        interrupt_event = os.environ.get("JPY_INTERRUPT_EVENT")
        if interrupt_event:
            logger.info(f"Setting up Windows interrupt event: {interrupt_event}")

            # Convert the event handle string to an integer
            event_handle = int(interrupt_event)

            # Define Windows API functions
            kernel32 = ctypes.windll.kernel32
            WaitForSingleObject = kernel32.WaitForSingleObject
            WaitForSingleObject.argtypes = [ctypes.wintypes.HANDLE, ctypes.wintypes.DWORD]
            WaitForSingleObject.restype = ctypes.wintypes.DWORD

            WAIT_OBJECT_0 = 0

            # Store the main thread ID so we can inject KeyboardInterrupt into it
            import ctypes

            main_thread_id = threading.get_ident()

            # Get ResetEvent to reset the event after handling
            ResetEvent = kernel32.ResetEvent
            ResetEvent.argtypes = [ctypes.wintypes.HANDLE]
            ResetEvent.restype = ctypes.wintypes.BOOL

            def watch_interrupt_event():
                """Thread function to watch for the Windows interrupt event."""
                logger.info(f"Interrupt monitoring thread started, watching handle {event_handle}")
                while True:
                    # Wait for the event to be signaled (check every 200ms)
                    result = WaitForSingleObject(event_handle, 200)
                    if result == WAIT_OBJECT_0:
                        logger.info("Interrupt event signaled, injecting KeyboardInterrupt")
                        try:
                            # Reset the event so it can be signaled again
                            ResetEvent(event_handle)

                            # Inject KeyboardInterrupt into the main thread using ctypes
                            # This is the approach used by _thread.interrupt_main() but we ensure
                            # it targets the correct thread
                            ret = ctypes.pythonapi.PyThreadState_SetAsyncExc(
                                ctypes.c_long(main_thread_id), ctypes.py_object(KeyboardInterrupt)
                            )
                            logger.info(f"KeyboardInterrupt injected, return value: {ret}")
                        except Exception as e:
                            logger.error(f"Error injecting KeyboardInterrupt: {e}", exc_info=True)
                        # Don't break - continue monitoring for future interrupts

            # Start the interrupt monitoring thread
            interrupt_thread = threading.Thread(target=watch_interrupt_event, daemon=True)
            interrupt_thread.start()
            logger.info(
                f"Windows interrupt monitoring thread started for event handle {event_handle}"
            )

    try:
        loop.run_forever()
    except (KeyboardInterrupt, SystemExit):
        logger.exception("Unexpected exception in event loop")
        exit_status = 1
    finally:
        loop.close()

    # When the app is gone, it should be safe to clear singleton instances.
    # This allows re-starting the ipykernel in the same process, using different
    # connection strings, etc.
    PositronShell.clear_instance()
    PositronIPyKernel.clear_instance()
    PositronIPKernelApp.clear_instance()
    app.close()

    logger.info(f"Exiting process with status {exit_status}")
    sys.exit(exit_status)

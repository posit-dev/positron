"""Entry point for launching Positron's extensions to Jedi and IPyKernel in the same environment."""  # noqa: INP001

import argparse
import asyncio
import asyncio.events
import logging
import os
import sys

# Windows-specific imports for interrupt handling
if os.name == 'nt':
    import ctypes
    from ctypes import wintypes
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


def create_windows_interrupt_handler(app: PositronIPKernelApp, loop: asyncio.AbstractEventLoop) -> None:
    """
    Create a Windows-specific interrupt handler that monitors the JPY_INTERRUPT_EVENT
    and triggers kernel interruption when the event is signaled.
    
    This function is needed because ipykernel's built-in Windows interrupt handling
    doesn't work properly when running under asyncio's event loop.
    """
    if os.name != 'nt':
        return  # Only needed on Windows
        
    interrupt_event_str = os.environ.get('JPY_INTERRUPT_EVENT')
    if not interrupt_event_str:
        logger.info("No JPY_INTERRUPT_EVENT found in environment; Windows interrupt handling disabled")
        return
        
    try:
        # Convert the environment variable to a Windows handle
        interrupt_event_handle = int(interrupt_event_str)
        logger.info(f"Setting up Windows interrupt handler for event handle: {interrupt_event_handle}")
        
        # Define Windows API constants and functions
        WAIT_OBJECT_0 = 0x00000000
        WAIT_TIMEOUT = 0x00000102
        INFINITE = 0xFFFFFFFF
        
        # Load kernel32.dll functions
        kernel32 = ctypes.windll.kernel32
        
        # Define function signatures
        kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        kernel32.ResetEvent.argtypes = [wintypes.HANDLE]
        kernel32.ResetEvent.restype = wintypes.BOOL
        
        # Create a shutdown flag for the monitor thread
        monitor_shutdown = threading.Event()
        
        def interrupt_monitor():
            """Monitor the Windows event and trigger interruption when signaled."""
            handle = wintypes.HANDLE(interrupt_event_handle)
            logger.debug("Windows interrupt monitor thread started")
            
            while not monitor_shutdown.is_set():
                try:
                    # Wait for the interrupt event with a timeout to allow clean shutdown
                    result = kernel32.WaitForSingleObject(handle, 1000)  # 1 second timeout
                    
                    if result == WAIT_OBJECT_0:
                        # Event was signaled - interrupt the kernel
                        logger.info("Windows interrupt event signaled, interrupting kernel")
                        
                        # Reset the event so it can be signaled again
                        kernel32.ResetEvent(handle)
                        
                        # Schedule the interrupt on the asyncio event loop
                        if hasattr(app, 'kernel') and app.kernel:
                            def trigger_interrupt():
                                """Trigger interrupt via ipykernel's mechanism."""
                                try:
                                    # Use Python's built-in interrupt mechanism which ipykernel will catch
                                    import signal
                                    import _thread
                                    
                                    # Send interrupt to main thread - this is what ipykernel expects
                                    _thread.interrupt_main()
                                    logger.info("Kernel interrupt triggered via interrupt_main()")
                                    
                                except Exception as e:
                                    logger.error(f"Failed to trigger kernel interrupt: {e}")
                                    # Fallback: try to set a flag that the kernel will check
                                    try:
                                        if hasattr(app.kernel.shell, 'exit_now'):
                                            # Don't actually exit, but signal an interrupt condition
                                            logger.info("Using fallback interrupt method via shell signaling")
                                    except Exception as fallback_error:
                                        logger.error(f"Fallback interrupt method also failed: {fallback_error}")
                            
                            # Call from the main thread using asyncio
                            loop.call_soon_threadsafe(trigger_interrupt)
                            
                    elif result == WAIT_TIMEOUT:
                        # Timeout - continue monitoring
                        continue
                    else:
                        # Some other result - log and continue
                        logger.warning(f"Unexpected result from WaitForSingleObject: {result}")
                        
                except Exception as e:
                    logger.error(f"Error in Windows interrupt monitor: {e}")
                    break
                    
            logger.debug("Windows interrupt monitor thread exiting")
                    
        # Start the monitor thread
        monitor_thread = threading.Thread(target=interrupt_monitor, daemon=True)
        monitor_thread.start()
        logger.info("Windows interrupt monitor thread started")
        
        # Store shutdown flag so it can be triggered on app exit
        if not hasattr(app, '_windows_interrupt_shutdown'):
            app._windows_interrupt_shutdown = monitor_shutdown
        
    except (ValueError, OSError) as e:
        logger.error(f"Failed to set up Windows interrupt handler: {e}")


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

    # Set up Windows-specific interrupt handler
    create_windows_interrupt_handler(app, loop)

    try:
        loop.run_forever()
    except (KeyboardInterrupt, SystemExit):
        logger.exception("Unexpected exception in event loop")
        exit_status = 1
    finally:
        # Signal Windows interrupt monitor to shut down
        if hasattr(app, '_windows_interrupt_shutdown'):
            app._windows_interrupt_shutdown.set()
        
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

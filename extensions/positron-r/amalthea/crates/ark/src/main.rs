//
// main.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

#![allow(unused_unsafe)]

use amalthea::connection_file::ConnectionFile;
use amalthea::kernel::Kernel;
use amalthea::kernel_spec::KernelSpec;
use bus::Bus;
use crossbeam::channel::bounded;
use log::*;
use std::env;
use std::io::stdin;
use std::sync::{Arc, Mutex};
use stdext::unwrap;

mod control;
mod interface;
mod kernel;
mod logger;
mod lsp;
mod plots;
mod request;
mod shell;
mod version;

use crate::control::Control;
use crate::request::Request;
use crate::shell::Shell;
use crate::version::detect_r;

fn start_kernel(connection_file: ConnectionFile, capture_streams: bool) {
    // Create a new kernel from the connection file
    let mut kernel = match Kernel::new(connection_file) {
        Ok(k) => k,
        Err(e) => {
            error!("Failed to create kernel: {}", e);
            return;
        },
    };

    // Create the channels used for communication. These are created here
    // as they need to be shared across different components / threads.
    let iopub_tx = kernel.create_iopub_tx();

    // A broadcast channel (bus) used to notify clients when the kernel
    // has finished initialization.
    let mut kernel_init_tx = Bus::new(1);

    // A channel pair used for shell requests.
    // These events are used to manage the runtime state, and also to
    // handle message delivery, among other things.
    let (shell_request_tx, shell_request_rx) = bounded::<Request>(1);

    // Create the LSP client.
    // Not all Amalthea kernels provide one, but ark does.
    // It must be able to deliver messages to the shell channel directly.
    let lsp = Arc::new(Mutex::new(lsp::handler::Lsp::new(
        shell_request_tx.clone(),
        kernel_init_tx.add_rx(),
    )));

    // Create the shell.
    let kernel_init_rx = kernel_init_tx.add_rx();
    let shell = Shell::new(
        iopub_tx,
        shell_request_tx,
        shell_request_rx,
        kernel_init_tx,
        kernel_init_rx,
    );

    // Create the control handler; this is used to handle shutdown/interrupt and
    // related requests
    let control = Arc::new(Mutex::new(Control::new(shell.request_tx())));

    // Create the stream behavior; this determines whether the kernel should
    // capture stdout/stderr and send them to the front end as IOPub messages
    let stream_behavior = match capture_streams {
        true => amalthea::kernel::StreamBehavior::Capture,
        false => amalthea::kernel::StreamBehavior::None,
    };

    // Create the kernel
    let shell = Arc::new(Mutex::new(shell));
    match kernel.connect(shell, control, Some(lsp), stream_behavior) {
        Ok(()) => {
            let mut s = String::new();
            println!("R Kernel exiting.");
            if let Err(err) = stdin().read_line(&mut s) {
                error!("Could not read from stdin: {:?}", err);
            }
        },
        Err(err) => {
            error!("Couldn't connect to front end: {:?}", err);
        },
    }
}

// Installs the kernelspec JSON file into one of Jupyter's search paths.
fn install_kernel_spec() {
    // Create the environment set for the kernel spec
    let mut env = serde_json::Map::new();

    // Detect the active version of R and set the R_HOME environment variable
    // accordingly
    let r_version = detect_r();
    env.insert(
        "R_HOME".to_string(),
        serde_json::Value::String(r_version.r_home.clone()),
    );

    // Create the kernelspec
    let exe_path = unwrap!(env::current_exe(), Err(error) => {
        eprintln!("Failed to determine path to Ark. {}", error);
        return;
    });

    let spec = KernelSpec {
        argv: vec![
            String::from(exe_path.to_string_lossy()),
            String::from("--connection_file"),
            String::from("{connection_file}"),
        ],
        language: String::from("R"),
        display_name: String::from("Amalthea R Kernel (ARK)"),
        env: env,
    };

    let dest = unwrap!(spec.install(String::from("ark")), Err(error) => {
        eprintln!("Failed to install Ark's Jupyter kernelspec. {}", error);
        return;
    });

    println!(
        "Successfully installed Ark Jupyter kernelspec.

    R:      {}
    Kernel: {}
    ",
        r_version.r_home,
        dest.to_string_lossy()
    );
}

fn parse_file(connection_file: &String, capture_streams: bool) {
    match ConnectionFile::from_file(connection_file) {
        Ok(connection) => {
            info!(
                "Loaded connection information from front-end in {}",
                connection_file
            );
            debug!("Connection data: {:?}", connection);
            start_kernel(connection, capture_streams);
        },
        Err(error) => {
            error!(
                "Couldn't read connection file {}: {:?}",
                connection_file, error
            );
        },
    }
}

fn print_usage() {
    println!("Ark {}, the Amalthea R Kernel.", env!("CARGO_PKG_VERSION"));
    println!(
        r#"
Usage: ark [OPTIONS]

Available options:

--connection_file FILE   Start the kernel with the given JSON connection file
                         (see the Jupyter kernel documentation for details)
--no-capture-streams     Do not capture stdout/stderr from R
--version                Print the version of Ark
--log FILE               Log to the given file (if not specified, stdout/stderr
                         will be used)
--install                Install the kernel spec for Ark
--help                   Print this help message
"#
    );
}

fn main() {
    #[cfg(target_os = "macos")]
    {
        // Unset DYLD_INSERT_LIBRARIES if it was passed down
        std::env::remove_var("DYLD_INSERT_LIBRARIES");
    }

    // Get an iterator over all the command-line arguments
    let mut argv = std::env::args();

    // Skip the first "argument" as it's the path/name to this executable
    argv.next();

    let mut connection_file: Option<String> = None;
    let mut log_file: Option<String> = None;
    let mut has_action = false;
    let mut capture_streams = true;

    // Process remaining arguments. TODO: Need an argument that can passthrough args to R
    while let Some(arg) = argv.next() {
        match arg.as_str() {
            "--connection_file" => {
                if let Some(file) = argv.next() {
                    connection_file = Some(file);
                    has_action = true;
                } else {
                    eprintln!(
                        "A connection file must be specified with the --connection_file argument."
                    );
                    break;
                }
            },
            "--version" => {
                println!("Ark {}", env!("CARGO_PKG_VERSION"));
                has_action = true;
            },
            "--install" => {
                install_kernel_spec();
                has_action = true;
            },
            "--help" => {
                print_usage();
                has_action = true;
            },
            "--no-capture-streams" => capture_streams = false,
            "--log" => {
                if let Some(file) = argv.next() {
                    log_file = Some(file);
                } else {
                    eprintln!("A log file must be specified with the --log argument.");
                    break;
                }
            },
            other => {
                eprintln!("Argument '{}' unknown", other);
                break;
            },
        }
    }

    // If the user didn't specify an action, print the usage instructions and
    // exit
    if !has_action {
        print_usage();
        return;
    }

    // Initialize the logger.
    logger::initialize(log_file.as_deref());

    // Initialize harp.
    harp::initialize();

    // Parse the connection file and start the kernel
    if let Some(connection) = connection_file {
        parse_file(&connection, capture_streams);
    }
}

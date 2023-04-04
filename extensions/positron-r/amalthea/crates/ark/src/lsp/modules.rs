//
// modules.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::protect::RProtect;
use harp::r_lock;
use harp::r_string;
use harp::r_symbol;
use libR_sys::*;
use stdext::local;
use stdext::spawn;
use stdext::unwrap::IntoResult;
use std::collections::HashMap;
use std::env;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;
use walkdir::WalkDir;

// We use a set of three environments for the functions exposed to
// the R session. The environment chain is:
//
//     [public] => [private] => [globalenv]
//
// The bindings are copied from the [public] environment, into
// the [attached] environment, which itself is placed on the
// search path.
//
// This modularity allows us to have certain 'private' functions which
// are visible to our Positron APIs, but not directly exposed to users.
// This is mainly useful when defining things like custom binary
// operators, or other helper functions which we prefer not hiding
// behind the '.ps.' prefix.
static mut POSITRON_PRIVATE_ENVIRONMENT: SEXP = std::ptr::null_mut();
static mut POSITRON_PUBLIC_ENVIRONMENT: SEXP = std::ptr::null_mut();
static mut POSITRON_ATTACHED_ENVIRONMENT: SEXP = std::ptr::null_mut();
pub const POSITRION_ATTACHED_ENVIRONMENT_NAME: &str = "tools:positron";

pub struct RModuleInfo {
    pub help_server_port: i32,
}

// NOTE: We use a custom watcher implementation here to detect changes
// to module files, and automatically source those files when they change.
//
// The intention here is to make it easy to iterate and develop R modules
// within Positron; files are automatically sourced when they change and
// so any changes should appear live within Positrion immediately.
//
// We can't use a crate like 'notify' here as the file watchers they try
// to add seem to conflict with the ones added by VSCode; at least, that's
// what I observed on macOS.
struct RModuleWatcher {
    pub path: PathBuf,
    pub cache: HashMap<PathBuf, std::fs::Metadata>,
}

impl RModuleWatcher {

    pub fn new(path: PathBuf) -> Self {
        Self {
            path: path,
            cache: HashMap::new(),
        }
    }

    pub fn watch(&mut self) -> anyhow::Result<()> {

        let public  = self.path.join("public");
        let private = self.path.join("private");

        // initialize
        for path in [public, private] {
            let entries = std::fs::read_dir(path)?;
            for entry in entries.into_iter() {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    let meta = path.metadata()?;
                    self.cache.insert(path, meta);
                }
            }
        }

        // start looking for changes
        loop {

            std::thread::sleep(Duration::from_secs(1));
            let status = local! {
                for (path, oldmeta) in self.cache.iter_mut() {
                    let newmeta = path.metadata()?;
                    if oldmeta.modified()? != newmeta.modified()? {
                        r_lock! {
                            if let Err(error) = import(path) {
                                log::error!("{}", error);
                            }
                        };
                        *oldmeta = newmeta;
                    }
                }
                anyhow::Ok(())
            };

            if let Err(error) = status {
                log::error!("[watcher] error detecting changes: {}", error);
            }

        }

    }

}

pub unsafe fn initialize() -> anyhow::Result<RModuleInfo> {

    // Create the 'private' Positron environment.
    let private = RFunction::new("base", "new.env")
        .param("parent", R_GlobalEnv)
        .call()?;

    // Create the 'public' Positron environment.
    let public = RFunction::new("base", "new.env")
        .param("parent", *private)
        .call()?;

    let mut protect = RProtect::new();

    // Save these environments.
    R_PreserveObject(*private);
    POSITRON_PRIVATE_ENVIRONMENT = *private;
    Rf_setAttrib(
        POSITRON_PRIVATE_ENVIRONMENT,
        r_symbol!("name"),
        r_string!("positron:private", &mut protect)
    );

    R_PreserveObject(*public);
    POSITRON_PUBLIC_ENVIRONMENT = *public;
    Rf_setAttrib(
        POSITRON_PUBLIC_ENVIRONMENT,
        r_symbol!("name"),
        r_string!("positron:public", &mut protect)
    );

    // Create the attached 'tools:positron' environment.
    let attached = RFunction::new("base", "attach")
        .param("what", R_NilValue)
        .param("name", POSITRION_ATTACHED_ENVIRONMENT_NAME)
        .call()?;

    R_PreserveObject(*attached);
    POSITRON_ATTACHED_ENVIRONMENT = *attached;

    // Get the path to the 'modules' directory, adjacent to the executable file.
    // This is where we place the R source files in packaged releases.
    let mut root = match env::current_exe() {
        Ok(exe_path) => exe_path.parent().unwrap().join("modules"),
        Err(error) => {
            log::warn!("Failed to get current exe path; can't find R modules");
            return Err(error.into());
        }
    };

    // If that path doesn't exist, we're probably running from source, so
    // look in the source tree (found via the 'CARGO_MANIFEST_DIR' environment
    // variable).
    if !root.exists() {
        let source = format!("{}/src/lsp/modules", env!("CARGO_MANIFEST_DIR"));
        root = Path::new(&source).to_path_buf();
    }

    // Import all module files.
    // TODO: Need to select appropriate path for package builds.
    log::info!("Loading modules from directory: {}", root.display());
    for file in WalkDir::new(root.clone()).into_iter().filter_map(|file| file.ok()) {
        let path = file.path();
        if let Some(ext) = path.extension() {
            if ext == "R" {
                import(path).unwrap();
            }
        }
    }

    // Create a directory watcher that reloads module files as they are changed.
    spawn!("ark-watcher", {
        let root = root.clone();
        move || {
            let mut watcher = RModuleWatcher::new(root);
            match watcher.watch() {
                Ok(_) => {},
                Err(error) => log::error!("[watcher] Error watching files: {}", error),
            }
        }
    });

    // Get the help server port.
    let help_server_port = RFunction::new("tools", "httpdPort")
        .call()?
        .to::<i32>()?;

    return Ok(RModuleInfo {
        help_server_port: help_server_port,
    });
}

pub unsafe fn import(file: &Path) -> anyhow::Result<()> {

    // Figure out if this is a 'private' or 'public' component.
    let parent = file.parent().into_result()?;
    let name = parent.file_name().into_result()?;
    let envir = if name == "private" {
        log::info!("Loading private module: {:?}", file);
        POSITRON_PRIVATE_ENVIRONMENT
    } else if name == "public" {
        log::info!("Loading public module: {:?}", file);
        POSITRON_PUBLIC_ENVIRONMENT
    } else {
        log::info!("Loading top-level module: {:?}", file);
        POSITRON_ATTACHED_ENVIRONMENT
    };

    // Source the file in the appropriate environment.
    let file = file.to_str().unwrap();
    RFunction::new("base", "sys.source")
        .param("file", file)
        .param("envir", envir)
        .call()?;

    // Get a list of bindings from the public environment.
    let bindings = RFunction::new("base", "as.list.environment")
        .param("x", POSITRON_PUBLIC_ENVIRONMENT)
        .param("all.names", true)
        .call()?;

    // Update bindings in the attached environment.
    // TODO: It might be fine to just do this only after importing
    // all files?
    RFunction::new("base", "list2env")
        .param("x", *bindings)
        .param("envir", POSITRON_ATTACHED_ENVIRONMENT)
        .call()?;

    Ok(())

}


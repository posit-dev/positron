//
// modules.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::r_lock;
use libR_sys::*;
use stdext::local;
use std::collections::HashMap;
use std::env;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;
use walkdir::WalkDir;

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
struct Watcher {
    pub path: PathBuf,
    pub cache: HashMap<PathBuf, std::fs::Metadata>,
}

impl Watcher {

    pub fn new(path: PathBuf) -> Self {
        Self {
            path: path,
            cache: HashMap::new(),
        }
    }

    pub fn watch(&mut self) -> anyhow::Result<()> {

        // initialize
        let entries = std::fs::read_dir(&self.path)?;
        for entry in entries.into_iter() {
            if let Ok(entry) = entry {
                let path = entry.path();
                let meta = path.metadata()?;
                self.cache.insert(path, meta);
            }
        }

        // start looking for changes
        loop {

            std::thread::sleep(Duration::from_secs(1));
            let status = local! {
                for (path, oldmeta) in self.cache.iter_mut() {
                    let newmeta = path.metadata()?;
                    if oldmeta.modified()? != newmeta.modified()? {
                        r_lock! { import(path) };
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

    // Ensure the 'tools:positron' environment has been initialized.
    RFunction::new("base", "attach")
        .param("what", R_NilValue)
        .param("name", "tools:positron")
        .call()?;

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
                import(path);
            }
        }
    }

    // Create a directory watcher that reloads module files as they are changed.
    std::thread::spawn({
        let root = root.clone();
        move || {
            let mut watcher = Watcher::new(root);
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

pub unsafe fn import(file: &Path) {

    log::info!("Loading module: {:?}", file);

    let envir = RFunction::new("base", "as.environment")
            .add("tools:positron")
            .call()
            .unwrap();

    let file = file.to_str().unwrap();
    RFunction::new("base", "sys.source")
        .param("file", file)
        .param("envir", envir)
        .call()
        .unwrap();

}


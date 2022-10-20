//
// log.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::fs::File;
use std::io::prelude::*;
use std::str::FromStr;
use std::sync::Mutex;
use std::sync::Once;
use std::time::SystemTime;

use chrono::DateTime;
use chrono::Utc;
use log::*;

struct Logger {
    mutex: Option<Mutex<File>>,
}

impl Logger {

    fn initialize(&mut self, log_file: &str) {

        let file = std::fs::OpenOptions::new()
            .write(true)
            .append(true)
            .create(true)
            .open(log_file)
            .unwrap();

        self.mutex = Some(Mutex::new(file));

    }

}

impl log::Log for Logger {

    fn enabled(&self, metadata: &Metadata) -> bool {
        match metadata.level() {
            Level::Error => true,
            Level::Warn => true,
            Level::Info => true,
            Level::Debug => false,
            Level::Trace => false,
        }
    }

    fn log(&self, record: &Record) {

        if !self.enabled(record.metadata()) {
            return;
        }

        // Acquire logging lock.
        let mut file = self.mutex.as_ref().unwrap().lock().unwrap();

        let now: DateTime<Utc> = SystemTime::now().into();
        let timestamp = now.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);

        writeln!(
            file,
            "{} [{}-{}] {} {}:{}: {}",
            timestamp,
            "ark",
            "unknown", // TODO: Current user?
            record.level(),
            record.file().unwrap_or("?"),
            record.line().unwrap_or(0),
            record.args()
        ).unwrap();

    }

    fn flush(&self) {
        if let Ok(mut file) = self.mutex.as_ref().unwrap().lock() {
            file.flush().unwrap();
        }
    }

}


pub fn initialize(log_file: &str) {

    ONCE.call_once(|| unsafe {

        // Set up the logger.
        LOGGER.initialize(log_file);
        log::set_logger(&LOGGER).unwrap();

        // Set the log level.
        let level = std::env::var("RUST_LOG").unwrap_or("info".into());
        if let Ok(level) = LevelFilter::from_str(level.as_str()) {
            log::set_max_level(level);
        } else {
            log::set_max_level(LevelFilter::Info);
        }

    });

}

static ONCE: Once = Once::new();
static mut LOGGER: Logger = Logger { mutex: None };

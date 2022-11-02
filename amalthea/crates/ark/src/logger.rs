//
// log.rs
//
// Copyright (C) 2022 by Posit, PBC
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
    level: log::Level,
    mutex: Option<Mutex<File>>,
}

impl Logger {

    fn initialize(&mut self, file: Option<&str>) {

        self.mutex = None;

        if let Some(file) = file {

            let file = std::fs::OpenOptions::new()
                .write(true)
                .append(true)
                .create(true)
                .open(file);

            match file {
                Ok(file) => self.mutex = Some(Mutex::new(file)),
                Err(error) => eprintln!("Error initializing log: {}", error),
            }

        }

    }

}

impl log::Log for Logger {

    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() as i32 <= self.level as i32
    }

    fn log(&self, record: &Record) {

        if !self.enabled(record.metadata()) {
            return;
        }

        // Generate timestamp.
        let now: DateTime<Utc> = SystemTime::now().into();
        let timestamp = now.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);

        // Generate message to log.
        let message = format!(
            "{} [{}-{}] {} {}:{}: {}",
            timestamp,
            "ark",
            "unknown", // TODO: Current user?
            record.level(),
            record.file().unwrap_or("?"),
            record.line().unwrap_or(0),
            record.args()
        );

        // Write to stdout.
        if record.level() == Level::Error {
            eprintln!("{}", message);
        } else {
            println!("{}", message);
        }

        // Also write to log file if enabled.
        if let Some(mutex) = self.mutex.as_ref() {
            if let Ok(mut file) = mutex.lock() {
                let status = writeln!(file, "{}", message);
                if let Err(error) = status {
                    eprintln!("Error writing to log file: {}", error);
                }
            }
        }

    }

    fn flush(&self) {
        if let Ok(mut file) = self.mutex.as_ref().unwrap().lock() {
            file.flush().unwrap();
        }
    }

}


pub fn initialize(file: Option<&str>) {

    ONCE.call_once(|| {

        // Initialize the log level, using RUST_LOG.
        log::set_max_level(LevelFilter::Info);
        let level = std::env::var("RUST_LOG").unwrap_or("info".into());
        match LevelFilter::from_str(level.as_str()) {
            Ok(level) => log::set_max_level(level),
            Err(error) => eprintln!("Error parsing RUST_LOG: {}", error),
        }

        // Set up the logger.
        unsafe {
            LOGGER.initialize(file);
            log::set_logger(&LOGGER).unwrap();
        }

    });

}

static ONCE: Once = Once::new();
static mut LOGGER: Logger = Logger { mutex: None, level: Level::Info };

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
use lazy_static::lazy_static;
use regex::Regex;

lazy_static! {
    static ref RE_ARK_BACKTRACE : Regex = Regex::new("^\\s*\\d+:\\s*[<]?ark::").unwrap();
    static ref RE_BACKTRACE_HEADER : Regex = Regex::new("^\\s*Stack\\s+backtrace:?\\s*$").unwrap();
}

// Entry-point for logging methods.
pub fn _log_impl(level: log::Level, mut message: String) {

    // split into lines
    let mut lines = message.split("\n").collect::<Vec<_>>();

    let mut occurred: Option<String> = None;
    let mut backtrace_index: Option<usize> = None;

    // look for a backtrace entry for ark
    for (index, line) in lines.iter().enumerate() {

        if let Some(_) = RE_BACKTRACE_HEADER.find(line) {
            backtrace_index = Some(index);
            continue;
        }

        if let Some(_) = RE_ARK_BACKTRACE.find(line) {
            occurred = Some(lines[index..=index+1].join("\n"));
            break;
        }

    }

    // if we found the backtrace entry, include it within the log output
    if let Some(occurred) = occurred {
        if let Some(index) = backtrace_index {
            let insertion = ["Occurred at:", occurred.as_str(), ""].join("\n");
            lines.insert(index, insertion.as_str());
            message = lines.join("\n");
        }
    }

    // log it
    ::log::log!(level, "{}", message)

}

// Logging macros used so we can more easily append information about
// where an error occurred. Uses the backtrace information provided
// by anyhow when available.
#[macro_export]
macro_rules! error {
    ($($tokens:tt)*) => {{
        let message = format!($($tokens)*);
        $crate::log::_log_impl(::log::Level::Error, message)
    }}
}

#[macro_export]
macro_rules! warn {
    ($($tokens:tt)*) => {{
        let message = format!($($tokens)*);
        $crate::log::_log_impl(::log::Level::Warn, message)
    }}
}

#[macro_export]
macro_rules! info {
    ($($tokens:tt)*) => {{
        let message = format!($($tokens)*);
        $crate::log::_log_impl(::log::Level::Info, message)
    }}
}

#[macro_export]
macro_rules! debug {
    ($($tokens:tt)*) => {{
        let message = format!($($tokens)*);
        $crate::log::_log_impl(::log::Level::Debug, message)
    }}
}

#[macro_export]
macro_rules! trace {
    ($($tokens:tt)*) => {{
        let message = format!($($tokens)*);
        $crate::log::_log_impl(::log::Level::Trace, message)
    }}
}

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

    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() as i32 <= self.level as i32
    }

    fn log(&self, record: &log::Record) {

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
        if record.level() == log::Level::Error {
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
        log::set_max_level(log::LevelFilter::Info);
        let level = std::env::var("RUST_LOG").unwrap_or("info".into());
        match log::LevelFilter::from_str(level.as_str()) {
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
static mut LOGGER: Logger = Logger { mutex: None, level: log::Level::Info };

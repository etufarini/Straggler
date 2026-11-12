use crate::{workspace::Listener, Result};
use std::{
    collections::BTreeSet,
    fs,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::fs::MetadataExt,
    },
};

pub fn available_memory() -> Option<u64> {
    fs::read_to_string("/proc/meminfo")
        .ok()?
        .lines()
        .find_map(|line| {
            line.strip_prefix("MemAvailable:")?
                .split_whitespace()
                .next()?
                .parse::<u64>()
                .ok()
                .map(|kib| kib / 1024)
        })
}

pub fn identity(pid: u32) -> Option<Listener> {
    let root = format!("/proc/{pid}");
    let stat = fs::read_to_string(format!("{root}/stat")).ok()?;
    let (_, fields) = stat.rsplit_once(") ")?;
    let values: Vec<_> = fields.split_whitespace().collect();
    if values.first() == Some(&"Z") {
        return None;
    }
    let start = values.get(19)?;
    let program = fs::read_link(format!("{root}/exe"))
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| {
            stat.split_once('(')
                .map(|(_, rest)| {
                    rest.rsplit_once(") ")
                        .map_or(rest, |(name, _)| name)
                        .to_owned()
                })
                .unwrap_or_default()
        });
    let uid = fs::metadata(&root).ok()?.uid();
    Some(Listener {
        pid,
        identity: format!("{pid}:{start}"),
        details: format!("{pid} UID {uid} {program}"),
    })
}

fn socket_inodes(port: u16) -> BTreeSet<String> {
    let mut inodes = BTreeSet::new();
    for table in ["/proc/net/tcp", "/proc/net/tcp6"] {
        if let Ok(data) = fs::read_to_string(table) {
            for line in data.lines().skip(1) {
                let columns: Vec<_> = line.split_whitespace().collect();
                if columns.len() < 10 || columns[3] != "0A" {
                    continue;
                }
                let local_port = columns[1]
                    .rsplit_once(':')
                    .and_then(|(_, value)| u16::from_str_radix(value, 16).ok());
                if local_port == Some(port) {
                    inodes.insert(format!("socket:[{}]", columns[9]));
                }
            }
        }
    }
    inodes
}

pub fn listeners(port: u16) -> Vec<Listener> {
    let inodes = socket_inodes(port);
    if inodes.is_empty() {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir("/proc") else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u32>().ok())
        else {
            continue;
        };
        let Some(before) = identity(pid) else {
            continue;
        };
        let Ok(descriptors) = fs::read_dir(entry.path().join("fd")) else {
            continue;
        };
        let owns_socket = descriptors
            .flatten()
            .filter_map(|fd| fs::read_link(fd.path()).ok())
            .any(|link| inodes.contains(link.to_string_lossy().as_ref()));
        if owns_socket && identity(pid).is_some_and(|after| after.identity == before.identity) {
            result.push(before);
        }
    }
    result.sort_by_key(|listener| listener.pid);
    result
}

pub fn signal_listener(target: &Listener, signal: i32) -> Result<()> {
    let descriptor = unsafe { libc::syscall(libc::SYS_pidfd_open, target.pid, 0) };
    if descriptor < 0 {
        return Err(format!(
            "Cannot identify PID {} for shutdown: {}",
            target.pid,
            std::io::Error::last_os_error()
        ));
    }
    let descriptor = unsafe { OwnedFd::from_raw_fd(descriptor as i32) };
    if identity(target.pid).is_none_or(|current| current.identity != target.identity) {
        return Ok(());
    }
    // pidfd ties signaling to the opened process even if the numeric PID is reused.
    let result = unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            descriptor.as_raw_fd(),
            signal,
            std::ptr::null::<libc::siginfo_t>(),
            0,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "Cannot stop PID {}: {}",
            target.pid,
            std::io::Error::last_os_error()
        ))
    }
}

//! Native operating system services; shared configuration never invokes OS utilities.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
pub use linux::{available_memory, identity, listeners, signal_listener};
#[cfg(target_os = "macos")]
pub use macos::{available_memory, identity, listeners, signal_listener};

use crate::{workspace::Listener, Result};
use socket2::{Domain, Protocol, Socket, Type};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};

pub struct Port {
    pub occupied: bool,
    pub listeners: Vec<Listener>,
}

pub fn inspect_port(port: u16) -> Result<Port> {
    let mut occupied = false;
    for address in [
        std::net::IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        std::net::IpAddr::V6(Ipv6Addr::UNSPECIFIED),
    ] {
        let reserve = || -> std::io::Result<Socket> {
            let socket = Socket::new(
                if address.is_ipv4() {
                    Domain::IPV4
                } else {
                    Domain::IPV6
                },
                Type::STREAM,
                Some(Protocol::TCP),
            )?;
            socket.set_reuse_address(true)?;
            if address.is_ipv6() {
                socket.set_only_v6(true)?;
            }
            socket.bind(&SocketAddr::new(address, port).into())?;
            socket.listen(1)?;
            Ok(socket)
        };
        match reserve() {
            Ok(reservation) => drop(reservation),
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => occupied = true,
            Err(error)
                if matches!(
                    error.raw_os_error(),
                    Some(libc::EAFNOSUPPORT | libc::EPROTONOSUPPORT)
                ) => {}
            Err(error) => return Err(format!("Unable to inspect port {port}: {error}")),
        }
    }
    // A hidden owner never makes an occupied port available.
    Ok(Port {
        occupied,
        listeners: if occupied {
            listeners(port)
        } else {
            Vec::new()
        },
    })
}

pub fn stop_listeners(port: u16, targets: &[Listener], signal: i32) -> Result<()> {
    if !matches!(signal, libc::SIGTERM | libc::SIGKILL) || targets.is_empty() {
        return Err("Invalid process shutdown request.".into());
    }
    let current = inspect_port(port)?;
    let mut failures = Vec::new();
    for target in targets {
        if target.pid <= 1 || target.pid == std::process::id() {
            continue;
        }
        if current
            .listeners
            .iter()
            .any(|listener| listener.pid == target.pid && listener.identity == target.identity)
            && identity(target.pid).is_some_and(|listener| listener.identity == target.identity)
        {
            if let Err(error) = signal_listener(target, signal) {
                failures.push(error);
            }
        }
    }
    if !failures.is_empty() {
        return Err(failures.join("\n"));
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    while targets.iter().any(|target| {
        identity(target.pid).is_some_and(|current| current.identity == target.identity)
    }) && std::time::Instant::now() < deadline
    {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Ok(())
}

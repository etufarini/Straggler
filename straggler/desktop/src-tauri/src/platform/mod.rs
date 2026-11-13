//! Native operating system services; shared configuration never invokes OS utilities.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
pub use linux::{
    available_memory, bundled_server, identity, listeners, rename_directory_exclusive,
    signal_listener,
};
#[cfg(target_os = "macos")]
pub use macos::{
    available_memory, bundled_server, identity, listeners, rename_directory_exclusive,
    signal_listener,
};

use crate::{workspace::Listener, Result};
use socket2::{Domain, Protocol, Socket, Type};
use std::{
    collections::BTreeSet,
    net::{Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV6},
};

pub struct Port {
    pub occupied: bool,
    pub listeners: Vec<Listener>,
}

fn bind_addresses(port: u16) -> Result<BTreeSet<SocketAddr>> {
    let mut addresses = BTreeSet::from([
        SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)),
        SocketAddr::from((Ipv6Addr::UNSPECIFIED, port)),
    ]);
    let mut head = std::ptr::null_mut();
    if unsafe { libc::getifaddrs(&mut head) } != 0 {
        return Err(format!(
            "Unable to inspect local addresses: {}",
            std::io::Error::last_os_error()
        ));
    }
    struct Interfaces(*mut libc::ifaddrs);
    impl Drop for Interfaces {
        fn drop(&mut self) {
            unsafe { libc::freeifaddrs(self.0) };
        }
    }
    let interfaces = Interfaces(head);
    let mut current = interfaces.0;
    while !current.is_null() {
        // getifaddrs owns this list until the guard drops; sa_family selects
        // the sockaddr layout, including the scope ID for IPv6 link-local IPs.
        unsafe {
            let interface = &*current;
            if !interface.ifa_addr.is_null() {
                match i32::from((*interface.ifa_addr).sa_family) {
                    libc::AF_INET => {
                        let address = &*interface.ifa_addr.cast::<libc::sockaddr_in>();
                        addresses.insert(SocketAddr::from((
                            Ipv4Addr::from(address.sin_addr.s_addr.to_ne_bytes()),
                            port,
                        )));
                    }
                    libc::AF_INET6 => {
                        let address = &*interface.ifa_addr.cast::<libc::sockaddr_in6>();
                        addresses.insert(SocketAddr::V6(SocketAddrV6::new(
                            Ipv6Addr::from(address.sin6_addr.s6_addr),
                            port,
                            0,
                            address.sin6_scope_id,
                        )));
                    }
                    _ => {}
                }
            }
            current = interface.ifa_next;
        }
    }
    Ok(addresses)
}

pub fn inspect_port(port: u16) -> Result<Port> {
    let mut occupied = false;
    // On macOS a reused wildcard bind can coexist with a specific listener.
    // Probe each assigned address even when process attribution is unavailable.
    for address in bind_addresses(port)? {
        let reserve = || -> std::io::Result<Socket> {
            let socket = Socket::new(
                Domain::for_address(address),
                Type::STREAM,
                Some(Protocol::TCP),
            )?;
            socket.set_reuse_address(true)?;
            if address.is_ipv6() {
                socket.set_only_v6(true)?;
            }
            socket.bind(&address.into())?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::{TcpListener, TcpStream};

    #[test]
    fn occupied_ports_are_detected_on_wildcard_and_assigned_addresses() {
        for address in bind_addresses(0).unwrap() {
            let socket = Socket::new(
                Domain::for_address(address),
                Type::STREAM,
                Some(Protocol::TCP),
            )
            .unwrap();
            socket.set_reuse_address(true).unwrap();
            if address.is_ipv6() {
                socket.set_only_v6(true).unwrap();
            }
            socket.bind(&address.into()).unwrap();
            socket.listen(1).unwrap();
            let port = socket.local_addr().unwrap().as_socket().unwrap().port();
            assert!(
                inspect_port(port).unwrap().occupied,
                "Missed listener at {address}"
            );
            drop(socket);
            assert!(
                !inspect_port(port).unwrap().occupied,
                "Closed listener at {address}"
            );
        }
    }

    #[test]
    fn closed_connections_do_not_block_server_port_reuse() {
        let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP)).unwrap();
        socket.set_reuse_address(true).unwrap();
        socket
            .bind(&SocketAddr::from((Ipv4Addr::LOCALHOST, 0)).into())
            .unwrap();
        socket.listen(1).unwrap();
        let listener = TcpListener::from(socket);
        let address = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(address).unwrap();
        let (accepted, _) = listener.accept().unwrap();
        drop(accepted);
        client.read_to_end(&mut Vec::new()).unwrap();
        drop(client);
        drop(listener);
        assert!(!inspect_port(address.port()).unwrap().occupied);
        let restarted = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP)).unwrap();
        restarted.set_reuse_address(true).unwrap();
        restarted.bind(&address.into()).unwrap();
        restarted.listen(1).unwrap();
    }
}

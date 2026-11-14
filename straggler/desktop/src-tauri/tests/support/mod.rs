use socket2::{Domain, Protocol, Socket, Type};
use std::{
    net::TcpListener,
    sync::atomic::{AtomicU16, Ordering},
};
use straggler_desktop::platform;

static NEXT_SERVER_PORT: AtomicU16 = AtomicU16::new(20000);

pub fn reserve_server_port() -> TcpListener {
    reserve_port_from(&NEXT_SERVER_PORT)
}

pub fn reserve_port_from(next_port: &AtomicU16) -> TcpListener {
    // Keep server fixtures outside the default Linux/macOS ephemeral ranges:
    // concurrent HTTP clients can otherwise claim a released reservation before startup.
    loop {
        let port = next_port.fetch_add(1, Ordering::Relaxed);
        assert!(port < 30000, "No fixture server ports available");
        // Match native startup: an IPv6 or another assigned-address listener
        // also blocks launch even when IPv4 loopback can be reserved.
        if platform::inspect_port(port).unwrap().occupied {
            continue;
        }
        // Do not reuse TIME_WAIT ports: the unrelated-listener fixture uses
        // an exclusive socket, unlike Rust's TcpListener::bind on Unix.
        let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP)).unwrap();
        let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        match socket.bind(&address.into()) {
            Ok(()) => {
                socket.listen(1).unwrap();
                return socket.into();
            }
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(error) => panic!("Cannot reserve fixture server port {port}: {error}"),
        }
    }
}

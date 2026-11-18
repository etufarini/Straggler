use crate::{workspace::Listener, Result};
use libproc::{
    bsd_info::BSDInfo,
    file_info::{pidfdinfo, ListFDs, ProcFDType},
    net_info::{SocketFDInfo, SocketInfoKind, TcpSIState},
    proc_pid::{listpidinfo, pidinfo, pidpath},
    processes::{pids_by_type, ProcFilter},
};
use std::{
    ffi::CString,
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
};

pub fn rename_directory_exclusive(source: &Path, destination: &Path) -> std::io::Result<()> {
    let source = CString::new(source.as_os_str().as_bytes())?;
    let destination = CString::new(destination.as_os_str().as_bytes())?;
    let result =
        unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

pub fn bundled_server(executable: &Path) -> Option<PathBuf> {
    let server = executable.parent()?.join("straggler-llama-server");
    server.is_file().then_some(server)
}

#[allow(deprecated)] // libc deprecates its Mach bindings, not the public macOS APIs.
pub fn available_memory() -> Option<u64> {
    static HOST: std::sync::OnceLock<libc::mach_port_t> = std::sync::OnceLock::new();
    // Retain one host send right for the process lifetime, rather than acquiring
    // another on each refresh. Unavailable statistics never block controls.
    let host = *HOST.get_or_init(|| unsafe { libc::mach_host_self() });
    let mut statistics: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
    let mut count = libc::HOST_VM_INFO64_COUNT;
    let status = unsafe {
        libc::host_statistics64(
            host,
            libc::HOST_VM_INFO64,
            (&mut statistics as *mut libc::vm_statistics64).cast(),
            &mut count,
        )
    };
    if status != 0 {
        return None;
    }
    let pages = u64::from(statistics.free_count)
        .checked_add(u64::from(statistics.inactive_count))?
        .checked_add(u64::from(statistics.speculative_count))?;
    let page_size = unsafe { libc::vm_page_size } as u64;
    (page_size > 0).then_some(pages.checked_mul(page_size)? / (1024 * 1024))
}

pub fn identity(pid: u32) -> Option<Listener> {
    let info = pidinfo::<BSDInfo>(pid as i32, 0).ok()?;
    let program = pidpath(pid as i32).unwrap_or_default();
    Some(Listener {
        pid,
        identity: format!("{pid}:{}:{}", info.pbi_start_tvsec, info.pbi_start_tvusec),
        details: format!("{pid} UID {} {program}", info.pbi_uid),
    })
}

pub fn listeners(port: u16) -> Vec<Listener> {
    let Ok(pids) = pids_by_type(ProcFilter::All) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for pid in pids {
        let Some(before) = identity(pid) else {
            continue;
        };
        let Ok(info) = pidinfo::<BSDInfo>(pid as i32, 0) else {
            continue;
        };
        let Ok(descriptors) = listpidinfo::<ListFDs>(pid as i32, info.pbi_nfiles as usize) else {
            continue;
        };
        for descriptor in descriptors
            .into_iter()
            .filter(|descriptor| descriptor.proc_fdtype == ProcFDType::Socket as u32)
        {
            let Ok(socket) = pidfdinfo::<SocketFDInfo>(pid as i32, descriptor.proc_fd) else {
                continue;
            };
            if socket.psi.soi_kind != SocketInfoKind::Tcp as i32 {
                continue;
            }
            // soi_kind selects the active union member returned by libproc.
            let tcp = unsafe { socket.psi.soi_proto.pri_tcp };
            if tcp.tcpsi_state == TcpSIState::Listen as i32
                && u16::from_be(tcp.tcpsi_ini.insi_lport as u16) == port
                && identity(pid).is_some_and(|after| after.identity == before.identity)
            {
                result.push(before);
                break;
            }
        }
    }
    result.sort_by_key(|listener| listener.pid);
    result
}

pub fn signal_listener(target: &Listener, signal: i32) -> Result<()> {
    if identity(target.pid).is_none_or(|current| current.identity != target.identity) {
        return Ok(());
    }
    if unsafe { libc::kill(target.pid as i32, signal) } == 0 {
        Ok(())
    } else {
        Err(format!(
            "Cannot stop PID {}: {}",
            target.pid,
            std::io::Error::last_os_error()
        ))
    }
}

pub fn open_web_url(url: &str) -> crate::Result<()> {
    let status = std::process::Command::new("open")
        .arg(url)
        .status()
        .map_err(|_| "The default app could not be opened.")?;
    if status.success() {
        Ok(())
    } else {
        Err("The default app could not open this link.".into())
    }
}

use mir_desktop::platform;
use std::fs;

#[test]
fn exclusive_directory_activation_preserves_existing_entries() {
    let work = tempfile::tempdir().unwrap();
    let source = work.path().join("prepared settings");
    let destination = work.path().join("saved settings");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("paths.conf"), b"prepared").unwrap();
    // Even an empty directory must be preserved if another process created it.
    fs::create_dir(&destination).unwrap();
    let error = platform::rename_directory_exclusive(&source, &destination).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(fs::read(source.join("paths.conf")).unwrap(), b"prepared");
    assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
    fs::remove_dir(&destination).unwrap();
    platform::rename_directory_exclusive(&source, &destination).unwrap();
    assert!(!source.exists());
    assert_eq!(
        fs::read(destination.join("paths.conf")).unwrap(),
        b"prepared"
    );
}

#[test]
fn bundled_backend_resolution_uses_the_executable_layout() {
    let work = tempfile::tempdir().unwrap();
    let directory = work.path().join("application with spaces/bin");
    fs::create_dir_all(&directory).unwrap();
    let executable = directory.join("mir");
    let adjacent = directory.join("mir-llama-server");
    let packaged = directory.join("../lib/mir.cpp/backend/llama-server");
    assert!(platform::bundled_server(&executable).is_none());
    fs::create_dir_all(packaged.parent().unwrap()).unwrap();
    fs::write(&packaged, b"fixture").unwrap();
    #[cfg(target_os = "linux")]
    assert_eq!(
        platform::bundled_server(&executable),
        Some(packaged.clone())
    );
    #[cfg(target_os = "macos")]
    assert!(platform::bundled_server(&executable).is_none());
    fs::write(&adjacent, b"fixture").unwrap();
    assert_eq!(
        platform::bundled_server(&executable),
        Some(adjacent.clone())
    );
    fs::remove_file(&adjacent).unwrap();
    fs::create_dir(&adjacent).unwrap();
    #[cfg(target_os = "linux")]
    assert_eq!(platform::bundled_server(&executable), Some(packaged));
    #[cfg(target_os = "macos")]
    assert!(platform::bundled_server(&executable).is_none());
}

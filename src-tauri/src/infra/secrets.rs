#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use anyhow::anyhow;
use anyhow::Result;

const SERVICE: &str = "com.herdock.desktop";

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn set_secret(reference: &str, value: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, reference)?;
    entry.set_password(value)?;
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn get_secret(reference: &str) -> Result<Option<String>> {
    let entry = keyring::Entry::new(SERVICE, reference)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn delete_secret(reference: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, reference)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn set_secret(_reference: &str, _value: &str) -> Result<()> {
    Err(anyhow!(
        "system credential storage is supported on Windows and macOS"
    ))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn get_secret(_reference: &str) -> Result<Option<String>> {
    Ok(None)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn delete_secret(_reference: &str) -> Result<()> {
    Ok(())
}

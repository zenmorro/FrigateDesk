//! Thin wrapper over the OS credential store (Windows Credential Manager via
//! the `keyring` crate). Passwords are NEVER written to disk in plaintext.

use crate::error::AppResult;

const SERVICE: &str = "FrigateDesk";

/// Store (or replace) the password for a given profile id.
pub fn set_password(profile_id: &str, password: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE, profile_id)?;
    entry.set_password(password)?;
    Ok(())
}

/// Retrieve the password for a profile id, if one is stored.
pub fn get_password(profile_id: &str) -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(SERVICE, profile_id)?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Remove the stored password for a profile id (no-op if absent).
pub fn delete_password(profile_id: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE, profile_id)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

use rusqlite::{Error as SqliteError, ErrorCode};

pub fn is_unusable_sqlite_database_error(error: &SqliteError) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt)
    ) || is_unusable_sqlite_database_message(&error.to_string())
}

pub fn is_unusable_sqlite_database_message(message: &str) -> bool {
    let lowered = message.to_ascii_lowercase();
    lowered.contains("file is not a database")
        || lowered.contains("not a database")
        || lowered.contains("database disk image is malformed")
}
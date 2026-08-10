use crate::domain::models::CommandError;

pub type CommandResult<T> = Result<T, CommandError>;

pub fn err(error: impl std::fmt::Display) -> CommandError {
    CommandError::from_message(error.to_string())
}

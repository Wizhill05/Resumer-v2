/** Error code the backend proxy returns when the session's account is scheduled for deletion. */
export const ACCOUNT_PENDING_DELETION = "account_pending_deletion"

/** auth_error code shown on the homepage right after a user schedules their own deletion. */
export const ACCOUNT_DELETION_SCHEDULED = "account_deletion_scheduled"

/** Days between the request and permanent deletion. Mirrors GRACE_PERIOD in the backend. */
export const DELETION_GRACE_DAYS = 7

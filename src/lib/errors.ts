function readErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error) {
    const parts: string[] = [];
    if ('message' in error && error.message) parts.push(String(error.message));
    if ('details' in error && error.details) parts.push(String(error.details));
    if ('hint' in error && error.hint) parts.push(String(error.hint));
    if ('code' in error && error.code) parts.push(`code=${String(error.code)}`);
    if (parts.length) return parts.join(' | ');
  }
  if (error instanceof Error) return error.message;
  return '';
}

function isNetworkError(message: string): boolean {
  return message.includes('fetch') || message.includes('network') || message.includes('failed to send');
}

/** Maps backend failures to an allow-list of user-safe messages. Never return raw backend text here. */
export function getErrorMessage(error: unknown): string {
  const message = readErrorMessage(error).toLowerCase();
  if (message.includes('branches_one_main_branch')) return 'Only one branch can be marked as the Main Branch.';
  if (message.includes('branches_code_unique_ci')) return 'That branch code is already in use.';
  if (message.includes('products_sku_unique_ci')) return 'That SKU is already in use.';
  if (message.includes('products_name_unique_ci')) return 'A product with that name already exists.';
  if (message.includes('unauthorized') || message.includes('permission denied') || message.includes('owner access')) return 'You are not authorized to perform this action.';
  if (message.includes('inactive account') || message.includes('profile is inactive')) return 'This account is inactive. Contact the owner.';
  if (isNetworkError(message)) return 'Unable to connect. Check your internet connection and try again.';
  return 'Something went wrong. Please try again.';
}

export function getAuthErrorMessage(error: unknown): string {
  const message = readErrorMessage(error).toLowerCase();

  if (message.includes('invalid login credentials')) {
    return 'The email or password is incorrect.';
  }
  if (message.includes('email not confirmed')) {
    return 'This account has not been confirmed yet.';
  }
  if (message.includes('inactive account') || message.includes('profile is inactive')) {
    return 'This account is inactive. Contact the owner.';
  }
  if (isNetworkError(message)) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  return 'Unable to sign in. Please try again.';
}

export function getChangePasswordErrorMessage(error: unknown): string {
  const message = readErrorMessage(error).toLowerCase();

  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid_credentials') ||
    message.includes('invalid credentials')
  ) {
    return 'Current password is incorrect.';
  }
  if (
    message.includes('session has expired') ||
    message.includes('auth session missing') ||
    message.includes('jwt expired') ||
    message.includes('not authenticated')
  ) {
    return 'Your session has expired. Sign in again.';
  }
  if (
    message.includes('different from the old') ||
    message.includes('same as the old') ||
    message.includes('should be different')
  ) {
    return 'New password must be different from the current password.';
  }
  if (
    message.includes('leaked') ||
    message.includes('pwned') ||
    message.includes('weak') ||
    message.includes('at least') ||
    message.includes('too short') ||
    message.includes('characters')
  ) {
    return 'New password does not meet the password policy. Use 8 to 72 characters.';
  }
  if (isNetworkError(message)) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  return 'The password could not be changed. Please try again.';
}

export function getChangeEmailErrorMessage(error: unknown): string {
  const message = readErrorMessage(error).toLowerCase();

  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid_credentials') ||
    message.includes('invalid credentials')
  ) {
    return 'Current password is incorrect.';
  }
  if (
    message.includes('session has expired') ||
    message.includes('auth session missing') ||
    message.includes('jwt expired') ||
    message.includes('not authenticated')
  ) {
    return 'Your session has expired. Sign in again.';
  }
  if (
    message.includes('unauthorized') ||
    message.includes('main branch manager') ||
    message.includes('limited to the owner')
  ) {
    return 'You are not authorized to change this email.';
  }
  if (
    message.includes('already registered') ||
    message.includes('already been registered') ||
    message.includes('already exists')
  ) {
    return 'That email is already registered.';
  }
  if (
    message.includes('different from the current') ||
    message.includes('same as the current') ||
    message.includes('must be different')
  ) {
    return 'New email must be different from the current email.';
  }
  if (message.includes('do not match')) {
    return 'Emails do not match.';
  }
  if (
    message.includes('invalid email') ||
    message.includes('email address is invalid') ||
    message.includes('unable to validate email') ||
    message.includes('valid email')
  ) {
    return 'Enter a valid email address.';
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return 'Too many email-change attempts. Please try again later.';
  }
  if (isNetworkError(message)) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  return 'The email could not be changed. Please try again.';
}

export function getChangeNameErrorMessage(error: unknown): string {
  const message = readErrorMessage(error).toLowerCase();

  if (
    message.includes('session has expired') ||
    message.includes('auth session missing') ||
    message.includes('jwt expired') ||
    message.includes('not authenticated') ||
    message.includes('authentication is required')
  ) {
    return 'Your session has expired. Sign in again.';
  }
  if (message.includes('between 2 and 120') || message.includes('full name')) {
    return 'Enter a name with 2 to 120 characters.';
  }
  if (message.includes('account profile was not found')) {
    return 'Your account profile was not found.';
  }
  if (isNetworkError(message)) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  return 'Your name could not be updated. Please try again.';
}

export function getInventoryErrorMessage(error: unknown): string {
  const message = readErrorMessage(error).toLowerCase();

  if (message.includes('at least one item') || message.includes('requires an actual received')) {
    return 'This shipment could not be finalized. Pull to refresh and try again.';
  }
  if (message.includes('insufficient stock')) return 'There is not enough stock to complete this operation.';
  if (message.includes('already been received') || message.includes('not pending receipt')) {
    return 'This transfer has already been received.';
  }
  if (message.includes('duplicate key') || message.includes('transfer_once') || message.includes('code=23505')) {
    return 'This transfer has already been received.';
  }
  if (message.includes('another branch')) return 'You cannot receive a transfer assigned to another branch.';
  if (message.includes('destination branch')) return 'The destination branch is inactive or invalid.';
  if (message.includes('product is missing or inactive')) return 'A selected product is inactive or unavailable.';
  if (message.includes('opening stock has already')) return 'Opening stock was already initialized for a selected product.';
  if (message.includes('describe what is wrong')) {
    return 'Describe what is wrong with the shipment before confirming the issue.';
  }
  if (message.includes('different quantity than sent')) {
    return 'Enter a quantity that differs from the sent amount, or confirm the shipment arrived as sent.';
  }
  if (message.includes('cashier confirmation') || message.includes('cashier shipment confirmation')) {
    return 'This branch uses cashier confirmation. Open Incoming and tap Shipment Arrived.';
  }
  if (message.includes('counted manager receive')) {
    return 'This branch uses cashier confirmation. Open Incoming and tap Shipment Arrived.';
  }
  if (message.includes('invalid request key')) return 'The request expired. Tap Shipment Arrived again.';
  if (message.includes('unable to load transfer')) return 'That shipment could not be loaded. Pull to refresh and try again.';
  if (
    message.includes('invalid input syntax') ||
    message.includes('uuid') ||
    message.includes('22p02')
  ) {
    return 'That shipment could not be loaded. Pull to refresh and try again.';
  }
  if (
    message.includes('jwt') ||
    message.includes('session') ||
    message.includes('not authenticated') ||
    message.includes('sign in required')
  ) {
    return 'Your session expired. Sign out, sign back in, then confirm the shipment.';
  }
  if (
    message.includes('schema cache') ||
    message.includes('could not find the function') ||
    message.includes('pgrst202') ||
    message.includes('pgrst203')
  ) {
    return 'The app is out of date with the server. Update the app or try again shortly.';
  }
  if (message.includes('positive') || message.includes('zero or greater')) return 'Enter a valid quantity.';
  if (message.includes('unauthorized') || message.includes('permission') || message.includes('42501')) {
    return 'You are not authorized to perform this action.';
  }
  if (message.includes('fetch') || message.includes('network')) {
    return 'Network unavailable. Check your connection and try again.';
  }
  return 'The inventory operation could not be completed. No stock was changed.';
}

export function getShiftErrorMessage(error: unknown): string {
  const raw = readErrorMessage(error);
  const message = raw.toLowerCase();
  if (message.includes('unfinished cart')) return 'Clear the unfinished cart before ending the shift.';
  if (message.includes('sale confirmation')) return 'Finish the sale confirmation before ending the shift.';
  if (message.includes('cashier access') || message.includes('unable to access')) return 'You are not authorized to use this shift.';
  if (message.includes('assigned branch') || message.includes('inactive or invalid')) return 'Your assigned branch is unavailable. Contact the owner.';
  if (message.includes('closed shift')) return 'This shift is already closed.';
  if (message.includes('fetch') || message.includes('network')) return 'Network unavailable. Check your connection and try again.';
  return 'The shift could not be updated. Please try again.';
}

export type CheckoutFailure = {
  message: string;
  preserveRequest: boolean;
};

/** Keeps an identical idempotent request available when the outcome is unknown or retryable. */
export function getCheckoutFailure(error: unknown): CheckoutFailure {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const definitivelyRejected = ['22023', '42501', '23514', '22003'].includes(code);
  return definitivelyRejected
    ? {
        message: `${getInventoryErrorMessage(error)} Review the order and try again.`,
        preserveRequest: false,
      }
    : {
        message: 'Confirmation could not be verified. Retry this same order before making changes.',
        preserveRequest: true,
      };
}

export function getEmployeeErrorMessage(error: unknown): string {
  const message = readErrorMessage(error).toLowerCase();
  if (message.includes('already registered') || message.includes('already been registered') || message.includes('unique')) return 'That email is already registered.';
  if (message.includes('active shift')) return 'Employee has an active shift. End the shift before changing branch, role, or active status.';
  if (message.includes('selling branch') || message.includes('assigned branch')) return 'Select an active selling branch.';
  if (message.includes('password')) return 'Temporary password must contain 8 to 72 characters.';
  if (message.includes('owner access') || message.includes('unauthorized') || message.includes('permission')) return 'Only an active Owner can manage employees.';
  if (message.includes('not found')) return 'Employee account was not found.';
  if (message.includes('fetch') || message.includes('network') || message.includes('failed to send')) return 'Network unavailable. Check your connection and try again.';
  return 'The employee operation could not be completed. Please try again.';
}

export function getArchiveErrorMessage(error: unknown): string {
  const message = readErrorMessage(error).toLowerCase();
  if (message.includes('verification failed')) return 'Archive verification failed. No data was deleted.';
  if (message.includes('delete archived data')) return 'Type DELETE ARCHIVED DATA to confirm cleanup.';
  if (message.includes('exported and verified') || message.includes('save a copy')) {
    return 'Export and verify the archive before cleaning old records.';
  }
  if (message.includes('older than 90 days')) return 'There are no detailed sales older than 90 days.';
  if (message.includes('already been cleaned')) return 'This archive has already been cleaned.';
  if (message.includes('not found')) return 'Archive record was not found.';
  if (message.includes('owner access') || message.includes('unauthorized') || message.includes('permission')) {
    return 'Only an active Owner can archive or clean detailed sales.';
  }
  if (isNetworkError(message)) return 'Unable to connect. Check your internet connection and try again.';
  return 'The archive operation could not be completed. No data was deleted.';
}

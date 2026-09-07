function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) return String(error.message);
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

export function getInventoryErrorMessage(error: unknown): string {
  const message = readErrorMessage(error).toLowerCase();

  if (message.includes('insufficient stock')) return 'There is not enough stock to complete this operation.';
  if (message.includes('already been received')) return 'This transfer has already been received.';
  if (message.includes('another branch')) return 'You cannot receive a transfer assigned to another branch.';
  if (message.includes('destination branch')) return 'The destination branch is inactive or invalid.';
  if (message.includes('product is missing or inactive')) return 'A selected product is inactive or unavailable.';
  if (message.includes('opening stock has already')) return 'Opening stock was already initialized for a selected product.';
  if (message.includes('positive') || message.includes('zero or greater')) return 'Enter a valid quantity.';
  if (message.includes('unauthorized') || message.includes('permission')) return 'You are not authorized to perform this action.';
  if (message.includes('fetch') || message.includes('network')) return 'Network unavailable. Check your connection and try again.';
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

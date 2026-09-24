/** Synchronous submit guard. Returns false if a submit is already in flight. */
export function tryBeginSubmit(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function endSubmit(lock: { current: boolean }): void {
  lock.current = false;
}

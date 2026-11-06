/**
 * An error with a Firebase-style code ("not-found", "permission-denied", "aborted", ...), so the
 * browser side can report it the way the app already expects.
 */
export class StoreError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

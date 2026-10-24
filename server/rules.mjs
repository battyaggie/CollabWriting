/**
 * Who may read and write what. These two functions are the server's version of firestore.rules.
 * Each throws a StoreError("permission-denied") to refuse.
 *
 * STAGE 1 PLACEHOLDER: everything is allowed. Do NOT use this build for real classes yet; the
 * real rules (teacher-only class settings, own roster entry, authored feedback, closed exercises)
 * come in the next stage.
 */
export const allowAll = {
  isPlaceholder: true,
  /** @param {{uid:string}|null} user  @param {string} path  a document or collection path */
  canRead(user, path, store) {},
  /** @param {{uid:string}|null} user  @param {Array} writes  @param {object} store */
  canWrite(user, writes, store) {},
};

// Provider-native DTO is intentionally opaque until an authoritative endpoint fixture exists.
// Do not fabricate BUFF/Steam/etc records from another provider's schema.
export interface Cs2ShRawSnapshot {
  payload: unknown;
}

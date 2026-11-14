export type BackendRelease =
  | { status: 'verified'; date: string; tag: string }
  | { status: 'notFound' }
  | { status: 'commitMismatch' }
  | { status: 'unidentified' };

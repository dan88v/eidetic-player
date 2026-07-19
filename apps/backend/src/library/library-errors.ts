export class LibraryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

export class LibraryFutureVersionError extends LibraryError {
  constructor(
    readonly foundVersion: number,
    readonly supportedVersion: number,
  ) {
    super(
      "LIBRARY_VERSION_UNSUPPORTED",
      "The Library database was created by a newer Eidetic Player version.",
      409,
    );
    this.name = "LibraryFutureVersionError";
  }
}

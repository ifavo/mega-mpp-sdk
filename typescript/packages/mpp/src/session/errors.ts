class SessionClientError extends Error {
  constructor(name: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = name;
  }
}

class SessionStoreError extends Error {
  constructor(name: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = name;
  }
}

export class SessionClientConfigurationError extends SessionClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("SessionClientConfigurationError", message, options);
  }
}

export class SessionClientStateError extends SessionClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("SessionClientStateError", message, options);
  }
}

export class SessionClientTransactionError extends SessionClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("SessionClientTransactionError", message, options);
  }
}

export class SessionStoreConfigurationError extends SessionStoreError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("SessionStoreConfigurationError", message, options);
  }
}

export class SessionStoreStateError extends SessionStoreError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("SessionStoreStateError", message, options);
  }
}

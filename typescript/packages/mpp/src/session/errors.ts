class SessionClientError extends Error {
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

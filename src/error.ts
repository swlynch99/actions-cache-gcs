export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class ConfigUnsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigUnsetError";
    Object.setPrototypeOf(this, ConfigUnsetError.prototype);
  }
}

export class ReserveCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = ReserveCacheError.name;
    Object.setPrototypeOf(this, ReserveCacheError.prototype);
  }
}

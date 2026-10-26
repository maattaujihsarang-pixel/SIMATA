const AppError = require('./app-error');

class BadRequestError extends AppError {
  constructor(message = 'Bad Request', errorCode = 'BAD_REQUEST', details = null) {
    super(message, 400, errorCode, details);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', errorCode = 'UNAUTHORIZED', details = null) {
    super(message, 401, errorCode, details);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', errorCode = 'FORBIDDEN', details = null) {
    super(message, 403, errorCode, details);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource Not Found', errorCode = 'NOT_FOUND', details = null) {
    super(message, 404, errorCode, details);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Conflict with existing resource', errorCode = 'CONFLICT', details = null) {
    super(message, 409, errorCode, details);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError
};


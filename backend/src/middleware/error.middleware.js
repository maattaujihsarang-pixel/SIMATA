const { AppError } = require('../errors');

function errorMiddleware(err, req, res, next) {
  // If headers already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  // Handle known operational AppError
  if (err instanceof AppError || err.isOperational) {
    const statusCode = err.statusCode || 500;
    const response = {
      status: statusCode >= 500 ? 'error' : 'fail',
      code: err.errorCode || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
      message: err.message
    };

    if (err.details) {
      response.details = err.details;
    }

    return res.status(statusCode).json(response);
  }

  // Handle Multer upload errors
  if (err.name === 'MulterError') {
    return res.status(400).json({
      status: 'fail',
      code: 'FILE_UPLOAD_ERROR',
      message: `File upload error: ${err.message}`
    });
  }

  // Handle syntax error (e.g. malformed JSON in request body)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      status: 'fail',
      code: 'INVALID_JSON',
      message: 'Malformed JSON payload in request body'
    });
  }

  // Handle PostgreSQL native unique constraint violations (SQLSTATE 23505)
  if (err.code === '23505') {
    let code = 'DUPLICATE_RESOURCE';
    const constraintName = err.constraint || '';
    if (constraintName.includes('student_attendance')) {
      code = 'DUPLICATE_STUDENT_ATTENDANCE';
    } else if (constraintName.includes('teacher_attendance')) {
      code = 'DUPLICATE_TEACHER_ATTENDANCE';
    }
    return res.status(409).json({
      status: 'fail',
      code,
      message: `Conflict: record violates unique constraint '${constraintName}'`,
      details: { constraint: constraintName, detail: err.detail }
    });
  }

  // Handle PostgreSQL native foreign key violations (SQLSTATE 23503)
  if (err.code === '23503') {
    return res.status(400).json({
      status: 'fail',
      code: 'FOREIGN_KEY_VIOLATION',
      message: `Foreign key constraint violation: referenced record is invalid or restricted`,
      details: { constraint: err.constraint, detail: err.detail }
    });
  }

  // Unhandled / system errors (do not leak internal traces to client)
  console.error('[UNHANDLED_ERROR]', err);

  return res.status(500).json({
    status: 'error',
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected internal server error occurred'
  });
}

module.exports = errorMiddleware;


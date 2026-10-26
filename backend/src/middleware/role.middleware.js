const { ForbiddenError } = require('../errors');

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ForbiddenError('Akses ditolak. Pengguna belum terautentikasi.'));
    }

    const userRole = (req.user.role || '').toUpperCase();
    const normalizedAllowed = allowedRoles.map(r => r.toUpperCase());

    if (!normalizedAllowed.includes(userRole)) {
      return next(new ForbiddenError(`Akses ditolak. Peran '${userRole}' tidak memiliki wewenang untuk aksi ini.`));
    }

    next();
  };
}

module.exports = {
  requireRole,
  requireAdmin: requireRole('ADMIN'),
  requireGuruOrAdmin: requireRole('ADMIN', 'GURU')
};


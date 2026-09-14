const jwt = require('jsonwebtoken');

function signAdmin(admin) {
  return jwt.sign(
    { sub: admin.id, email: admin.email, name: admin.name, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Autenticación requerida.' });

  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Sesión inválida o vencida.' });
  }
}

module.exports = { signAdmin, requireAdmin };

const fp = require("fastify-plugin");
const crypto = require("crypto");
const secureSession = require("@fastify/secure-session");
const bcrypt = require("bcrypt");

// Реєструє session-cookie і додає 2 декоратора:
//   request.user — { id, username } або null
// Також додає hook 'requireAuth' для preHandler.

async function authPlugin(fastify, opts) {
  if (!opts.sessionSecret || opts.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set (>=32 chars). Generate: openssl rand -base64 32");
  }
  // sha256 дає 32 байти повної ентропії — на відміну від .slice + padEnd('0')
  // що знижувало ентропію якщо секрет був коротшим за 32 chars.
  const key = crypto.createHash("sha256").update(opts.sessionSecret).digest();

  await fastify.register(secureSession, {
    key,
    cookieName: "session",
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: opts.cookieSecure,
      maxAge: 7 * 24 * 60 * 60, // 7 днів
    },
  });

  fastify.decorateRequest("user", null);

  fastify.addHook("preHandler", async (req) => {
    const userId = req.session.get("userId");
    if (!userId) { req.user = null; return; }
    req.user = await opts.usersRepo.findById(userId);
  });

  fastify.decorate("requireAuth", async (req, reply) => {
    if (!req.user) return reply.redirect("/login");
  });

  fastify.decorate("login", async (req, username, password) => {
    const user = await opts.usersRepo.findByUsername(username);
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return null;
    req.session.set("userId", user.id);
    return { id: user.id, username: user.username };
  });

  fastify.decorate("logout", (req) => req.session.delete());
}

module.exports = fp(authPlugin);

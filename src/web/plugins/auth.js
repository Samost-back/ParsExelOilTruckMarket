const fp = require("fastify-plugin");
const secureSession = require("@fastify/secure-session");
const bcrypt = require("bcrypt");

// Реєструє session-cookie і додає 2 декоратора:
//   request.user — { id, username } або null
//   reply.redirectToLogin() — 302 → /login
// Також додає hook 'requireAuth' для preHandler.

async function authPlugin(fastify, opts) {
  if (!opts.sessionSecret || opts.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set (>=32 chars)");
  }
  await fastify.register(secureSession, {
    key: Buffer.from(opts.sessionSecret.slice(0, 32).padEnd(32, "0").slice(0, 32)),
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

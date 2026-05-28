async function authRoutes(fastify) {
  fastify.get("/login", async (req, reply) => {
    if (req.user) return reply.redirect("/");
    return reply.view("login.ejs", { title: "Вхід", user: null, error: null });
  });

  fastify.post("/login", async (req, reply) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return reply.view("login.ejs", { title: "Вхід", user: null, error: "Заповніть всі поля" });
    }
    const user = await fastify.login(req, username, password);
    if (!user) {
      return reply.view("login.ejs", { title: "Вхід", user: null, error: "Невірний логін або пароль" });
    }
    return reply.redirect("/");
  });

  fastify.post("/logout", async (req, reply) => {
    fastify.logout(req);
    return reply.redirect("/login");
  });
}
module.exports = authRoutes;

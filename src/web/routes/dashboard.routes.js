async function dashboardRoutes(fastify, { db, jobsRepo }) {
  fastify.get("/", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const stats = await fetchStats(db);
    const jobs = await jobsRepo.listRecent(15);
    return reply.view("dashboard.ejs", {
      title: "Дашборд",
      user: req.user,
      stats,
      jobs,
    });
  });
}

async function fetchStats(db) {
  const q = (sql) => db.query(sql).then((r) => Number(r.rows[0].c));
  const [oils, photos, processed, published] = await Promise.all([
    q(`SELECT count(*) AS c FROM olivs`),
    q(`SELECT count(*) AS c FROM oils_images`),
    q(`SELECT count(*) AS c FROM oils_images WHERE processed_status='done'`),
    q(`SELECT count(*) AS c FROM olivs WHERE truck_listing_id IS NOT NULL`),
  ]);
  return { oils, photos, processed, published };
}

module.exports = dashboardRoutes;

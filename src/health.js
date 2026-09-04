import http from "node:http";

export function startHealthServer(port, getStatus) {
  const server = http.createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    if (path === "/" || path === "/health") {
      const body = JSON.stringify({
        ok: true,
        service: "tron-wallet-tracker",
        ...(typeof getStatus === "function" ? getStatus() : {}),
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      console.log(`health server listening on 0.0.0.0:${port}`);
      resolve(server);
    });
  });
}

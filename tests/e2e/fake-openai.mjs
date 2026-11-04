// خادم وهمي متوافق مع OpenAI لاختبارات المتصفح بس. /ok بيرد، و/down بيرجع خطأ.
import { createServer } from "node:http";

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url?.startsWith("/down")) {
      res.writeHead(500).end("down");
      return;
    }
    const answer = "رد تجريبي";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: answer } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  });
}).listen(3218, "127.0.0.1");

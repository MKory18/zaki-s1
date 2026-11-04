// خادم وهمي متوافق مع OpenAI لاختبارات المتصفح بس.
// /ok بيرد (وبيرجّع JSON صالح للماسح A06 لما البرومبت بيطلب verdict)، /junk بيرد نص مش JSON، و/down بيرجع خطأ.
import { createServer } from "node:http";

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url?.startsWith("/down")) {
      res.writeHead(500).end("down");
      return;
    }
    let content = "رد تجريبي";
    if (req.url?.startsWith("/junk")) {
      content = "هاي مش JSON";
    } else {
      try {
        const msgs = JSON.parse(body).messages ?? [];
        const last = msgs[msgs.length - 1]?.content ?? "";
        if (String(last).includes('"verdict"')) content = JSON.stringify({ verdict: "continue", reason: "زيت شعر بمشكلة واضحة" });
      } catch {
        /* نترك الرد العادي */
      }
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  });
}).listen(3218, "127.0.0.1");

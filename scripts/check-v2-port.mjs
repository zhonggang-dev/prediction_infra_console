import net from "node:net";

const host = process.env.PREDICTION_CONSOLE_V2_BIND_ADDRESS || "127.0.0.1";
const port = Number(process.env.PREDICTION_CONSOLE_V2_PORT || "13001");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`PREDICTION_CONSOLE_V2_PORT 无效：${process.env.PREDICTION_CONSOLE_V2_PORT || "13001"}`);
  process.exitCode = 1;
} else {
  const socket = net.createConnection({ host, port });
  let finished = false;

  const finish = (exitCode, message) => {
    if (finished) return;
    finished = true;
    socket.destroy();
    if (message) console.error(message);
    process.exitCode = exitCode;
  };

  socket.once("connect", () => finish(1, `V2 端口已被占用：${host}:${port}。未终止现有进程。`));
  socket.once("error", (error) => {
    if (error.code === "ECONNREFUSED") finish(0);
    else finish(1, `无法检查 V2 端口 ${host}:${port}：${error.message}`);
  });
  socket.setTimeout(500, () => finish(1, `检查 V2 端口超时：${host}:${port}。未启动服务。`));
}

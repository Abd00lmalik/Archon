import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const isWindows = process.platform === "win32";
const npmCmd = "npm";
const rpcHost = "127.0.0.1";
const rpcPort = 8545;
const rpcWaitTimeoutMs = 60_000;
const frontendNextCachePath = path.join(rootDir, "frontend", ".next");
let shuttingDown = false;

function runProcess(args, options = {}) {
  if (isWindows) {
    const command = [npmCmd, ...args]
      .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
      .join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", command], {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
      ...options
    });
  }

  return spawn(npmCmd, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    ...options
  });
}

function runOnce(args) {
  return new Promise((resolve, reject) => {
    const child = runProcess(args);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed: ${npmCmd} ${args.join(" ")} (exit ${code ?? "unknown"})`));
      }
    });
    child.on("error", reject);
  });
}

function waitForPort(host, port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = new net.Socket();
      socket.setTimeout(1_500);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("timeout", () => socket.destroy());
      socket.once("error", () => socket.destroy());
      socket.once("close", () => {
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(tryConnect, 750);
      });
      socket.connect(port, host);
    };
    tryConnect();
  });
}

function canConnect(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function shutdown(children, exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (child && !child.killed) {
      child.kill(isWindows ? undefined : "SIGINT");
    }
  }
  setTimeout(() => process.exit(exitCode), 200);
}

async function main() {
  const children = [];
  let chain = null;

  if (await canConnect(rpcHost, rpcPort)) {
    console.log(`Found existing RPC at ${rpcHost}:${rpcPort}. Reusing it.`);
  } else {
    chain = runProcess(["run", "node", "--workspace", "contracts"]);
    children.push(chain);

    chain.on("exit", (code) => {
      if (!shuttingDown && code !== 0) {
        console.error("Hardhat node stopped unexpectedly.");
        shutdown(children, code ?? 1);
      }
    });
  }

  try {
    await waitForPort(rpcHost, rpcPort, rpcWaitTimeoutMs);
    await runOnce(["run", "deploy", "--workspace", "contracts"]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    shutdown(children, 1);
    return;
  }

  try {
    fs.rmSync(frontendNextCachePath, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `Warning: unable to clean frontend cache at ${frontendNextCachePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const frontend = runProcess(["run", "dev", "--workspace", "frontend"]);
  children.push(frontend);

  frontend.on("exit", (code) => {
    if (!shuttingDown) {
      shutdown(children, code ?? 0);
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => shutdown(children, 0));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

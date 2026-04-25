require("dotenv").config();
const chokidar = require("chokidar");
const { NodeSSH } = require("node-ssh");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { minimatch } = require("minimatch");

const ssh = new NodeSSH();
let remoteOS = null;
let connected = false;

// Validate required .env variables before doing anything
const REQUIRED_ENV = ["WATCHED", "EC2_HOST", "EC2_USER", "EC2_PEM_PATH", "REMOTE_BASE_PATH"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required .env variables: ${missing.join(", ")}`);
  process.exit(1);
}

const config = {
  localDir: path.resolve(__dirname, process.env.WATCHED),
  ignored: [
    "node_modules",
    "node_modules/**",
    ".git",
    ".git/**",
    ".gitignore",
    "uploads",
    "uploads/**",
    "**/*.log",
    "**/*.tmp",
  ],
  ec2: {
    host: process.env.EC2_HOST,
    username: process.env.EC2_USER,
    privateKey: path.resolve(process.env.EC2_PEM_PATH),
    remoteBasePath: process.env.REMOTE_BASE_PATH,
  },
};

async function connectSSH() {
  await ssh.connect({
    host: config.ec2.host,
    username: config.ec2.username,
    privateKeyPath: config.ec2.privateKey,
  });
  connected = true;
  ssh.connection.once("close", () => {
    connected = false;
    console.warn("⚠️  SSH connection closed.");
  });
  ssh.connection.once("error", (err) => {
    connected = false;
    console.error("⚠️  SSH connection error:", err.message);
  });
}

async function ensureConnected() {
  if (connected) return;
  console.log("🔄 Reconnecting to EC2...");
  await connectSSH();
  console.log("🔐 Reconnected to EC2");
}

function isIgnored(filePath) {
  const relative = path.relative(config.localDir, filePath).replace(/\\/g, "/");
  const result = config.ignored.some((pattern) => minimatch(relative, pattern));
  if (result) {
    console.log(`[IGNORED] ${relative}`);
  }
  return result;
}

async function detectRemoteOS() {
  const result = await ssh.execCommand("uname -s");
  remoteOS = result.code === 0 && result.stdout.trim() !== "" ? "linux" : "windows";
  console.log(`🖥️  Detected remote OS: ${remoteOS}`);
}

function toRemotePath(localPath) {
  const relative = path.relative(config.localDir, localPath);
  if (remoteOS === "linux") {
    return `${config.ec2.remoteBasePath}/${relative.replace(/\\/g, "/")}`;
  }
  return `${config.ec2.remoteBasePath}\\${relative.replace(/\//g, "\\")}`;
}

function remoteDir(remotePath) {
  return remoteOS === "linux"
    ? path.posix.dirname(remotePath)
    : path.win32.dirname(remotePath);
}

async function ensureRemoteFolder(remoteFolderPath) {
  if (remoteOS === "linux") {
    await ssh.execCommand(`mkdir -p "${remoteFolderPath}"`);
  } else {
    await ssh.execCommand(
      `powershell -Command "New-Item -ItemType Directory -Force -Path '${remoteFolderPath}'"`
    );
  }
}

async function uploadFile(localPath) {
  if (isIgnored(localPath)) return;
  await ensureConnected();
  const remotePath = toRemotePath(localPath);
  await ensureRemoteFolder(remoteDir(remotePath));
  try {
    await ssh.putFile(localPath, remotePath);
    console.log(`✅ Uploaded file: ${path.relative(config.localDir, localPath)}`);
    if (path.basename(localPath) === "package.json")
      await runRemoteNpmInstall();
  } catch (err) {
    console.error(`❌ Failed to upload file: ${localPath}`, err.message);
  }
}

async function handleFolder(localFolderPath) {
  if (isIgnored(localFolderPath)) return;
  await ensureConnected();
  const remotePath = toRemotePath(localFolderPath);
  await ensureRemoteFolder(remotePath);
  console.log(`📁 Created remote folder: ${path.relative(config.localDir, localFolderPath)}`);
  const items = fs.readdirSync(localFolderPath);
  for (const item of items) {
    const itemPath = path.join(localFolderPath, item);
    if (isIgnored(itemPath)) continue;
    if (fs.statSync(itemPath).isFile()) await uploadFile(itemPath);
    else if (fs.statSync(itemPath).isDirectory()) await handleFolder(itemPath);
  }
}

async function handleFileDelete(localPath) {
  await ensureConnected();
  const remotePath = toRemotePath(localPath);
  try {
    if (remoteOS === "linux") {
      await ssh.execCommand(`rm -f "${remotePath}"`);
    } else {
      await ssh.execCommand(`del "${remotePath}"`);
    }
    console.log(`🗑️ Deleted remote file: ${path.relative(config.localDir, localPath)}`);
  } catch (err) {
    console.error(`❌ Failed to delete file: ${remotePath}`, err.message);
  }
}

async function handleFolderDelete(localPath) {
  await ensureConnected();
  const remotePath = toRemotePath(localPath);
  try {
    if (remoteOS === "linux") {
      await ssh.execCommand(`rm -rf "${remotePath}"`);
    } else {
      await ssh.execCommand(
        `powershell -Command "Remove-Item -Path '${remotePath}' -Recurse -Force"`
      );
    }
    console.log(`🗑️ Deleted remote folder: ${path.relative(config.localDir, localPath)}`);
  } catch (err) {
    console.error(`❌ Failed to delete folder: ${remotePath}`, err.message);
  }
}

function createSshTunnelWithRetry() {
  console.log("🔌 Creating SSH tunnel with keep-alive...");
  const args = [
    "/c", "start", "/min", "ssh",
    "-o", "ServerAliveInterval=60",
    "-o", "ServerAliveCountMax=999999",
    "-i", config.ec2.privateKey,
    "-L", "8888:localhost:80",
    `${config.ec2.username}@${config.ec2.host}`,
  ];
  spawn("cmd", args, { shell: true, detached: true, stdio: "ignore" });
}

async function launchRemoteNpmCmd() {
  console.log("🚀 Starting npm on remote...");
  const remoteBasePath = config.ec2.remoteBasePath;
  let command;
  if (remoteOS === "linux") {
    // Kill any existing npm start process before launching a new one
    await ssh.execCommand(`pkill -f "npm start" || true`);
    command = `cd "${remoteBasePath}" && nohup npm start >> server.log 2>&1 &`;
  } else {
    const powershellCmd = `start cmd /k "cd /d '${remoteBasePath}' && npm start >> server.log 2>&1"`;
    command = `powershell -Command "${powershellCmd}"`;
  }
  try {
    await ssh.execCommand(command);
    console.log("✅ Remote npm started and logging to server.log");
  } catch (err) {
    console.error("❌ Failed to start remote npm:", err.message);
  }
}

async function runRemoteNpmInstall() {
  console.log("📦 Detected package.json update, running npm install on EC2...");
  const remoteBasePath = config.ec2.remoteBasePath;
  const command = remoteOS === "linux"
    ? `cd "${remoteBasePath}" && npm install`
    : `powershell -Command "cd '${remoteBasePath}'; npm install"`;
  try {
    const result = await ssh.execCommand(command);
    console.log(result.stdout || "✅ npm install completed.");
    if (result.stderr) console.error("⚠️ npm install stderr:", result.stderr);
  } catch (err) {
    console.error("❌ Failed to run npm install:", err.message);
  }
}

function watchRemoteLogs() {
  console.log("📺 Opening local CMD to follow remote server.log...");
  const remoteCmd = remoteOS === "linux"
    ? `tail -f "${config.ec2.remoteBasePath}/server.log"`
    : `powershell -Command "Get-Content '${config.ec2.remoteBasePath}\\server.log' -Wait"`;

  const sshArgs = [
    "-o", "ServerAliveInterval=60",
    "-o", "ServerAliveCountMax=999999",
    "-i", `"${config.ec2.privateKey}"`,
    `${config.ec2.username}@${config.ec2.host}`,
    remoteCmd,
  ].join(" ");

  // CMD loop: reconnects automatically after 10s if SSH drops
  const script = `title Remote Logs & :loop & ssh ${sshArgs} & echo. & echo Reconnecting in 10s... & timeout /t 10 /nobreak > nul & goto loop`;

  spawn("cmd", ["/c", "start", "cmd", "/k", script], {
    detached: true,
    stdio: "ignore",
    shell: true,
  });
}

function handleWatcherError(err) {
  console.error("Watcher error:", err);
}

async function initialUpload() {
  console.log("⬆️  Uploading all existing files...");
  await handleFolder(config.localDir);
  console.log("✅ Initial upload complete.");
}

async function start() {
  try {
    console.log("🔄 Connecting to EC2...");
    await connectSSH();
    console.log("🔐 Connected to EC2");

    await detectRemoteOS();
    createSshTunnelWithRetry();
    await initialUpload();
    await launchRemoteNpmCmd();
    watchRemoteLogs();

    chokidar
      .watch(config.localDir, {
        ignored: isIgnored,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      })
      .on("add", uploadFile)
      .on("change", uploadFile)
      .on("addDir", handleFolder)
      .on("unlink", handleFileDelete)
      .on("unlinkDir", handleFolderDelete)
      .on("error", handleWatcherError);

    console.log(`👀 Watching: ${config.localDir}`);
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
}

start();

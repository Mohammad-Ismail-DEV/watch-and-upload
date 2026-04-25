require("dotenv").config();
const chokidar = require("chokidar");
const { NodeSSH } = require("node-ssh");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { minimatch } = require("minimatch");

const ssh = new NodeSSH();

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

function isIgnored(filePath) {
  const relative = path.relative(config.localDir, filePath).replace(/\\/g, "/");
  const result = config.ignored.some((pattern) => minimatch(relative, pattern));
  if (result) {
    console.log(`[IGNORED] ${relative}`);
  }
  return result;
}

function toRemotePath(localPath) {
  const relative = path
    .relative(config.localDir, localPath)
    .replace(/\//g, "\\")
    .replace(/\\/g, "\\");
  return `${config.ec2.remoteBasePath}\\${relative}`;
}

async function ensureRemoteFolder(remoteFolderPath) {
  await ssh.execCommand(
    `powershell -Command "New-Item -ItemType Directory -Force -Path '${remoteFolderPath}'"`
  );
}

async function uploadFile(localPath) {
  if (isIgnored(localPath)) return;

  const remotePath = toRemotePath(localPath);
  const remoteDir = path.dirname(remotePath);
  await ensureRemoteFolder(remoteDir);

  try {
    await ssh.putFile(localPath, remotePath);
    console.log(
      `✅ Uploaded file: ${path.relative(config.localDir, localPath)}`
    );

    if (path.basename(localPath) === "package.json") {
      await runRemoteNpmInstall();
    }
  } catch (err) {
    console.error(`❌ Failed to upload file: ${localPath}`, err.message);
  }
}

async function handleFolder(localFolderPath) {
  if (isIgnored(localFolderPath)) return;

  const remotePath = toRemotePath(localFolderPath);
  await ensureRemoteFolder(remotePath);
  console.log(
    `📁 Created remote folder: ${path.relative(
      config.localDir,
      localFolderPath
    )}`
  );

  const items = fs.readdirSync(localFolderPath);
  for (const item of items) {
    const itemPath = path.join(localFolderPath, item);
    if (isIgnored(itemPath)) continue;

    if (fs.statSync(itemPath).isFile()) {
      await uploadFile(itemPath);
    } else if (fs.statSync(itemPath).isDirectory()) {
      await handleFolder(itemPath);
    }
  }
}

async function handleFileDelete(localPath) {
  const remotePath = toRemotePath(localPath);
  try {
    await ssh.execCommand(`del "${remotePath}"`);
    console.log(
      `🗑️ Deleted remote file: ${path.relative(config.localDir, localPath)}`
    );
  } catch (err) {
    console.error(`❌ Failed to delete file: ${remotePath}`, err.message);
  }
}

async function handleFolderDelete(localPath) {
  const remotePath = toRemotePath(localPath);
  try {
    await ssh.execCommand(
      `powershell -Command "Remove-Item -Path '${remotePath}' -Recurse -Force"`
    );
    console.log(
      `🗑️ Deleted remote folder: ${path.relative(config.localDir, localPath)}`
    );
  } catch (err) {
    console.error(`❌ Failed to delete folder: ${remotePath}`, err.message);
  }
}

function handleWatcherError(err) {
  console.error("Watcher error:", err);
}

async function initialUpload() {
  console.log("⬆️  Uploading all existing files...");
  await handleFolder(config.localDir);
  console.log("✅ Initial upload complete.");
}

async function runRemoteNpmInstall() {
  console.log("📦 Detected package.json update, running npm install on EC2...");
  const remoteDir = config.ec2.remoteBasePath;
  const command = `powershell -Command "cd '${remoteDir}'; npm install"`;

  try {
    const result = await ssh.execCommand(command);
    console.log(result.stdout || "✅ npm install completed.");
    if (result.stderr) {
      console.error("⚠️ npm install stderr:", result.stderr);
    }
  } catch (err) {
    console.error("❌ Failed to run npm install:", err.message);
  }
}

async function launchRemoteNpmCmd() {
  console.log("🚀 Starting npm in remote visible CMD...");

  const remoteDir = config.ec2.remoteBasePath;
  const powershellCmd = `start cmd /k "cd /d '${remoteDir}' && npm start >> server.log 2>&1"`;

  try {
    await ssh.execCommand(`powershell -Command "${powershellCmd}"`);
    console.log("✅ Remote npm started in CMD and logging to server.log");
  } catch (err) {
    console.error("❌ Failed to start remote CMD for npm:", err.message);
  }
}

function watchRemoteLogs() {
  console.log("📺 Opening local CMD to follow remote server.log...");

  spawn(
    "cmd",
    [
      "/c",
      "start",
      "cmd",
      "/k",
      `ssh -i "${config.ec2.privateKey}" ${config.ec2.username}@${config.ec2.host} powershell -Command "Get-Content '${config.ec2.remoteBasePath}\\server.log' -Wait"`,
    ],
    {
      detached: true,
      stdio: "ignore",
      shell: true,
    }
  );
}

function createSshTunnel() {
  console.log("🔌 Creating SSH tunnel for phpMyAdmin (localhost:8888)...");

  spawn(
    "cmd",
    [
      "/c",
      "start",
      "/min",
      "ssh",
      "-i",
      `"${config.ec2.privateKey}"`,
      "-L",
      "8888:localhost:80",
      `${config.ec2.username}@${config.ec2.host}`,
    ],
    {
      shell: true,
      detached: true,
      stdio: "ignore",
    }
  );
}

async function start() {
  console.log("🔄 Connecting to EC2...");

  await ssh.connect({
    host: config.ec2.host,
    username: config.ec2.username,
    privateKeyPath: config.ec2.privateKey,
  });
  console.log("🔐 Connected to EC2");

  createSshTunnel(); // 👈 create the SSH tunnel
  await initialUpload(); // Initial sync
  await launchRemoteNpmCmd(); // Start remote CMD that runs npm
  watchRemoteLogs(); // Open local CMD to follow the log file

  chokidar
    .watch(config.localDir, {
      ignored: isIgnored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    })
    .on("add", uploadFile)
    .on("change", uploadFile)
    .on("addDir", handleFolder)
    .on("unlink", handleFileDelete)
    .on("unlinkDir", handleFolderDelete)
    .on("error", handleWatcherError);

  console.log(`👀 Watching: ${config.localDir}`);
}

start();

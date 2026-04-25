# EC2 Auto Sync + Remote Log Watcher

This script watches a local backend folder and automatically uploads changes to a remote **Windows EC2 instance**, including:

- ✅ Real-time file and folder sync
- ✅ Upload on file change / new folders
- ✅ Remote deletions on local delete
- ✅ Automatic `npm install` when `package.json` is updated
- ✅ SSH tunnel for phpMyAdmin on `localhost:8888`
- ✅ Live `server.log` tracking in a local CMD window
- ❗ Manual `npm start >> server.log` must be started on EC2

## 🔧 Setup

1. **Install dependencies**

```bash
npm install chokidar node-ssh minimatch dotenv
```

2. **Create a `.env` file**

Use `.env.example` as a base:

```ini
WATCHED=./backend
EC2_HOST=x.x.x.x
EC2_USER=Administrator
EC2_PEM_PATH=./secretKey.pem
REMOTE_BASE_PATH=C:\Users\Administrator\Desktop\backend
```

## 🚀 Run the Sync Script

```bash
node index.js
```

This will:

- 🔐 Connect to EC2
- ⬆️ Upload all files/folders from `WATCHED`
- 👀 Start watching for changes
- 🔌 Open an SSH tunnel for phpMyAdmin on `localhost:8888`
- 📺 Open a local CMD window that tails `server.log` from the EC2 instance

## 🧠 Important Manual Step

On the **EC2 instance**, run this command **once manually**:

```cmd
npm start >> server.log
```

This ensures the backend:
- Runs in the background
- Logs output to `server.log` (which your local machine will follow)

💡 You can also RDP into the EC2, open CMD in the backend folder, and run:

```cmd
start cmd /k "npm start >> server.log"
```

This keeps a live visible window.

## ⚙️ Features

- Ignores:
  - `node_modules/`
  - `.git/`
  - `uploads/`
  - `*.log`, `*.tmp`
- Automatically installs dependencies when `package.json` is changed
- Deletes remote files/folders when removed locally
- Creates new folders as needed
- Opens `http://localhost:8888/phpmyadmin` via tunnel

## 🔒 Security Reminder

The SSH tunnel is wide open (`-L 8888:localhost:80`). Consider:

- Whitelisting your IP in EC2 security group
- Using authentication in phpMyAdmin
- Shutting down tunnel when not in use

## ✅ Dependencies

- Node.js
- OpenSSH on your local machine
- EC2 instance with:
  - `node` and `npm` installed
  - OpenSSH server enabled
  - `npm start` configured in backend

## 📂 File Structure

```
.
├── index.js                 # Main watcher + sync script
├── .env.example             # Example config
├── launch-npm.cmd (optional) # Manual starter script for EC2
```

## 🧹 Troubleshooting

- If `server.log` does not exist, `watchRemoteLogs()` will fail.
- Make sure `npm start` is launched and logging to `server.log`.
- If CMD does not start visibly on EC2 via script, use `Task Scheduler` or run manually.

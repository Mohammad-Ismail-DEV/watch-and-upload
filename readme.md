# EC2 Auto Sync + Remote Log Watcher

This script watches a local folder and automatically uploads changes to a remote **Windows or Linux EC2 instance**, including:

- ✅ Real-time file and folder sync
- ✅ Upload on file change / new folders
- ✅ Remote deletions on local delete
- ✅ Automatic `npm install` when `package.json` is updated
- ✅ Automatic `npm start` on the remote machine
- ✅ SSH tunnel for phpMyAdmin on `localhost:8888`
- ✅ Live `server.log` tracking in a local CMD window (auto-reconnects on disconnect)
- ✅ Auto-detects remote OS (Windows or Linux) — no manual config needed
- ✅ SSH reconnects automatically if the connection drops
- ✅ Validates `.env` at startup with clear error messages

## 🔑 About the PEM File

The `.pem` file is your EC2 private key — it authenticates your SSH connection without a password. AWS generates it when you create an EC2 instance.

**To get it:**

1. Go to the AWS EC2 console → **Network & Security** → **Key Pairs**
2. Click **Create key pair**, give it a name, and select `.pem` format
3. Click **Create** — the file will download automatically
4. Store it somewhere safe (e.g. in this project folder). **AWS only lets you download it once.**

When launching your EC2 instance, select this key pair. Then set `EC2_PEM_PATH` in your `.env` to point to the downloaded file.

**Extracting the public key from your `.pem`:**

You'll need the public key when setting up SSH access on the EC2 instance. Extract it with:

```bash
ssh-keygen -y -f your-key.pem
```

This prints the public key to the terminal — copy the output and paste it into `authorized_keys` on the remote machine.

To save it to a file instead:

```bash
ssh-keygen -y -f your-key.pem > your-key.pub
```

> If you already have a running EC2 instance and lost the key, you'll need to replace it via the AWS console or by stopping the instance and attaching the volume to another instance.

**Fixing permissions (required):**

SSH will refuse to use the `.pem` file if other users on your machine can read it. You'll get a `"UNPROTECTED PRIVATE KEY FILE"` error and the connection will be refused.

Windows (PowerShell):

```powershell
icacls "your-key.pem" /inheritance:r
icacls "your-key.pem" /grant:r "$($env:USERNAME):(R)"
```

macOS / Linux:

```bash
chmod 400 your-key.pem
```

## 🖥️ Configuring the EC2 Instance

> This script runs on your **local machine** and connects to a remote EC2 instance. The steps below cover both Windows and Linux EC2 setups.

### 1. AWS Security Group (Firewall)

In the AWS EC2 console, go to your instance → **Security** tab → click the security group → **Edit inbound rules** and add:

| Type | Protocol | Port | Source | Purpose |
|------|----------|------|--------|---------|
| SSH | TCP | 22 | Your IP | SSH connection + file sync |
| Custom TCP | TCP | 80 | Your IP | phpMyAdmin via SSH tunnel |
| RDP | TCP | 3389 | Your IP | Remote Desktop — Windows only, optional |

> Use **My IP** in the Source dropdown to automatically fill in your current IP. If your IP changes, you'll need to update the rule.

---

### Windows EC2

#### 2a. Enable OpenSSH Server

By default, Windows Server EC2 instances don't have SSH enabled. RDP into the instance and run this in PowerShell as Administrator:

```powershell
# Install OpenSSH Server
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Start the service
Start-Service sshd

# Set it to start automatically on boot
Set-Service -Name sshd -StartupType Automatic
```

Verify it's running:

```powershell
Get-Service sshd
```

#### 2b. Allow SSH Through Windows Firewall

If the OpenSSH installer didn't add a firewall rule automatically, add one manually:

```powershell
New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

#### 2c. Set Up the Administrator SSH Key

To allow key-based login (required by this script), add your public key to the Administrator's authorized keys file. On the EC2 instance run:

```powershell
# Create the folder if it doesn't exist
New-Item -ItemType Directory -Force -Path "C:\ProgramData\ssh"

# Add your public key (paste the contents of your .pub key file)
Add-Content -Path "C:\ProgramData\ssh\administrators_authorized_keys" -Value "YOUR_PUBLIC_KEY_HERE"

# Fix permissions on the file (required)
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "SYSTEM:(F)" /grant "BUILTIN\Administrators:(F)"
```

> For the Administrator account, Windows looks for the key in `C:\ProgramData\ssh\administrators_authorized_keys`, not in the user's home folder.

---

### Linux EC2

#### 2a. SSH is already enabled

SSH server (`sshd`) runs by default on all Linux EC2 AMIs. No extra setup needed.

#### 2b. Set Up the SSH Key

AWS automatically adds your key pair to `~/.ssh/authorized_keys` when the instance is launched. No manual setup needed if you selected the key pair at launch time.

If you need to add a key manually, SSH into the instance and run:

```bash
mkdir -p ~/.ssh
echo "YOUR_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

#### 2c. Install Node.js

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install --lts

# Or via package manager (Debian/Ubuntu)
sudo apt install nodejs npm

# Or via package manager (Amazon Linux / Fedora)
sudo dnf install nodejs
```

---

### 3. Verify the Connection

From your local machine, test the SSH connection before running the script:

```bash
# Windows EC2
ssh -i your-key.pem Administrator@your-ec2-ip

# Linux EC2 (username varies by AMI)
ssh -i your-key.pem ec2-user@your-ec2-ip   # Amazon Linux
ssh -i your-key.pem ubuntu@your-ec2-ip     # Ubuntu
```

## 💻 Local Machine Prerequisites

### Windows

- OpenSSH client is included in Windows 10/11. Verify it's available by running `ssh -V` in PowerShell.
- If missing: **Settings** → **Optional Features** → **Add a feature** → search for **OpenSSH Client** → Install.
- Install Node.js from [nodejs.org](https://nodejs.org).

### macOS

- OpenSSH is pre-installed. Verify with `ssh -V` in Terminal.
- Install Node.js via Homebrew:

```bash
brew install node
```

Or download from [nodejs.org](https://nodejs.org).

### Linux

- OpenSSH client is usually pre-installed. If not:

```bash
# Debian/Ubuntu
sudo apt install openssh-client

# Fedora/RHEL
sudo dnf install openssh-clients
```

- Install Node.js:

```bash
# Debian/Ubuntu
sudo apt install nodejs npm

# Fedora/RHEL
sudo dnf install nodejs

# Or use nvm for version management (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install --lts
```

## 🔧 Setup

1. **Install dependencies**

```bash
npm install chokidar node-ssh minimatch dotenv
```

2. **Create a `.env` file**

Use `.env.example` as a base:

```ini
# Windows EC2
WATCHED=./backend
EC2_HOST=x.x.x.x
EC2_USER=Administrator
EC2_PEM_PATH=./secretKey.pem
REMOTE_BASE_PATH=C:\Users\Administrator\Desktop\backend

# Linux EC2
WATCHED=./backend
EC2_HOST=x.x.x.x
EC2_USER=ec2-user
EC2_PEM_PATH=./secretKey.pem
REMOTE_BASE_PATH=/home/ec2-user/backend
```

## 🚀 Run the Sync Script

```bash
node index.js
```

This will:

- 🔐 Connect to EC2 and auto-detect the remote OS
- ⬆️ Upload all files/folders from `WATCHED`
- 🚀 Start `npm start` on the remote machine automatically
- 👀 Start watching for changes
- 🔌 Open an SSH tunnel for phpMyAdmin on `localhost:8888`
- 📺 Open a local CMD window that tails `server.log` from the EC2 instance

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
- SSH reconnects automatically if the connection drops mid-session
- Log watcher CMD window reconnects automatically if SSH drops

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
  - `npm start` configured in `package.json`

## 📂 File Structure

```
.
├── index.js        # Main watcher + sync script
├── .env            # Your config (gitignored)
├── .env.example    # Config template
└── your-key.pem    # EC2 private key (gitignored)
```

## 🧹 Troubleshooting

- If `server.log` does not exist yet, the log watcher will error on connect — it will retry automatically once the file is created by `npm start`.
- If the script exits with `❌ Missing required .env variables`, check your `.env` file has all five variables set: `WATCHED`, `EC2_HOST`, `EC2_USER`, `EC2_PEM_PATH`, `REMOTE_BASE_PATH`.
- If SSH connection is refused, verify port 22 is open in the EC2 security group and the SSH service is running on the instance.
- On Linux EC2, if a second `npm start` process launches unexpectedly, the script automatically kills any existing `npm start` process before starting a new one.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace SessionManagerProLauncher
{
    static class Program
    {
        private static Process serverProcess = null;
        private static string edgePath = null;
        private static string webviewDataDir = null;
        private static string logFile = null;
        private static string serverLogFile = null;
        private const int SERVER_PORT = 3001;
        private const string SERVER_URL = "http://127.0.0.1:3001";

        private static void Log(string msg)
        {
            try
            {
                if (logFile != null)
                {
                    string line = string.Format("[{0:yyyy-MM-dd HH:mm:ss}] {1}\r\n", DateTime.Now, msg);
                    File.AppendAllText(logFile, line, Encoding.UTF8);
                }
            }
            catch { }
        }

        private static void LogServer(string msg)
        {
            try
            {
                if (serverLogFile != null && !string.IsNullOrEmpty(msg))
                {
                    string line = string.Format("[{0:yyyy-MM-dd HH:mm:ss}] {1}\r\n", DateTime.Now, msg);
                    File.AppendAllText(serverLogFile, line, Encoding.UTF8);
                }
            }
            catch { }
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string updatesDir = Path.Combine(baseDir, "updates");
                string backendDir = Path.Combine(baseDir, "backend");
                string serverScript = Path.Combine(backendDir, "src", "server.js");

                // Isolated Edge profile in LocalAppData to prevent locking or path whitespace issues
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                webviewDataDir = Path.Combine(localAppData, "SessionManagerPro", "edge_profile");

                if (!Directory.Exists(updatesDir)) Directory.CreateDirectory(updatesDir);
                if (!Directory.Exists(webviewDataDir)) Directory.CreateDirectory(webviewDataDir);

                logFile = Path.Combine(updatesDir, "launcher.log");
                serverLogFile = Path.Combine(updatesDir, "server.log");

                Log("====================================================");
                Log("Starting SessionManagerPro Desktop Launcher");
                Log("Base Directory: " + baseDir);
                Log("WebView Profile: " + webviewDataDir);

                // Ensure .venv is healthy and pointed to valid Python installation
                VerifyAndHealPythonVenv(baseDir);

                // 1. Check if server is already responding on port 3001
                bool isPortOpen = IsPortOpen("127.0.0.1", SERVER_PORT, 250);
                Log("Initial port check (3001): " + (isPortOpen ? "ALREADY_ONLINE" : "OFFLINE"));

                if (!isPortOpen)
                {
                    if (!File.Exists(serverScript))
                    {
                        string err = "Could not locate server script at:\n" + serverScript;
                        Log("FATAL: " + err);
                        MessageBox.Show(err, "SessionManagerPro", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }

                    string nodeExe = FindNodeExecutable(baseDir);
                    Log("Resolved Node.js path: " + nodeExe);

                    if (string.IsNullOrEmpty(nodeExe))
                    {
                        string err = "Node.js (node.exe) was not found on your system.\nPlease install Node.js (v18+) from https://nodejs.org";
                        Log("FATAL: " + err);
                        MessageBox.Show(err, "SessionManagerPro — Node Not Found", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }

                    ProcessStartInfo nodePsi = new ProcessStartInfo
                    {
                        FileName = nodeExe,
                        Arguments = "\"" + serverScript + "\" --no-open",
                        WorkingDirectory = baseDir,
                        CreateNoWindow = true,
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };

                    serverProcess = new Process();
                    serverProcess.StartInfo = nodePsi;
                    serverProcess.OutputDataReceived += (s, e) => { if (e.Data != null) LogServer("OUT: " + e.Data); };
                    serverProcess.ErrorDataReceived += (s, e) => { if (e.Data != null) LogServer("ERR: " + e.Data); };

                    serverProcess.Start();
                    serverProcess.BeginOutputReadLine();
                    serverProcess.BeginErrorReadLine();

                    Log("Spawned Node server process (PID: " + serverProcess.Id + ")");

                    // Wait up to 15 seconds for port 3001 to open with 250ms polling
                    int attempts = 0;
                    while (attempts < 60 && !IsPortOpen("127.0.0.1", SERVER_PORT, 200))
                    {
                        if (serverProcess.HasExited)
                        {
                            string exitErr = "Backend server exited prematurely with code " + serverProcess.ExitCode + ".\nCheck updates/server.log for details.";
                            Log("FATAL: " + exitErr);
                            MessageBox.Show(exitErr, "SessionManagerPro Server Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                            return;
                        }
                        Thread.Sleep(250);
                        attempts++;
                    }

                    Log("Server port status: " + (IsPortOpen("127.0.0.1", SERVER_PORT, 300) ? "ONLINE" : "TIMEOUT"));
                }

                // 2. Locate browser (configured browser, Microsoft Edge, or Chrome)
                edgePath = FindBrowserExecutable(baseDir);
                Log("Resolved browser path: " + (edgePath ?? "Default System Browser"));

                // 3. Setup System Tray Application Context
                TrayAppContext appContext = new TrayAppContext(edgePath, webviewDataDir, serverProcess);

                Log("System tray initialized with TrayAppContext. Running application loop.");
                Application.Run(appContext);
            }
            catch (Exception ex)
            {
                Log("CRITICAL_EXCEPTION: " + ex.ToString());
                MessageBox.Show(
                    "Error launching SessionManagerPro:\n" + ex.Message,
                    "SessionManagerPro Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        public class TrayAppContext : ApplicationContext
        {
            private string _edgePath;
            private string _webviewDir;
            private Process _nodeProcess;
            private NotifyIcon _trayIcon;

            public TrayAppContext(string edgePath, string webviewDir, Process nodeProcess)
            {
                _edgePath = edgePath;
                _webviewDir = webviewDir;
                _nodeProcess = nodeProcess;

                // Ensure Node is killed on process exit
                AppDomain.CurrentDomain.ProcessExit += (s, e) => CleanExit();

                _trayIcon = new NotifyIcon();
                _trayIcon.Icon = CreateCyberIcon();
                _trayIcon.Text = "SessionManagerPro (Active on :3001)";
                _trayIcon.Visible = true;

                ContextMenu menu = new ContextMenu();
                menu.MenuItems.Add(new MenuItem("Open Dashboard Window", (s, e) => LaunchWindow()));
                menu.MenuItems.Add(new MenuItem("Open in Default Browser", (s, e) => {
                    try { Process.Start(SERVER_URL); } catch { }
                }));
                menu.MenuItems.Add("-");
                menu.MenuItems.Add(new MenuItem("Exit SessionManagerPro", (s, e) => Shutdown()));

                _trayIcon.ContextMenu = menu;
                _trayIcon.DoubleClick += (s, e) => LaunchWindow();

                // Launch the window on startup
                LaunchWindow();
            }

            public void LaunchWindow()
            {
                try
                {
                    if (!string.IsNullOrEmpty(_edgePath) && File.Exists(_edgePath))
                    {
                        string edgeArgs = string.Format(
                            "--app={0} --window-size=1600,900 --user-data-dir=\"{1}\" " +
                            "--no-first-run --no-default-browser-check " +
                            "--disable-features=Translate,OptimizationHints,MediaRouter,EdgeMiniMenu,EdgeSuperDragDrop,msEdgeReadingView " +
                            "--disable-extensions --disable-component-update --disable-default-apps " +
                            "--disable-background-networking --disable-sync",
                            SERVER_URL,
                            _webviewDir
                        );

                        Log("Opening WebView Window: " + _edgePath + " " + edgeArgs);

                        ProcessStartInfo psi = new ProcessStartInfo
                        {
                            FileName = _edgePath,
                            Arguments = edgeArgs,
                            UseShellExecute = false
                        };
                        Process.Start(psi);
                    }
                    else
                    {
                        Log("Opening in default browser: " + SERVER_URL);
                        Process.Start(SERVER_URL);
                    }
                }
                catch (Exception ex)
                {
                    Log("LaunchWindow Error: " + ex.Message);
                    try { Process.Start(SERVER_URL); } catch { }
                }
            }

            private void CleanExit()
            {
                try
                {
                    if (_nodeProcess != null && !_nodeProcess.HasExited)
                    {
                        Log("Stopping Node server process (PID: " + _nodeProcess.Id + ")...");
                        _nodeProcess.Kill();
                    }
                }
                catch { }
            }

            public void Shutdown()
            {
                Log("Shutdown requested by user via Tray menu.");
                if (_trayIcon != null)
                {
                    _trayIcon.Visible = false;
                    _trayIcon.Dispose();
                }

                CleanExit();
                ExitThread();
            }

            private static Icon CreateCyberIcon()
            {
                try
                {
                    using (Bitmap bmp = new Bitmap(32, 32))
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                        g.Clear(Color.Transparent);

                        // Dark cyber background
                        using (SolidBrush bg = new SolidBrush(Color.FromArgb(13, 18, 31)))
                        {
                            g.FillEllipse(bg, 1, 1, 30, 30);
                        }

                        // Glowing cyan ring
                        using (Pen ring = new Pen(Color.FromArgb(0, 240, 255), 2.5f))
                        {
                            g.DrawEllipse(ring, 3, 3, 26, 26);
                        }

                        // Vibrant emerald core
                        using (SolidBrush dot = new SolidBrush(Color.FromArgb(16, 185, 129)))
                        {
                            g.FillEllipse(dot, 10, 10, 12, 12);
                        }

                        return Icon.FromHandle(bmp.GetHicon());
                    }
                }
                catch
                {
                    return SystemIcons.Application;
                }
            }
        }

        private static bool IsPortOpen(string host, int port, int timeoutMs)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult ar = client.BeginConnect(host, port, null, null);
                    bool connected = ar.AsyncWaitHandle.WaitOne(timeoutMs);
                    if (connected)
                    {
                        client.EndConnect(ar);
                        return true;
                    }
                    return false;
                }
            }
            catch
            {
                return false;
            }
        }

        private static string FindNodeExecutable(string baseDir)
        {
            // 1. Check bundled runtime directory
            string localRuntime = Path.Combine(baseDir, "runtime", "node", "node.exe");
            if (File.Exists(localRuntime)) return localRuntime;

            string binRuntime = Path.Combine(baseDir, "bin", "node.exe");
            if (File.Exists(binRuntime)) return binRuntime;

            string[] candidates = new string[]
            {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"npm\node.exe")
            };

            foreach (string path in candidates)
            {
                if (File.Exists(path)) return path;
            }

            try
            {
                Process p = Process.Start(new ProcessStartInfo
                {
                    FileName = "where.exe",
                    Arguments = "node",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true
                });
                string output = p.StandardOutput.ReadLine();
                p.WaitForExit();
                if (!string.IsNullOrEmpty(output) && File.Exists(output.Trim()))
                {
                    return output.Trim();
                }
            }
            catch { }

            return "node.exe";
        }

        private static string FindBrowserExecutable(string baseDir)
        {
            // 1. Check browser_config.json written by installer or user
            try
            {
                string cfgPath = Path.Combine(baseDir, "browser_config.json");
                if (File.Exists(cfgPath))
                {
                    string content = File.ReadAllText(cfgPath);
                    int idx = content.IndexOf("\"browserPath\"");
                    if (idx >= 0)
                    {
                        int colon = content.IndexOf(':', idx);
                        if (colon >= 0)
                        {
                            int q1 = content.IndexOf('"', colon);
                            if (q1 >= 0)
                            {
                                int q2 = content.IndexOf('"', q1 + 1);
                                if (q2 > q1)
                                {
                                    string p = content.Substring(q1 + 1, q2 - q1 - 1).Replace("\\\\", "\\");
                                    if (File.Exists(p)) return p;
                                }
                            }
                        }
                    }
                }
            }
            catch { }

            // 2. Check HKCU\Software\SessionManagerPro\BrowserPath
            try
            {
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\SessionManagerPro"))
                {
                    if (key != null)
                    {
                        object val = key.GetValue("BrowserPath");
                        if (val != null && File.Exists(val.ToString()))
                        {
                            return val.ToString();
                        }
                    }
                }
            }
            catch { }

            // 3. Fallback to standard Edge and Chrome installations
            string[] paths = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe"),
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };

            foreach (string p in paths)
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }

        private static void VerifyAndHealPythonVenv(string baseDir)
        {
            try
            {
                string pyvenvCfg = Path.Combine(baseDir, ".venv", "pyvenv.cfg");
                if (!File.Exists(pyvenvCfg)) return;

                string[] lines = File.ReadAllLines(pyvenvCfg);
                string home = null;
                string executable = null;
                foreach (string line in lines)
                {
                    string trimmed = line.Trim();
                    if (trimmed.StartsWith("home", StringComparison.OrdinalIgnoreCase))
                    {
                        int idx = trimmed.IndexOf('=');
                        if (idx >= 0) home = trimmed.Substring(idx + 1).Trim().Trim('"', '\'');
                    }
                    else if (trimmed.StartsWith("executable", StringComparison.OrdinalIgnoreCase))
                    {
                        int idx = trimmed.IndexOf('=');
                        if (idx >= 0) executable = trimmed.Substring(idx + 1).Trim().Trim('"', '\'');
                    }
                }

                bool homeValid = !string.IsNullOrEmpty(home) && Directory.Exists(home);
                bool execValid = !string.IsNullOrEmpty(executable) && File.Exists(executable);

                if (!homeValid || !execValid)
                {
                    Log(string.Format("pyvenv.cfg points to missing Python (home: {0}, exec: {1}). Auto-healing...", home, executable));

                    string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                    string[] candidates = new string[]
                    {
                        @"C:\Program Files\Python311",
                        Path.Combine(localApp, @"Programs\Python\Python311"),
                        @"C:\Program Files (x86)\Python311"
                    };

                    string validPythonDir = null;
                    foreach (string dir in candidates)
                    {
                        if (File.Exists(Path.Combine(dir, "python.exe")))
                        {
                            validPythonDir = dir;
                            break;
                        }
                    }

                    if (validPythonDir != null)
                    {
                        string fixedExe = Path.Combine(validPythonDir, "python.exe");
                        string venvDir = Path.Combine(baseDir, ".venv");
                        string newCfg = string.Format(
                            "home = {0}\r\ninclude-system-site-packages = false\r\nversion = 3.11.9\r\nexecutable = {1}\r\ncommand = {1} -m venv {2}\r\n",
                            validPythonDir, fixedExe, venvDir
                        );
                        File.WriteAllText(pyvenvCfg, newCfg, Encoding.UTF8);
                        Log("Successfully auto-healed pyvenv.cfg to: " + validPythonDir);
                    }
                }
            }
            catch (Exception ex)
            {
                Log("Warning: Could not verify/heal pyvenv.cfg: " + ex.Message);
            }
        }
    }
}

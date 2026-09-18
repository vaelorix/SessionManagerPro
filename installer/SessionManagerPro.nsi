; ==============================================================================
; SessionManagerPro - NSIS Setup Script
; Self-Contained Desktop Application Installer (Zero Runtime Prerequisites)
; Author: vaelorix (https://github.com/vaelorix)
; ==============================================================================

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

; Compression & Executable Settings
SetCompressor /SOLID lzma
Name "SessionManagerPro"
OutFile "..\dist-installer\SessionManagerPro-Setup.exe"
InstallDir "$LOCALAPPDATA\SessionManagerPro"
InstallDirRegKey HKCU "Software\SessionManagerPro" "InstallDir"
RequestExecutionLevel user
Unicode true

; Brand Information
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "SessionManagerPro"
VIAddVersionKey "CompanyName" "vaelorix"
VIAddVersionKey "LegalCopyright" "vaelorix © 2026"
VIAddVersionKey "FileDescription" "SessionManagerPro Native Installer"
VIAddVersionKey "FileVersion" "1.0.0.0"
VIAddVersionKey "ProductVersion" "1.0.0.0"

; UI Definitions
!define MUI_ABORTWARNING
!define MUI_ICON "..\launcher\app.ico"
!define MUI_UNICON "..\launcher\app.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP_NOSTRETCH

; Global Variables
Var Dialog
Var BrowserPathTxt
Var BrowseBtn
Var BrowserPath
Var GitHubBtn
Var EscapedPath

; Bottom-Left GitHub Button on Installer Window ($HWNDPARENT)
Function OpenGitHubProfile
  Pop $0
  ExecShell "open" "https://github.com/vaelorix"
FunctionEnd

Function onGUIInit
  ; Hide the default branding text label (Control ID 1028)
  GetDlgItem $0 $HWNDPARENT 1028
  ShowWindow $0 0

  ; Create "GitHub: vaelorix" button in the bottom-left corner of the wizard window
  System::Call 'user32::CreateWindowEx(i 0, t "BUTTON", t "GitHub: vaelorix", i 0x50010000, i 15, i 360, i 115, i 24, i $HWNDPARENT, i 1234, i 0, i 0) i.s'
  Pop $GitHubBtn

  ; Bind click event to open the user's GitHub profile
  ${NSD_OnClick} $GitHubBtn OpenGitHubProfile
FunctionEnd

!define MUI_CUSTOMFUNCTION_GUIINIT onGUIInit

; ------------------------------------------------------------------------------
; Wizard Pages
; ------------------------------------------------------------------------------
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY

; Custom Browser Selection Page
Page custom PageBrowserSelection PageBrowserSelectionLeave

!insertmacro MUI_PAGE_INSTFILES

; Finish Page
!define MUI_FINISHPAGE_RUN "$INSTDIR\SessionManagerPro.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch SessionManagerPro now"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create Desktop Shortcut"
!define MUI_FINISHPAGE_SHOWREADME_CHECKED
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!insertmacro MUI_PAGE_FINISH

; Uninstaller Pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ------------------------------------------------------------------------------
; Custom Browser Selection Page Implementation
; ------------------------------------------------------------------------------
Function PageBrowserSelection
  !insertmacro MUI_HEADER_TEXT "Browser Executable Selection" "Choose your preferred Chromium or Edge browser for SessionManagerPro."

  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "SessionManagerPro uses an installed Chromium browser (Google Chrome, Microsoft Edge, Brave, etc.) to run isolated profile windows.$\r$\nAuto-detected browser is shown below. You can keep it or select another:"
  Pop $0

  ; Auto-detect browser path if not already set
  ${If} $BrowserPath == ""
    ; 1. Chrome Program Files
    StrCpy $BrowserPath "C:\Program Files\Google\Chrome\Application\chrome.exe"
    ${IfNot} ${FileExists} $BrowserPath
      StrCpy $BrowserPath "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    ${EndIf}
    ${IfNot} ${FileExists} $BrowserPath
      ; 2. Edge Program Files
      StrCpy $BrowserPath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    ${EndIf}
    ${IfNot} ${FileExists} $BrowserPath
      StrCpy $BrowserPath "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ${EndIf}
    ${IfNot} ${FileExists} $BrowserPath
      ; 3. Local App Data Chrome
      StrCpy $BrowserPath "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ${EndIf}
    ${IfNot} ${FileExists} $BrowserPath
      ; 4. Local App Data Edge
      StrCpy $BrowserPath "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    ${EndIf}
  ${EndIf}

  ${NSD_CreateText} 0 35u 75% 14u $BrowserPath
  Pop $BrowserPathTxt

  ${NSD_CreateButton} 77% 34u 23% 16u "Browse..."
  Pop $BrowseBtn
  ${NSD_OnClick} $BrowseBtn OnBrowseBrowser

  ${NSD_CreateLabel} 0 60u 100% 30u "Tip: You can change this browser at any time in the SessionManagerPro settings."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function OnBrowseBrowser
  Pop $0
  nsDialogs::SelectFileDialog "open" "$BrowserPath" "Executable Files (*.exe)|*.exe|All Files (*.*)|*.*"
  Pop $0
  ${If} $0 != ""
    StrCpy $BrowserPath $0
    ${NSD_SetText} $BrowserPathTxt $BrowserPath
  ${EndIf}
FunctionEnd

Function PageBrowserSelectionLeave
  ${NSD_GetText} $BrowserPathTxt $BrowserPath
FunctionEnd

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\SessionManagerPro.lnk" "$INSTDIR\SessionManagerPro.exe" "" "$INSTDIR\SessionManagerPro.exe" 0
FunctionEnd

; ------------------------------------------------------------------------------
; Helper: Escape JSON Backslashes
; ------------------------------------------------------------------------------
Function EscapeBackslashes
  Exch $R0 ; input
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  StrCpy $R1 ""
  StrLen $R2 $R0
  StrCpy $R3 0
  ${DoWhile} $R3 < $R2
    StrCpy $R4 $R0 1 $R3
    ${If} $R4 == "\"
      StrCpy $R1 "$R1\\"
    ${Else}
      StrCpy $R1 "$R1$R4"
    ${EndIf}
    IntOp $R3 $R3 + 1
  ${Loop}
  StrCpy $R0 $R1
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

; ------------------------------------------------------------------------------
; Installation Section
; ------------------------------------------------------------------------------
Section "Install" SecInstall
  SetOutPath "$INSTDIR"

  ; Clean older instance if running
  DetailPrint "Checking for running instances..."
  nsExec::Exec 'taskkill /F /IM SessionManagerPro.exe'

  ; Install Application Executable & Package Manifest
  SetOutPath "$INSTDIR"
  File "..\SessionManagerPro.exe"
  File "..\package.json"

  ; Install Backend
  DetailPrint "Installing backend engine..."
  SetOutPath "$INSTDIR\backend"
  File /r /x "node_modules" "..\backend\*.*"

  SetOutPath "$INSTDIR\backend\node_modules"
  File /r "..\backend\node_modules\*.*"

  ; Install Root node_modules if present
  SetOutPath "$INSTDIR\node_modules"
  File /nonfatal /r "..\node_modules\*.*"

  ; Install Frontend Web UI
  DetailPrint "Installing dashboard UI..."
  SetOutPath "$INSTDIR\frontend\dist"
  File /r "..\frontend\dist\*.*"

  ; Install Bundled Standalone Runtimes (Zero User Prerequisites)
  DetailPrint "Installing embedded Node.js and Python runtimes..."
  SetOutPath "$INSTDIR\runtime"
  File /r "..\runtime\*.*"

  ; Install Default Extensions if present
  SetOutPath "$INSTDIR\extensions"
  File /nonfatal /r /x "*.git*" /x "scratch*" "..\extensions\*.*"

  SetOutPath "$INSTDIR"

  ; Write browser configuration file (JSON)
  Push $BrowserPath
  Call EscapeBackslashes
  Pop $EscapedPath

  FileOpen $0 "$INSTDIR\browser_config.json" w
  FileWrite $0 '{"browserPath": "$EscapedPath"}'
  FileClose $0

  ; Registry configuration
  WriteRegStr HKCU "Software\SessionManagerPro" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\SessionManagerPro" "BrowserPath" "$BrowserPath"

  ; Create Start Menu Shortcuts & Programs Group
  CreateDirectory "$SMPROGRAMS\SessionManagerPro"
  CreateShortcut "$SMPROGRAMS\SessionManagerPro\SessionManagerPro.lnk" "$INSTDIR\SessionManagerPro.exe" "" "$INSTDIR\SessionManagerPro.exe" 0
  CreateShortcut "$SMPROGRAMS\SessionManagerPro\Uninstall SessionManagerPro.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0

  ; Create Uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Windows Add/Remove Programs integration
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionManagerPro" "DisplayName" "SessionManagerPro"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionManagerPro" "DisplayIcon" "$INSTDIR\SessionManagerPro.exe,0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionManagerPro" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionManagerPro" "Publisher" "vaelorix"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionManagerPro" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionManagerPro" "URLInfoAbout" "https://github.com/vaelorix"

  DetailPrint "Installation completed successfully."
SectionEnd

; ------------------------------------------------------------------------------
; Uninstallation Section
; ------------------------------------------------------------------------------
Section "Uninstall"
  ; Stop any running process
  nsExec::Exec 'taskkill /F /IM SessionManagerPro.exe'

  ; Delete Desktop & Start Menu Shortcuts
  Delete "$DESKTOP\SessionManagerPro.lnk"
  Delete "$SMPROGRAMS\SessionManagerPro\SessionManagerPro.lnk"
  Delete "$SMPROGRAMS\SessionManagerPro\Uninstall SessionManagerPro.lnk"
  RMDir "$SMPROGRAMS\SessionManagerPro"

  ; Clean Registry Keys
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionManagerPro"
  DeleteRegKey HKCU "Software\SessionManagerPro"

  ; Remove Application Files & Subdirectories
  RMDir /r "$INSTDIR\backend"
  RMDir /r "$INSTDIR\dist"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\extensions"
  RMDir /r "$INSTDIR\updates"
  Delete "$INSTDIR\browser_config.json"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\SessionManagerPro.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd

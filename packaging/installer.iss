; Inno Setup script for Codehouse.
; Build with:  npm run package   then   ISCC packaging\installer.iss
; See docs/packaging.md.

#define AppName "Codehouse"
; The version comes from the package (scripts/installer.mjs passes /DAppVersion=...).
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6C1E5B0A-2F1D-4F3B-9D6E-6B7A0C2E41A7}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\Codehouse
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=..\dist-app
OutputBaseFilename=Codehouse-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=..\dist-app\gatehouse.ico
UninstallDisplayIcon={app}\Codehouse.exe

[Tasks]
Name: "logon"; Description: "Start Codehouse when I sign in"; Flags: unchecked

[Files]
; The program files are replaced on upgrade. The policy folder is the user's, so it is only written the first time.
; npm's workspace links (junctions) are not copied: Codehouse makes them itself on first start (scripts\links.mjs).
Source: "..\dist-app\Codehouse\*"; DestDir: "{app}"; Excludes: "app\policy\*,app\node_modules\@gatehouse"; Flags: recursesubdirs ignoreversion
Source: "..\dist-app\Codehouse\app\policy\*"; DestDir: "{app}\app\policy"; Excludes: "library\*"; Flags: recursesubdirs onlyifdoesntexist
; The rule library is shipped content, not yours, so it is replaced on upgrade. Your choices live in rules.user.yaml.
Source: "..\dist-app\Codehouse\app\policy\library\*"; DestDir: "{app}\app\policy\library"; Flags: recursesubdirs ignoreversion

[UninstallDelete]
; Codehouse updates itself by building the next version beside this folder and keeping the one before it.
Type: filesandordirs; Name: "{app}.next"
Type: filesandordirs; Name: "{app}.previous"
Type: filesandordirs; Name: "{app}\app\node_modules\@gatehouse"

[Icons]
Name: "{group}\Codehouse"; Filename: "{app}\Codehouse.exe"
Name: "{userstartup}\Codehouse"; Filename: "{app}\Codehouse.exe"; Parameters: "--tray"; Tasks: logon

[Run]
Filename: "{app}\Codehouse.exe"; Description: "Start Codehouse now"; Flags: nowait postinstall skipifsilent

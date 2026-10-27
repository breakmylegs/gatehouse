; Inno Setup script for Gatehouse. NOT COMPILED OR TESTED (Inno Setup was not installed when this was written).
; Build with:  npm run package   then   ISCC packaging\installer.iss
; See docs/packaging.md.

#define AppName "Gatehouse"
#define AppVersion "0.1.0"

[Setup]
AppId={{6C1E5B0A-2F1D-4F3B-9D6E-6B7A0C2E41A7}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=..\dist-app
OutputBaseFilename=Gatehouse-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=..\dist-app\gatehouse.ico
UninstallDisplayIcon={app}\Gatehouse.exe

[Tasks]
Name: "logon"; Description: "Start Gatehouse when I sign in"; Flags: unchecked

[Files]
; The program files are replaced on upgrade. The policy folder is the user's, so it is only written the first time.
Source: "..\dist-app\Gatehouse\*"; DestDir: "{app}"; Excludes: "app\policy\*"; Flags: recursesubdirs ignoreversion
Source: "..\dist-app\Gatehouse\app\policy\*"; DestDir: "{app}\app\policy"; Flags: recursesubdirs onlyifdoesntexist

[Icons]
Name: "{group}\Gatehouse"; Filename: "{app}\Gatehouse.exe"
Name: "{userstartup}\Gatehouse"; Filename: "{app}\Gatehouse.exe"; Parameters: "--no-browser"; Tasks: logon

[Run]
Filename: "{app}\Gatehouse.exe"; Description: "Start Gatehouse now"; Flags: nowait postinstall skipifsilent

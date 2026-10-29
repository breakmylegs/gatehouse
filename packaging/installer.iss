; Inno Setup script for Jean-Claude Van Code (JCVC).
; Build with:  npm run package   then   ISCC packaging\installer.iss
; See docs/packaging.md.

#define AppName "Jean-Claude Van Code"
; The version comes from the package (scripts/installer.mjs passes /DAppVersion=...).
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6C1E5B0A-2F1D-4F3B-9D6E-6B7A0C2E41A7}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\JCVC
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=..\dist-app
OutputBaseFilename=JCVC-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=..\dist-app\gatehouse.ico
UninstallDisplayIcon={app}\JCVC.exe

[Tasks]
Name: "logon"; Description: "Start Jean-Claude Van Code when I sign in"; Flags: unchecked

[Files]
; The program files are replaced on upgrade. The policy folder is the user's, so it is only written the first time.
; npm's workspace links (junctions) are not copied: JCVC makes them itself on first start (scripts\links.mjs).
Source: "..\dist-app\JCVC\*"; DestDir: "{app}"; Excludes: "app\policy\*,app\node_modules\@gatehouse"; Flags: recursesubdirs ignoreversion
Source: "..\dist-app\JCVC\app\policy\*"; DestDir: "{app}\app\policy"; Excludes: "library\*"; Flags: recursesubdirs onlyifdoesntexist
; The rule library is shipped content, not yours, so it is replaced on upgrade. Your choices live in rules.user.yaml.
Source: "..\dist-app\JCVC\app\policy\library\*"; DestDir: "{app}\app\policy\library"; Flags: recursesubdirs ignoreversion

[UninstallDelete]
; JCVC updates itself by building the next version beside this folder and keeping the one before it.
Type: filesandordirs; Name: "{app}.next"
Type: filesandordirs; Name: "{app}.previous"
Type: filesandordirs; Name: "{app}\app\node_modules\@gatehouse"

[Icons]
Name: "{group}\Jean-Claude Van Code"; Filename: "{app}\JCVC.exe"
Name: "{userstartup}\Jean-Claude Van Code"; Filename: "{app}\JCVC.exe"; Parameters: "--tray"; Tasks: logon

[Run]
Filename: "{app}\JCVC.exe"; Description: "Start Jean-Claude Van Code now"; Flags: nowait postinstall skipifsilent

[Code]
// JCVC-Setup.msi records itself here (HKCU when installed for one user, HKLM when installed for everyone).
// Installing this over it would leave two installers owning one folder.
function InstalledByMsi(): Boolean;
var
  v: String;
begin
  Result := (RegQueryStringValue(HKCU, 'Software\Gatehouse\JCVC', 'Installer', v) and (v = 'msi')) or
            (RegQueryStringValue(HKLM64, 'Software\Gatehouse\JCVC', 'Installer', v) and (v = 'msi'));
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if InstalledByMsi() then
  begin
    MsgBox('Jean-Claude Van Code is already installed from JCVC-Setup.msi. It updates itself, so you do not need this installer.' + #13#10#13#10 +
           'To switch, uninstall it first from Windows Settings, Apps.', mbInformation, MB_OK);
    Result := False;
  end;
end;

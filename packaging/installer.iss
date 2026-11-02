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
; Always the Codehouse folder and Start menu group, even over an install from before the rename (see [Code]).
UsePreviousAppDir=no
UsePreviousGroup=no
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
; The setup artwork from the Codehouse visual identity pack.
WizardImageFile=brand\installer-side.png
WizardSmallImageFile=brand\installer-small.png

[Tasks]
Name: "logon"; Description: "Start Codehouse when I sign in"; Flags: unchecked

[Files]
; The program files are replaced on upgrade. The policy folder is the user's, so it is only written the first time.
; npm's workspace links (junctions) are not copied: Codehouse makes them itself on first start (scripts\links.mjs).
Source: "..\dist-app\Codehouse\*"; DestDir: "{app}"; Excludes: "app\policy\*,app\node_modules\@gatehouse"; Flags: recursesubdirs ignoreversion
Source: "..\dist-app\Codehouse\app\policy\*"; DestDir: "{app}\app\policy"; Excludes: "library\*"; Flags: recursesubdirs onlyifdoesntexist
; The rule library is shipped content, not yours, so it is replaced on upgrade. Your choices live in rules.user.yaml.
Source: "..\dist-app\Codehouse\app\policy\library\*"; DestDir: "{app}\app\policy\library"; Flags: recursesubdirs ignoreversion

[InstallDelete]
; Left by an update route for installs made before a rename; this install is in its own folder.
Type: files; Name: "{app}\move-over.json"

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
; Codehouse-Update.exe runs setup silently with /START to finish a move, and Codehouse opens again by itself.
Filename: "{app}\Codehouse.exe"; Flags: nowait; Check: StartAfterSilent

[Code]
// Moving over from an install made before the rename (owner, 2 Nov). That version can never take a Codehouse update by
// itself, so this installer is the one-time way across. It finds the earlier install from Windows' own record of this
// app (the same AppId), never by its name: it waits until that version is quit, installs into the Codehouse folder,
// then removes the earlier folder, the folders its updater kept beside it, and the shortcuts that started it. Your
// data, settings and sessions are in %LOCALAPPDATA%\Gatehouse and are not touched.
//
// The same move is also made with no one at the keyboard: a copy that arrived by an update route for installs made
// before a rename (service.ts) has Codehouse-Update.exe run this setup with /VERYSILENT /START /DIR=<its own folder>
// /EARLIER=<the folder it is in>. Then it waits on its own instead of asking, and starts Codehouse when done.
const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{6C1E5B0A-2F1D-4F3B-9D6E-6B7A0C2E41A7}_is1';

var
  EarlierDir: String;
  EarlierGroup: String;
  EarlierParam: String;
  HadSignIn: Boolean;

function InitializeSetup(): Boolean;
var
  Value: String;
begin
  Result := True;
  if RegQueryStringValue(HKCU, UninstallKey, 'Inno Setup: App Path', Value) then
    EarlierDir := RemoveBackslashUnlessRoot(Value);
  if RegQueryStringValue(HKCU, UninstallKey, 'Inno Setup: Icon Group', Value) then
    EarlierGroup := Value;
  EarlierParam := RemoveBackslashUnlessRoot(ExpandConstant('{param:EARLIER|}'));
end;

function HasSwitch(Name: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Name) = 0 then
      Result := True;
end;

function StartAfterSilent(): Boolean;
begin
  Result := WizardSilent and HasSwitch('/START');
end;

// Only a folder of its own directly under your Programs folder, holding the earlier uninstaller, is ever removed.
function SafeToRemove(Dir: String): Boolean;
var
  Programs: String;
begin
  Programs := AddBackslash(ExpandConstant('{localappdata}\Programs'));
  Result := (Dir <> '') and DirExists(Dir)
    and (CompareText(Copy(AddBackslash(Dir), 1, Length(Programs)), Programs) = 0)
    and (Pos('\', Copy(Dir, Length(Programs) + 1, MaxInt)) = 0)
    and (Length(Dir) > Length(Programs));
end;

function WqlLike(S: String): String;
begin
  StringChangeEx(S, '[', '[[]', True);
  StringChangeEx(S, '_', '[_]', True);
  StringChangeEx(S, '%', '[%]', True);
  StringChangeEx(S, '\', '\\', True);
  StringChangeEx(S, '''', '\''', True);
  Result := S;
end;

// Whether anything is running from the earlier folder: its window, its Host or its Approver.
function EarlierRunning(): Boolean;
var
  Locator, Service, Found: Variant;
begin
  Result := False;
  if EarlierDir = '' then
    Exit;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Found := Service.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE ExecutablePath LIKE ''' +
      WqlLike(AddBackslash(EarlierDir)) + '%''');
    Result := Found.Count > 0;
  except
    Result := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  App: String;
  Waited: Integer;
begin
  Result := '';
  App := RemoveBackslashUnlessRoot(ExpandConstant('{app}'));
  // The folder Codehouse-Update.exe names (the copy it is moving) comes first; then Windows' record of this app.
  if (EarlierParam <> '') and (CompareText(EarlierParam, App) <> 0) and SafeToRemove(EarlierParam)
    and FileExists(AddBackslash(EarlierParam) + 'move-over.json') then
    EarlierDir := EarlierParam
  else if (CompareText(EarlierDir, App) = 0) or not SafeToRemove(EarlierDir)
    or not FileExists(AddBackslash(EarlierDir) + 'unins000.exe') then
    EarlierDir := '';
  if EarlierDir = '' then
    Exit;
  // With no one to ask, wait up to two minutes for the earlier version to finish closing.
  Waited := 0;
  while WizardSilent and EarlierRunning() and (Waited < 120) do
  begin
    Sleep(1000);
    Waited := Waited + 1;
  end;
  while EarlierRunning() do
    if SuppressibleMsgBox('The earlier version of Codehouse is still running. Quit it from its tray icon ' +
      '(right-click it, then Quit), then choose Retry. Your sessions carry on when Codehouse opens again.',
      mbError, MB_RETRYCANCEL, IDCANCEL) = IDCANCEL then
    begin
      Result := 'The earlier version is still running. Quit it from its tray icon, then run setup again.';
      Exit;
    end;
end;

// Removes the shortcuts in a folder that start something in the earlier folder. Says whether it removed any.
function RemoveShortcutsInto(Folder: String): Boolean;
var
  Found: TFindRec;
  Shell, Link: Variant;
  Target: String;
begin
  Result := False;
  if not FindFirst(AddBackslash(Folder) + '*.lnk', Found) then
    Exit;
  try
    try
      Shell := CreateOleObject('WScript.Shell');
      repeat
        Link := Shell.CreateShortcut(AddBackslash(Folder) + Found.Name);
        Target := Link.TargetPath;
        if CompareText(Copy(Target, 1, Length(EarlierDir) + 1), AddBackslash(EarlierDir)) = 0 then
          if DeleteFile(AddBackslash(Folder) + Found.Name) then
            Result := True;
      until not FindNext(Found);
    except
    end;
  finally
    FindClose(Found);
  end;
end;

// Removes a folder now, or at your next sign-in if Windows still holds a file in it.
procedure RemoveFolder(Dir: String);
begin
  if not SafeToRemove(Dir) then
    Exit;
  if not DelTree(Dir, True, True, True) then
    RegWriteStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\RunOnce', 'CodehouseTidy',
      ExpandConstant('{cmd}') + ' /c rmdir /s /q "' + Dir + '"');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Group: String;
begin
  if (CurStep <> ssPostInstall) or (EarlierDir = '') then
    Exit;
  HadSignIn := RemoveShortcutsInto(ExpandConstant('{userstartup}'));
  RemoveShortcutsInto(ExpandConstant('{userdesktop}'));
  RemoveShortcutsInto(ExpandConstant('{userprograms}'));
  // If the earlier version started when you signed in, Codehouse does too.
  if HadSignIn and not FileExists(ExpandConstant('{userstartup}\{#AppName}.lnk')) then
    CreateShellLink(ExpandConstant('{userstartup}\{#AppName}.lnk'), '{#AppName}',
      ExpandConstant('{app}\Codehouse.exe'), '--tray', ExpandConstant('{app}'), '', 0, SW_SHOWNORMAL);
  if EarlierGroup <> '' then
  begin
    Group := AddBackslash(ExpandConstant('{userprograms}')) + EarlierGroup;
    if (Pos('\', EarlierGroup) = 0) and (CompareText(EarlierGroup, '{#AppName}') <> 0) and DirExists(Group) then
    begin
      RemoveShortcutsInto(Group);
      RemoveDir(Group);
    end;
  end;
  RemoveFolder(EarlierDir);
  RemoveFolder(EarlierDir + '.previous');
  RemoveFolder(EarlierDir + '.next');
end;
